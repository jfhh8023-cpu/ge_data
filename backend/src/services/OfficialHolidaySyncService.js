const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DutyHolidaySnapshot } = require('../models');

const MIN_YEAR = 2007;
const MAX_YEAR = 2100;
const SEARCH_ENDPOINT = 'https://sousuo.www.gov.cn/search-gov/data';
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FUTURE_RETRY_MS = 12 * 60 * 60 * 1000;
const HISTORY_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const READY_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const EXPECTED_HOLIDAYS = ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'];
const snapshotCache = new Map();
const statusCache = new Map();
const syncInFlight = new Map();
let initializedPromise = null;
let schedulerTimer = null;
let snapshotUpdatedHook = null;

function assertSupportedYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    const error = new Error(`年份必须在 ${MIN_YEAR} 至 ${MAX_YEAR} 之间`);
    error.status = 400;
    error.reason = 'invalid_holiday_year';
    throw error;
  }
  return year;
}

function dateYmd(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`官方节假日包含无效日期：${year}-${month}-${day}`);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateRange(start, end) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (endDate < startDate) throw new Error(`官方节假日区间结束日期早于开始日期：${start} 至 ${end}`);
  const result = [];
  for (let cursor = startDate; cursor <= endDate; cursor = new Date(cursor.getTime() + 86400000)) {
    result.push(cursor.toISOString().slice(0, 10));
  }
  return result;
}

function checksumDays(days) {
  const canonical = [...days]
    .map(day => ({
      date: day.date,
      holiday_name: day.holiday_name || '',
      range_id: day.range_id || '',
      is_holiday: day.is_holiday === true,
      is_adjusted_workday: day.is_adjusted_workday === true
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function normalizeOfficialDays(year, value) {
  if (!Array.isArray(value)) throw new Error(`${year} 年官方节假日明细格式无效`);
  const byDate = new Map();
  value.forEach(raw => {
    const date = String(raw?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) !== year) {
      throw new Error(`${year} 年官方节假日包含越界日期：${date || '空日期'}`);
    }
    dateYmd(year, Number(date.slice(5, 7)), Number(date.slice(8, 10)));
    const isHoliday = raw?.is_holiday === true;
    const isAdjusted = raw?.is_adjusted_workday === true;
    if (isHoliday === isAdjusted) throw new Error(`${date} 必须且只能标记为放假或补班`);
    const existing = byDate.get(date);
    if (existing) {
      if (existing.is_holiday !== isHoliday || existing.is_adjusted_workday !== isAdjusted) {
        throw new Error(`${date} 同时被标记为放假和补班`);
      }
      return;
    }
    byDate.set(date, {
      date,
      holiday_name: String(raw?.holiday_name || '').trim(),
      range_id: String(raw?.range_id || '').trim(),
      is_holiday: isHoliday,
      is_adjusted_workday: isAdjusted
    });
  });
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (days.filter(day => day.is_holiday).length < 7 || days.length > 80) {
    throw new Error(`${year} 年官方节假日数量异常`);
  }
  return days;
}

function normalizeSnapshot(value) {
  const year = assertSupportedYear(value?.year || value?.calendar_year);
  const days = normalizeOfficialDays(year, value?.days || value?.official_days);
  const checksum = checksumDays(days);
  if (value?.checksum && String(value.checksum) !== checksum) {
    throw new Error(`${year} 年官方节假日快照校验和不匹配`);
  }
  return {
    year,
    source_title: String(value?.source_title || '').trim(),
    source_document_no: String(value?.source_document_no || '').trim(),
    source_url: String(value?.source_url || '').trim(),
    published_at: value?.published_at ? String(value.published_at).slice(0, 10) : null,
    verified_at: value?.verified_at || new Date().toISOString(),
    version: String(value?.version || value?.source_version || `gov-cn-${year}-${checksum.slice(0, 12)}`),
    checksum,
    days
  };
}

function stripTags(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[\u00a0\u2002-\u200b\u202f\u205f\u3000]/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function compactText(value) {
  return stripTags(value).replace(/\s+/g, '');
}

function rangeIdForName(name) {
  if (name.includes('元旦')) return 'new-year';
  if (name.includes('春节')) return 'spring-festival';
  if (name.includes('清明')) return 'qingming';
  if (name.includes('劳动')) return 'labour-day';
  if (name.includes('端午')) return 'dragon-boat';
  if (name.includes('中秋') && name.includes('国庆')) return 'national-mid-autumn';
  if (name.includes('中秋')) return 'mid-autumn';
  if (name.includes('国庆')) return 'national-day';
  return `holiday-${crypto.createHash('sha1').update(name).digest('hex').slice(0, 8)}`;
}

function expectedHolidayNames(year) {
  return year >= 2008 ? EXPECTED_HOLIDAYS : ['元旦', '春节', '劳动节', '国庆节'];
}

function holidayHeadingMatches(heading, name) {
  if (name === '劳动节') return heading.includes('劳动节') || heading.includes('五一');
  if (name === '国庆节') return heading.includes('国庆节') || heading.includes('十一');
  return heading.includes(name);
}

function canonicalHolidayName(heading) {
  const names = expectedHolidayNames(2100).filter(name => holidayHeadingMatches(heading, name));
  return names.join('、') || heading.trim();
}

function holidayRangeFromSentence(year, sentence) {
  const beforeHoliday = sentence.slice(0, sentence.indexOf('放假'));
  const rangeMatch = beforeHoliday.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?(?:（[^）]{0,40}）)?(?:至|到|—|-)(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日?/);
  if (rangeMatch) {
    const startYear = Number(rangeMatch[1] || year);
    const startMonth = Number(rangeMatch[2]);
    const startDay = Number(rangeMatch[3]);
    const endYear = Number(rangeMatch[4] || startYear);
    const endMonth = Number(rangeMatch[5] || rangeMatch[2]);
    const endDay = Number(rangeMatch[6]);
    return dateRange(dateYmd(startYear, startMonth, startDay), dateYmd(endYear, endMonth, endDay))
      .filter(date => Number(date.slice(0, 4)) === year);
  }
  const single = beforeHoliday.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?/);
  if (!single) throw new Error(`无法解析放假日期：${sentence.slice(0, 80)}`);
  const singleYear = Number(single[1] || year);
  if (singleYear !== year) return [];
  return [dateYmd(singleYear, Number(single[2]), Number(single[3]))];
}

function flexibleDateList(year, value, defaultMonth = 1, defaultYear = year) {
  const result = [];
  let activeYear = defaultYear;
  let activeMonth = defaultMonth;
  for (const match of String(value || '').matchAll(/(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日/g)) {
    if (match[1]) activeYear = Number(match[1]);
    if (match[2]) activeMonth = Number(match[2]);
    if (activeYear === year) result.push(dateYmd(activeYear, activeMonth, Number(match[3])));
  }
  return result;
}

function adjustedDatesFromSection(year, section, defaultMonth) {
  const result = [];
  const crossYearNewYear = section.includes(`${year - 1}年12月`) && section.includes(`${year}年1月`);
  section.split('。').filter(sentence => sentence.includes('上班')).forEach(sentence => {
    const beforeWork = sentence.slice(0, sentence.lastIndexOf('上班'));
    const clauses = beforeWork.split(/[；;，,]/);
    const workClause = clauses.at(-1);
    const explicitMonths = [...beforeWork.matchAll(/(\d{1,2})月/g)].map(match => Number(match[1]));
    const inferredMonth = explicitMonths.at(-1) || defaultMonth;
    const inferredYear = crossYearNewYear && inferredMonth === 12 ? year - 1 : year;
    for (const date of flexibleDateList(year, workClause, inferredMonth, inferredYear)) {
      result.push(date);
    }
  });
  section.split('。').filter(sentence => sentence.includes('公休日调至')).forEach(sentence => {
    const beforeMove = sentence.slice(0, sentence.indexOf('公休日调至'));
    const moveClause = beforeMove.split(/[；;，,]/).at(-1);
    const explicitMonths = [...beforeMove.matchAll(/(\d{1,2})月/g)].map(match => Number(match[1]));
    const inferredMonth = explicitMonths.at(-1) || defaultMonth;
    const inferredYear = crossYearNewYear && inferredMonth === 12 ? year - 1 : year;
    for (const date of flexibleDateList(year, moveClause, inferredMonth, inferredYear)) {
      result.push(date);
    }
  });
  return [...new Set(result)];
}

function parseOfficialHolidayDocument({ year: yearValue, html, source = {} }) {
  const year = assertSupportedYear(yearValue);
  const text = compactText(html);
  const expectedTitle = `国务院办公厅关于${year}年部分节假日安排的通知`;
  if (!text.includes(expectedTitle)) throw new Error('官方原文标题与年份不匹配');
  const sectionPattern = /([一二三四五六七八九十]+)、([^：:。]{1,24})[：:]/g;
  const matches = [...text.matchAll(sectionPattern)];
  const expectedNames = expectedHolidayNames(year);
  if (matches.length < 4) throw new Error('官方原文节假日分节不完整');
  const headings = matches.map(match => match[2]);
  expectedNames.forEach(name => {
    if (!headings.some(heading => holidayHeadingMatches(heading, name))) throw new Error(`官方原文缺少 ${name} 安排`);
  });

  const days = [];
  matches.forEach((match, index) => {
    const heading = match[2].trim();
    if (!expectedNames.some(expected => holidayHeadingMatches(heading, expected))) return;
    const name = canonicalHolidayName(heading);
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const section = text.slice(start, end);
    const holidaySentence = section.split('。').find(sentence => sentence.includes('放假'));
    if (!holidaySentence) throw new Error(`${name} 未找到放假日期`);
    const rangeId = rangeIdForName(name);
    const holidayDates = holidayRangeFromSentence(year, holidaySentence);
    holidayDates.forEach(date => {
      days.push({ date, holiday_name: name, range_id: rangeId, is_holiday: true, is_adjusted_workday: false });
    });
    const defaultMonth = Number(holidayDates[0]?.slice(5, 7)) || 1;
    adjustedDatesFromSection(year, section, defaultMonth).forEach(date => {
      if (holidayDates.includes(date)) return;
      days.push({ date, holiday_name: `${name}补班`, range_id: rangeId, is_holiday: false, is_adjusted_workday: true });
    });
  });

  const normalizedDays = normalizeOfficialDays(year, days);
  const holidayDays = normalizedDays.filter(day => day.is_holiday);
  const adjustedWorkdays = normalizedDays.filter(day => day.is_adjusted_workday);
  expectedNames.forEach(name => {
    if (!holidayDays.some(day => holidayHeadingMatches(day.holiday_name, name))) {
      throw new Error(`官方原文未生成 ${name} 放假日期`);
    }
  });
  if (adjustedWorkdays.length === 0) {
    throw new Error('官方原文未生成任何调休上班日期');
  }
  const checksum = checksumDays(normalizedDays);
  return normalizeSnapshot({
    year,
    source_title: expectedTitle,
    source_document_no: stripTags(source.pcode || source.source_document_no || ''),
    source_url: source.url || source.source_url,
    published_at: String(source.pubtimeStr || source.published_at || '').replaceAll('.', '-').slice(0, 10) || null,
    verified_at: new Date().toISOString(),
    version: `gov-cn-${year}-${checksum.slice(0, 12)}`,
    checksum,
    days: normalizedDays
  });
}

function isAllowedOfficialUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'gov.cn' || host === 'www.gov.cn' || host.endsWith('.www.gov.cn'));
  } catch {
    return false;
  }
}

function normalizeOfficialUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return '';
  }
}

async function fetchWithTimeout(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let currentUrl = normalizeOfficialUrl(url);
    if (!isAllowedOfficialUrl(currentUrl)) throw new Error('官方数据请求地址不在 gov.cn 白名单');
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      const response = await fetchImpl(currentUrl, {
        ...options,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'DevTracker-HolidaySync/1.0 (+official gov.cn source only)',
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          ...(options.headers || {})
        }
      });
      const responseStatus = Number(response.status);
      if (!Number.isFinite(responseStatus) || responseStatus < 300 || responseStatus >= 400) return response;
      const location = response.headers?.get?.('location');
      if (!location) throw new Error('官方数据重定向缺少目标地址');
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isAllowedOfficialUrl(nextUrl)) throw new Error('官方数据重定向目标不在 gov.cn 白名单');
      currentUrl = nextUrl;
    }
    throw new Error('官方数据重定向次数超过限制');
  } finally {
    clearTimeout(timeout);
  }
}

async function readOfficialSourceText(response, label) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > MAX_SOURCE_BYTES) {
    throw new Error(`${label}响应体超过 ${MAX_SOURCE_BYTES} 字节限制`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES) {
    throw new Error(`${label}响应体超过 ${MAX_SOURCE_BYTES} 字节限制`);
  }
  return text;
}

async function searchOfficialPolicyDocuments(query, fetchImpl = global.fetch) {
  const params = new URLSearchParams({
    t: 'zhengcelibrary',
    q: query,
    p: '1',
    n: '20',
    sort: 'score',
    sortType: '1',
    searchfield: 'title'
  });
  const response = await fetchWithTimeout(fetchImpl, `${SEARCH_ENDPOINT}?${params}`);
  if (!response.ok) throw new Error(`中国政府网政策文件库返回 HTTP ${response.status}`);
  let payload;
  try {
    payload = JSON.parse(await readOfficialSourceText(response, '中国政府网政策文件库'));
  } catch (error) {
    throw new Error(`中国政府网政策文件库响应格式无效：${error.message}`);
  }
  if (Number(payload?.code) === 1001) return null;
  if (Number(payload?.code) !== 200) throw new Error(`中国政府网政策文件库返回状态 ${payload?.code ?? '未知'}`);
  return Object.values(payload?.searchVO?.catMap || {})
    .flatMap(group => Array.isArray(group?.listVO) ? group.listVO : []);
}

async function discoverOfficialHolidayDocument(year, fetchImpl = global.fetch) {
  const expectedTitle = `国务院办公厅关于${year}年部分节假日安排的通知`;
  const candidates = await searchOfficialPolicyDocuments(`${year}年部分节假日安排的通知`, fetchImpl) || [];
  const match = candidates.find(candidate => (
    compactText(candidate?.title) === expectedTitle &&
    compactText(candidate?.puborg).includes('国务院办公厅') &&
    isAllowedOfficialUrl(normalizeOfficialUrl(candidate?.url))
  ));
  return match ? { ...match, url: normalizeOfficialUrl(match.url) } : null;
}

async function discoverOfficialHolidayAmendments(year, fetchImpl = global.fetch) {
  const expectedTitle = `国务院办公厅关于延长${year}年春节假期的通知`;
  const candidates = await searchOfficialPolicyDocuments(expectedTitle, fetchImpl) || [];
  return candidates
    .filter(candidate => (
      compactText(candidate?.title) === expectedTitle &&
      compactText(candidate?.puborg).includes('国务院办公厅') &&
      isAllowedOfficialUrl(normalizeOfficialUrl(candidate?.url))
    ))
    .map(candidate => ({ ...candidate, url: normalizeOfficialUrl(candidate.url) }));
}

async function applyOfficialHolidayAmendments(snapshot, fetchImpl = global.fetch) {
  const amendments = await discoverOfficialHolidayAmendments(snapshot.year, fetchImpl);
  if (!amendments.length) return snapshot;
  let days = [...snapshot.days];
  let latestSource = null;
  for (const source of amendments) {
    const response = await fetchWithTimeout(fetchImpl, source.url);
    if (!response.ok) throw new Error(`官方节假日调整原文返回 HTTP ${response.status}`);
    if (!isAllowedOfficialUrl(response.url || source.url)) throw new Error('官方调整原文重定向目标不在 gov.cn 白名单');
    const text = compactText(await readOfficialSourceText(response, '官方节假日调整原文'));
    const expectedTitle = `国务院办公厅关于延长${snapshot.year}年春节假期的通知`;
    if (!text.includes(expectedTitle)) throw new Error('官方节假日调整原文标题不匹配');
    const endMatch = text.match(/(?:春节假期延长至|延长(?:(\d{4})年)?春节假期至)(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
    if (!endMatch) throw new Error('无法解析官方春节假期延长截止日期');
    const endYear = Number(endMatch[2] || endMatch[1] || snapshot.year);
    const extensionEnd = dateYmd(endYear, Number(endMatch[3]), Number(endMatch[4]));
    const existingSpringDays = days
      .filter(day => day.is_holiday && day.range_id === 'spring-festival')
      .map(day => day.date)
      .sort();
    const previousEnd = existingSpringDays.at(-1);
    if (!previousEnd || extensionEnd <= previousEnd) throw new Error('官方春节延长日期未晚于原假期结束日期');
    const extensionStart = new Date(`${previousEnd}T00:00:00Z`);
    extensionStart.setUTCDate(extensionStart.getUTCDate() + 1);
    const extensionDates = dateRange(extensionStart.toISOString().slice(0, 10), extensionEnd)
      .filter(date => Number(date.slice(0, 4)) === snapshot.year);
    const extensionDateSet = new Set(extensionDates);
    days = days.filter(day => !extensionDateSet.has(day.date));
    extensionDates.forEach(date => days.push({
        date,
        holiday_name: '春节',
        range_id: 'spring-festival',
        is_holiday: true,
        is_adjusted_workday: false
      }));
    latestSource = source;
  }
  days = normalizeOfficialDays(snapshot.year, days);
  const checksum = checksumDays(days);
  return normalizeSnapshot({
    ...snapshot,
    source_title: `${snapshot.source_title}；${stripTags(latestSource.title)}`,
    source_document_no: [snapshot.source_document_no, stripTags(latestSource.pcode)].filter(Boolean).join('；'),
    source_url: latestSource.url,
    published_at: String(latestSource.pubtimeStr || snapshot.published_at || '').replaceAll('.', '-').slice(0, 10),
    verified_at: new Date().toISOString(),
    version: `gov-cn-${snapshot.year}-${checksum.slice(0, 12)}`,
    checksum,
    days
  });
}

function snapshotFromRow(row) {
  const plain = row?.toJSON ? row.toJSON() : row;
  if (!plain || !['ready', 'refresh_failed'].includes(plain.sync_status) || !plain.official_days) return null;
  const days = typeof plain.official_days === 'string' ? JSON.parse(plain.official_days) : plain.official_days;
  return normalizeSnapshot({
    year: plain.calendar_year,
    source_title: plain.source_title,
    source_document_no: plain.source_document_no,
    source_url: plain.source_url,
    published_at: plain.published_at,
    verified_at: plain.verified_at,
    version: plain.source_version,
    checksum: plain.checksum,
    days
  });
}

function statusFromRow(row) {
  const plain = row?.toJSON ? row.toJSON() : row;
  if (!plain) return null;
  return {
    year: Number(plain.calendar_year),
    status: plain.sync_status || 'pending',
    last_checked_at: plain.last_checked_at || null,
    next_retry_at: plain.next_retry_at || null,
    error_message: plain.error_message || '',
    source_url: plain.source_url || '',
    source_version: plain.source_version || ''
  };
}

async function persistReadySnapshot(snapshot) {
  const now = new Date();
  await DutyHolidaySnapshot.upsert({
    calendar_year: snapshot.year,
    source_title: snapshot.source_title,
    source_document_no: snapshot.source_document_no,
    source_url: snapshot.source_url,
    published_at: snapshot.published_at,
    verified_at: snapshot.verified_at,
    source_version: snapshot.version,
    checksum: snapshot.checksum,
    official_days: JSON.stringify(snapshot.days),
    sync_status: 'ready',
    last_checked_at: now,
    next_retry_at: null,
    error_message: null,
    updated_at: now
  });
  snapshotCache.set(snapshot.year, snapshot);
  statusCache.set(snapshot.year, {
    year: snapshot.year,
    status: 'ready',
    last_checked_at: now,
    next_retry_at: null,
    error_message: '',
    source_url: snapshot.source_url,
    source_version: snapshot.version
  });
  if (snapshotUpdatedHook) snapshotUpdatedHook(snapshot.year, snapshot);
  return snapshot;
}

async function persistSyncFailure(year, status, message) {
  const now = new Date();
  const retryMs = year >= new Date().getFullYear() ? FUTURE_RETRY_MS : HISTORY_RETRY_MS;
  const nextRetry = new Date(now.getTime() + retryMs);
  const existing = snapshotCache.get(year);
  const payload = {
    calendar_year: year,
    sync_status: existing ? 'refresh_failed' : status,
    last_checked_at: now,
    next_retry_at: nextRetry,
    error_message: String(message || '').slice(0, 1000),
    updated_at: now
  };
  if (existing) {
    Object.assign(payload, {
      source_title: existing.source_title,
      source_document_no: existing.source_document_no,
      source_url: existing.source_url,
      published_at: existing.published_at,
      verified_at: existing.verified_at,
      source_version: existing.version,
      checksum: existing.checksum,
      official_days: JSON.stringify(existing.days)
    });
  }
  await DutyHolidaySnapshot.upsert(payload);
  statusCache.set(year, {
    year,
    status: existing ? 'refresh_failed' : status,
    last_checked_at: now,
    next_retry_at: nextRetry,
    error_message: payload.error_message,
    source_url: existing?.source_url || '',
    source_version: existing?.version || ''
  });
  return existing || null;
}

async function syncOfficialHolidaySnapshot(yearValue, options = {}) {
  const year = assertSupportedYear(yearValue);
  if (syncInFlight.has(year)) return syncInFlight.get(year);
  const operation = (async () => {
    const fetchImpl = options.fetchImpl || global.fetch;
    try {
      const source = await discoverOfficialHolidayDocument(year, fetchImpl);
      if (!source) return persistSyncFailure(year, 'pending', '官方年度节假日通知尚未发布或尚未被政策文件库收录');
      if (!isAllowedOfficialUrl(source.url)) throw new Error('官方原文 URL 不在 gov.cn 白名单');
      const response = await fetchWithTimeout(fetchImpl, source.url);
      if (!response.ok) throw new Error(`官方节假日原文返回 HTTP ${response.status}`);
      if (!isAllowedOfficialUrl(response.url || source.url)) throw new Error('官方原文重定向目标不在 gov.cn 白名单');
      const html = await readOfficialSourceText(response, '官方节假日原文');
      const annualSnapshot = parseOfficialHolidayDocument({ year, html, source });
      const snapshot = await applyOfficialHolidayAmendments(annualSnapshot, fetchImpl);
      return persistReadySnapshot(snapshot);
    } catch (error) {
      await persistSyncFailure(year, 'error', error.message);
      if (options.throwOnError) throw error;
      return snapshotCache.get(year) || null;
    }
  })();
  syncInFlight.set(year, operation);
  try {
    return await operation;
  } finally {
    syncInFlight.delete(year);
  }
}

async function initializeOfficialHolidaySnapshots() {
  if (initializedPromise) return initializedPromise;
  initializedPromise = (async () => {
    await DutyHolidaySnapshot.sync();
    const rows = await DutyHolidaySnapshot.findAll();
    rows.forEach(row => {
      const status = statusFromRow(row);
      if (status) statusCache.set(status.year, status);
      try {
        const snapshot = snapshotFromRow(row);
        if (snapshot) snapshotCache.set(snapshot.year, snapshot);
      } catch (error) {
        console.warn(`[HolidaySync] 忽略损坏的 ${row.calendar_year} 年数据库快照：${error.message}`);
      }
    });

    const directory = path.join(__dirname, '..', 'data', 'holidays');
    if (fs.existsSync(directory)) {
      const files = fs.readdirSync(directory).filter(name => /^\d{4}\.json$/.test(name));
      for (const name of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
          const snapshot = normalizeSnapshot(raw);
          if (!snapshotCache.has(snapshot.year)) await persistReadySnapshot(snapshot);
        } catch (error) {
          console.warn(`[HolidaySync] 忽略损坏的内置快照 ${name}：${error.message}`);
        }
      }
    }
  })();
  return initializedPromise;
}

async function ensureOfficialHolidaySnapshot(yearValue, options = {}) {
  const year = assertSupportedYear(yearValue);
  await initializeOfficialHolidaySnapshots();
  const current = snapshotCache.get(year) || null;
  if (current && !options.force) return current;
  const status = statusCache.get(year);
  const nextRetry = status?.next_retry_at ? new Date(status.next_retry_at).getTime() : 0;
  if (!options.force && nextRetry > Date.now()) return current;
  return syncOfficialHolidaySnapshot(year, options);
}

function getCachedOfficialHolidaySnapshot(yearValue) {
  const year = assertSupportedYear(yearValue);
  return snapshotCache.get(year) || null;
}

function getOfficialHolidaySyncStatus(yearValue) {
  const year = assertSupportedYear(yearValue);
  return statusCache.get(year) || {
    year,
    status: snapshotCache.has(year) ? 'ready' : 'not_checked',
    last_checked_at: null,
    next_retry_at: null,
    error_message: '',
    source_url: snapshotCache.get(year)?.source_url || '',
    source_version: snapshotCache.get(year)?.version || ''
  };
}

function setSnapshotUpdatedHook(handler) {
  snapshotUpdatedHook = typeof handler === 'function' ? handler : null;
}

function isEmbeddedSeedVersion(value) {
  return /^gov-cn-\d{4}-v\d+$/i.test(String(value || ''));
}

function startOfficialHolidaySyncScheduler() {
  if (schedulerTimer || process.env.HOLIDAY_SYNC_DISABLED === '1') return;
  const run = async () => {
    const currentYear = new Date().getFullYear();
    for (const year of [currentYear, currentYear + 1]) {
      try {
        const status = getOfficialHolidaySyncStatus(year);
        const lastCheckedAt = status.last_checked_at ? new Date(status.last_checked_at).getTime() : 0;
        const nextRetryAt = status.next_retry_at ? new Date(status.next_retry_at).getTime() : 0;
        const retryIsDue = !nextRetryAt || nextRetryAt <= Date.now();
        const shouldRefreshReady = retryIsDue && (
          status.status === 'refresh_failed' ||
          (status.status === 'ready' && (
            isEmbeddedSeedVersion(status.source_version) || Date.now() - lastCheckedAt >= READY_REFRESH_MS
          ))
        );
        await ensureOfficialHolidaySnapshot(year, { force: shouldRefreshReady });
      } catch (error) {
        console.warn(`[HolidaySync] ${year} 年自动同步失败：${error.message}`);
      }
    }
  };
  setTimeout(run, 2000).unref?.();
  schedulerTimer = setInterval(run, SYNC_INTERVAL_MS);
  schedulerTimer.unref?.();
}

module.exports = {
  MAX_YEAR,
  MIN_YEAR,
  discoverOfficialHolidayDocument,
  discoverOfficialHolidayAmendments,
  ensureOfficialHolidaySnapshot,
  getCachedOfficialHolidaySnapshot,
  getOfficialHolidaySyncStatus,
  initializeOfficialHolidaySnapshots,
  isAllowedOfficialUrl,
  normalizeSnapshot,
  parseOfficialHolidayDocument,
  applyOfficialHolidayAmendments,
  setSnapshotUpdatedHook,
  startOfficialHolidaySyncScheduler,
  syncOfficialHolidaySnapshot,
  __internals: {
    adjustedDatesFromSection,
    checksumDays,
    compactText,
    holidayRangeFromSentence,
    normalizeOfficialDays,
    snapshotCache,
    statusCache
  }
};
