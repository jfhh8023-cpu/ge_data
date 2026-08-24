const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  sequelize,
  AutoTaskRule,
  AutoTaskRunLog,
  Staff,
  DutyCalendarRevision,
  DutyScheduleException,
  DutyScheduleSwap,
  DutySpecialNotificationLog
} = require('../models');
const { isNonResigned } = require('./PersonStatusService');
const {
  MAX_YEAR,
  MIN_YEAR,
  ensureOfficialHolidaySnapshot,
  getCachedOfficialHolidaySnapshot,
  getOfficialHolidaySyncStatus,
  initializeOfficialHolidaySnapshots,
  setSnapshotUpdatedHook
} = require('./OfficialHolidaySyncService');
const {
  addDays,
  dateFromYmd,
  dateToYmd,
  getBeijingDate,
  getBeijingParts,
  getMonday,
  getWeekdayNumber
} = require('../utils/beijingTime');

const TASK_TYPE_DUTY_NOTIFY = 'duty_notify';
const WEEKLY_DUTY_MODE_ROTATION = 'rotation';
const DUTY_SEND_MODE_BOTH = 'start_and_end';
const OVERRIDE_MANUAL_SKIP = 'manual_skip';
const OVERRIDE_FORCE_WORK = 'force_work';
const NOTICE_AT_MODES = new Set(['none', 'people', 'all']);
const ACTIVE_STATUS = 'active';
const CANCELLED_STATUS = 'cancelled';
const MAX_PREVIEW_DAYS = 400;
const MAX_YEAR_RECORDS = 366;
const MAX_STAFF_PER_DATE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const RUNTIME_CACHE_TTL_MS = 5000;
const RUNTIME_CACHE_LIMIT = 100;
const resolvedDutyDateCache = new Map();
const nextDutyRunCache = new Map();
const calendarRevisionYearCache = new Map();
const globalCalendarDayCache = new Map();
let resolverCacheGeneration = 0;

function readRuntimeCache(cache, key, now = Date.now()) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires_at <= now) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeRuntimeCache(cache, key, value, now = Date.now()) {
  if (cache.size >= RUNTIME_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { value, expires_at: now + RUNTIME_CACHE_TTL_MS });
  return value;
}

function ruleCacheStamp(rule) {
  const updatedAt = rule?.updated_at || rule?.updatedAt;
  const timestamp = updatedAt ? new Date(updatedAt).getTime() : 0;
  return `${rule?.id || ''}:${Number.isFinite(timestamp) ? timestamp : 0}`;
}

function invalidateResolverCache() {
  resolverCacheGeneration += 1;
  resolvedDutyDateCache.clear();
  nextDutyRunCache.clear();
  calendarRevisionYearCache.clear();
  globalCalendarDayCache.clear();
}

setSnapshotUpdatedHook(() => invalidateResolverCache());

function httpError(message, status = 400, code = 'invalid_duty_calendar_request') {
  const error = new Error(message);
  error.status = status;
  error.reason = code;
  return error;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function uniqueStrings(value) {
  const source = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(source)) return [];
  return [...new Set(source.map(item => String(item || '').trim()).filter(Boolean))];
}

function normalizeTime(value, fallback = '09:00:00') {
  const text = String(value || '').trim();
  if (/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(text)) return text;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return `${text}:00`;
  return fallback;
}

function isValidYmd(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  try {
    return dateToYmd(dateFromYmd(text)) === text;
  } catch {
    return false;
  }
}

function assertYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw httpError(`年份必须在 ${MIN_YEAR} 至 ${MAX_YEAR} 之间`);
  }
  return year;
}

function yearStart(year) {
  return `${year}-01-01`;
}

function yearEnd(year) {
  return `${year}-12-31`;
}

function daysBetween(from, to) {
  return Math.floor((dateFromYmd(to).getTime() - dateFromYmd(from).getTime()) / DAY_MS) + 1;
}

function dateRange(from, to) {
  const result = [];
  const count = daysBetween(from, to);
  for (let offset = 0; offset < count; offset += 1) {
    result.push(dateToYmd(addDays(from, offset)));
  }
  return result;
}

function normalizeDutyItem(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled === true,
    staff_ids: uniqueStrings(source.staff_ids),
    start_time: normalizeTime(source.start_time, '09:00:00'),
    end_time: normalizeTime(source.end_time, '18:30:00'),
    send_mode: source.send_mode === DUTY_SEND_MODE_BOTH ? DUTY_SEND_MODE_BOTH : 'start_only',
    start_message: String(source.start_message || '').trim(),
    end_message: String(source.end_message || '').trim()
  };
}

function normalizeDutyDayMap(value, min, max) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  Object.entries(source).forEach(([key, item]) => {
    const day = Number(key);
    if (Number.isInteger(day) && day >= min && day <= max) {
      result[String(day)] = normalizeDutyItem(item);
    }
  });
  return result;
}

function normalizeWeeklyRotationConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawStart = String(source.start_date || '').slice(0, 10);
  const endWeekday = Number(source.end_weekday);
  return {
    staff_ids: uniqueStrings(source.staff_ids),
    end_weekday: Number.isInteger(endWeekday) && endWeekday >= 1 && endWeekday <= 7 ? endWeekday : 5,
    start_date: isValidYmd(rawStart) ? rawStart : dateToYmd(getMonday(getBeijingDate()))
  };
}

function normalizeWeeklyDutyVersion(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const effectiveDate = String(source.effective_date || '').slice(0, 10);
  if (!isValidYmd(effectiveDate)) return null;
  return {
    effective_date: effectiveDate,
    weekly: normalizeDutyDayMap(source.weekly, 1, 7),
    weekly_mode: source.weekly_mode === WEEKLY_DUTY_MODE_ROTATION ? WEEKLY_DUTY_MODE_ROTATION : 'fixed',
    weekly_rotation: normalizeWeeklyRotationConfig(source.weekly_rotation)
  };
}

function normalizeDutyConfig(value) {
  const source = parseJson(value, {});
  const raw = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const weekly = normalizeDutyDayMap(raw.weekly, 1, 7);
  const weeklyMode = raw.weekly_mode === WEEKLY_DUTY_MODE_ROTATION ? WEEKLY_DUTY_MODE_ROTATION : 'fixed';
  const weeklyRotation = normalizeWeeklyRotationConfig(raw.weekly_rotation);
  const versionsByDate = new Map();
  (Array.isArray(raw.weekly_versions) ? raw.weekly_versions : []).forEach(valueItem => {
    const item = normalizeWeeklyDutyVersion(valueItem);
    if (item) versionsByDate.set(item.effective_date, item);
  });
  const weeklyVersions = [...versionsByDate.values()].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  if (weeklyVersions.length > 0 && weeklyVersions[0].effective_date !== '1900-01-01') {
    weeklyVersions.unshift({
      effective_date: '1900-01-01',
      weekly,
      weekly_mode: weeklyMode,
      weekly_rotation: weeklyRotation
    });
  }
  return {
    weekly,
    monthly: normalizeDutyDayMap(raw.monthly, 1, 31),
    weekly_mode: weeklyMode,
    weekly_rotation: weeklyRotation,
    weekly_versions: weeklyVersions
  };
}

function resolveWeeklyProfile(configValue, ymd) {
  const config = normalizeDutyConfig(configValue);
  let result = {
    weekly: config.weekly,
    weekly_mode: config.weekly_mode,
    weekly_rotation: config.weekly_rotation
  };
  config.weekly_versions.forEach(version => {
    if (version.effective_date <= ymd) result = version;
  });
  return result;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function legacyRotationIndex(rotationValue, ymd) {
  const rotation = normalizeWeeklyRotationConfig(rotationValue);
  if (rotation.staff_ids.length === 0) return -1;
  const current = dateFromYmd(ymd);
  const anchor = dateFromYmd(rotation.start_date);
  const diffDays = Math.floor((current.getTime() - anchor.getTime()) / DAY_MS);
  if (diffDays < 0) return -1;
  const fullWeeks = Math.floor(diffDays / 7);
  let slotCount = fullWeeks * rotation.end_weekday;
  for (let offset = fullWeeks * 7; offset <= diffDays; offset += 1) {
    if (getWeekdayNumber(addDays(anchor, offset)) <= rotation.end_weekday) slotCount += 1;
  }
  return slotCount > 0 ? positiveModulo(slotCount - 1, rotation.staff_ids.length) : -1;
}

function dutyItemConfigured(item) {
  const normalized = normalizeDutyItem(item);
  return Boolean(normalized.enabled && normalized.staff_ids.length && normalized.start_message);
}

function rawDutyItemForDate(ruleValue, ymd) {
  const rule = ruleValue?.toJSON ? ruleValue.toJSON() : ruleValue;
  const config = normalizeDutyConfig(rule?.duty_config);
  if (rule?.schedule_type === 'monthly') {
    if (rule.schedule_year && Number(rule.schedule_year) !== Number(ymd.slice(0, 4))) return null;
    return config.monthly[String(Number(ymd.slice(8, 10)))] || null;
  }
  const profile = resolveWeeklyProfile(config, ymd);
  const weekday = getWeekdayNumber(ymd);
  const baseItem = normalizeDutyItem(profile.weekly[String(weekday)] || {});
  if (profile.weekly_mode !== WEEKLY_DUTY_MODE_ROTATION) return baseItem;
  if (weekday > profile.weekly_rotation.end_weekday) return null;
  const index = legacyRotationIndex(profile.weekly_rotation, ymd);
  const staffId = index >= 0 ? profile.weekly_rotation.staff_ids[index] : '';
  return normalizeDutyItem({
    ...baseItem,
    enabled: Boolean(staffId && baseItem.start_message),
    staff_ids: staffId ? [staffId] : []
  });
}

function loadOfficialHolidaySnapshot(yearValue) {
  const year = assertYear(yearValue);
  return getCachedOfficialHolidaySnapshot(year);
}

function normalizeOverrideMap(value, yearValue) {
  const year = assertYear(yearValue);
  const source = parseJson(value, {});
  const result = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
  const entries = Object.entries(source);
  if (entries.length > MAX_YEAR_RECORDS) throw httpError(`单年日期覆盖不能超过 ${MAX_YEAR_RECORDS} 条`);
  entries.forEach(([date, rawMode]) => {
    const mode = typeof rawMode === 'object' ? rawMode?.mode : rawMode;
    if (
      isValidYmd(date) &&
      Number(date.slice(0, 4)) === year &&
      [OVERRIDE_MANUAL_SKIP, OVERRIDE_FORCE_WORK].includes(mode)
    ) {
      result[date] = mode;
    }
  });
  return result;
}

function normalizeRevision(row) {
  if (!row) return null;
  const plain = row.toJSON ? row.toJSON() : row;
  const year = Number(plain.calendar_year);
  const snapshot = loadOfficialHolidaySnapshot(year);
  return {
    id: plain.id || `draft-${year}`,
    calendar_year: year,
    revision_no: Number(plain.revision_no) || 0,
    effective_from: String(plain.effective_from || yearStart(year)).slice(0, 10),
    source_title: snapshot?.source_title || plain.source_title || '',
    source_url: snapshot?.source_url || plain.source_url || '',
    source_version: snapshot?.version || plain.source_version || '',
    source_verified_at: snapshot?.verified_at || plain.source_verified_at || null,
    official_days: snapshot?.days || (Array.isArray(plain.official_days)
      ? plain.official_days
      : parseJson(plain.official_days, [])),
    manual_overrides: normalizeOverrideMap(plain.manual_overrides, year),
    is_active: plain.is_active !== false,
    created_at: plain.created_at || null,
    updated_at: plain.updated_at || null
  };
}

function officialDayMap(revision) {
  return new Map((revision?.official_days || []).map(day => [day.date, day]));
}

function deriveCalendarDay(ymd, revision, rule = null) {
  const official = officialDayMap(revision).get(ymd) || null;
  const weekday = getWeekdayNumber(ymd);
  const isWeekend = weekday >= 6;
  const isHoliday = official?.is_holiday === true;
  const isAdjustedWorkday = official?.is_adjusted_workday === true;
  const override = revision?.manual_overrides?.[ymd] || '';
  const defaultSkipped = isHoliday || (isWeekend && !isAdjustedWorkday);
  const effectiveSkipped = override === OVERRIDE_FORCE_WORK
    ? false
    : (override === OVERRIDE_MANUAL_SKIP ? true : defaultSkipped);
  const reasons = [];
  if (isHoliday) reasons.push('法定节假日');
  if (isWeekend && !isAdjustedWorkday) reasons.push('周末');
  if (isAdjustedWorkday) reasons.push('官方补班工作日');
  if (override === OVERRIDE_MANUAL_SKIP) reasons.push('手动停排');
  if (override === OVERRIDE_FORCE_WORK) reasons.push('已取消默认停排');
  return {
    date: ymd,
    year: Number(ymd.slice(0, 4)),
    month: Number(ymd.slice(5, 7)),
    day: Number(ymd.slice(8, 10)),
    weekday,
    is_weekend: isWeekend,
    is_official_holiday: isHoliday,
    is_adjusted_workday: isAdjustedWorkday,
    holiday_name: official?.holiday_name || '',
    holiday_range_id: official?.range_id || '',
    default_skipped: defaultSkipped,
    override_mode: override,
    effective_skipped: effectiveSkipped,
    skip_reasons: reasons,
    configured: rule ? (
      dutyItemConfigured(rawDutyItemForDate(rule, ymd)) ||
      (isAdjustedWorkday && ruleHasConfiguredSourceForDate(rule, ymd))
    ) : null
  };
}

function normalizeException(value, ruleId = '') {
  const plain = value?.toJSON ? value.toJSON() : (value || {});
  const date = String(plain.calendar_date || plain.date || '').slice(0, 10);
  return {
    id: plain.id || '',
    rule_id: String(plain.rule_id || ruleId || '').trim(),
    calendar_date: date,
    skip_staff_ids: uniqueStrings(plain.skip_staff_ids),
    notice_enabled: plain.notice_enabled === true,
    notice_time: normalizeTime(plain.notice_time, '09:00:00'),
    notice_message: String(plain.notice_message || '').trim().slice(0, 5000),
    notice_at_mode: NOTICE_AT_MODES.has(plain.notice_at_mode) ? plain.notice_at_mode : 'none',
    notice_staff_ids: uniqueStrings(plain.notice_staff_ids),
    notice_webhook_ids: uniqueStrings(plain.notice_webhook_ids),
    status: plain.status === CANCELLED_STATUS ? CANCELLED_STATUS : ACTIVE_STATUS,
    revision: Number(plain.revision) || 1,
    created_at: plain.created_at || null,
    updated_at: plain.updated_at || null
  };
}

function normalizeSwap(value, ruleId = '') {
  const plain = value?.toJSON ? value.toJSON() : (value || {});
  let dateA = String(plain.date_a || '').slice(0, 10);
  let dateB = String(plain.date_b || '').slice(0, 10);
  let staffA = String(plain.staff_a_id || '').trim();
  let staffB = String(plain.staff_b_id || '').trim();
  if (dateA && dateB && dateA > dateB) {
    [dateA, dateB] = [dateB, dateA];
    [staffA, staffB] = [staffB, staffA];
  }
  return {
    id: plain.id || '',
    rule_id: String(plain.rule_id || ruleId || '').trim(),
    date_a: dateA,
    date_b: dateB,
    staff_a_id: staffA,
    staff_b_id: staffB,
    status: plain.status === CANCELLED_STATUS ? CANCELLED_STATUS : ACTIVE_STATUS,
    revision: Number(plain.revision) || 1,
    created_at: plain.created_at || null,
    updated_at: plain.updated_at || null
  };
}

async function ensureDutyCalendarTables() {
  await initializeOfficialHolidaySnapshots();
  await DutyCalendarRevision.sync();
  await DutyScheduleException.sync();
  await DutyScheduleSwap.sync();
  await DutySpecialNotificationLog.sync();
}

async function requireDutyRule(ruleId, transaction = null) {
  const rule = await AutoTaskRule.findByPk(ruleId, { transaction });
  if (!rule) throw httpError('自动值班规则不存在', 404, 'duty_rule_not_found');
  if (String(rule.task_type) !== TASK_TYPE_DUTY_NOTIFY) {
    throw httpError('所选规则不是自动值班通知', 400, 'not_duty_rule');
  }
  return rule;
}

async function loadRevisions(yearValue, transaction = null) {
  const year = assertYear(yearValue);
  const rows = await DutyCalendarRevision.findAll({
    where: { calendar_year: year },
    order: [['effective_from', 'ASC'], ['revision_no', 'ASC']],
    transaction
  });
  return rows.map(normalizeRevision);
}

async function loadRevisionsCached(yearValue, now = Date.now()) {
  const year = assertYear(yearValue);
  const key = `${resolverCacheGeneration}:${year}`;
  const cached = readRuntimeCache(calendarRevisionYearCache, key, now);
  if (cached !== undefined) return cached;
  const revisions = await loadRevisions(year);
  return writeRuntimeCache(calendarRevisionYearCache, key, revisions, now);
}

function latestRevision(revisions) {
  return [...revisions].sort((a, b) => b.revision_no - a.revision_no)[0] || null;
}

function revisionForDate(revisions, ymd) {
  let selected = null;
  revisions.forEach(revision => {
    if (revision.effective_from <= ymd) {
      if (
        !selected ||
        revision.effective_from > selected.effective_from ||
        (revision.effective_from === selected.effective_from && revision.revision_no > selected.revision_no)
      ) {
        selected = revision;
      }
    }
  });
  return selected;
}

function contextRevisionForDate(context, ymd) {
  const revisions = context.revisionsByYear.get(Number(ymd.slice(0, 4))) || [];
  return revisionForDate(revisions, ymd);
}

async function getGlobalCalendarDay(ymd) {
  if (!isValidYmd(ymd)) throw httpError('日期格式无效');
  const now = Date.now();
  const key = `${resolverCacheGeneration}:${ymd}`;
  const cached = readRuntimeCache(globalCalendarDayCache, key, now);
  if (cached !== undefined) return cached;

  const year = Number(ymd.slice(0, 4));
  const revisions = await loadRevisionsCached(year, now);
  const revision = revisionForDate(revisions, ymd);
  if (!revision) {
    const snapshot = loadOfficialHolidaySnapshot(year);
    const metadata = deriveCalendarDay(ymd, {
      official_days: snapshot?.days || [],
      manual_overrides: {}
    });
    return writeRuntimeCache(globalCalendarDayCache, key, {
      ...metadata,
      calendar_active: false,
      effective_skipped: false,
      skip_reasons: [],
      revision_id: null,
      revision_no: 0
    }, now);
  }

  return writeRuntimeCache(globalCalendarDayCache, key, {
    ...deriveCalendarDay(ymd, revision),
    calendar_active: true,
    revision_id: revision.id,
    revision_no: revision.revision_no
  }, now);
}

async function getNextGlobalWorkDate(from, maxDays = MAX_PREVIEW_DAYS) {
  if (!isValidYmd(from)) throw httpError('日期格式无效');
  for (let offset = 0; offset <= maxDays; offset += 1) {
    const candidate = dateToYmd(addDays(from, offset));
    const day = await getGlobalCalendarDay(candidate);
    if (!day.effective_skipped) return candidate;
  }
  return null;
}

async function getGlobalScheduleSourceDates(targetDate, maxDays = MAX_PREVIEW_DAYS) {
  if (!isValidYmd(targetDate)) throw httpError('日期格式无效');
  const target = await getGlobalCalendarDay(targetDate);
  if (target.effective_skipped) return [];

  const dates = [targetDate];
  for (let offset = 1; offset <= maxDays; offset += 1) {
    const candidate = dateToYmd(addDays(targetDate, -offset));
    const day = await getGlobalCalendarDay(candidate);
    if (!day.effective_skipped) break;
    dates.unshift(candidate);
  }
  return dates;
}

async function suggestedEffectiveFrom(rule, yearValue) {
  const year = assertYear(yearValue);
  const today = dateToYmd(getBeijingDate());
  const todayYear = Number(today.slice(0, 4));
  const scanFrom = year === todayYear ? today : yearStart(year);
  const scanTo = yearEnd(year);
  const now = new Date();
  for (const date of dateRange(scanFrom, scanTo)) {
    const item = rawDutyItemForDate(rule, date);
    if (!dutyItemConfigured(item)) continue;
    const scheduled = new Date(`${date}T${item.start_time}+08:00`);
    if (year !== todayYear || scheduled > now) return date;
  }
  return year === todayYear ? today : yearStart(year);
}

function serializeStaff(staff) {
  const plain = staff?.toJSON ? staff.toJSON() : staff;
  return plain ? {
    id: plain.id,
    name: plain.name,
    role: plain.role,
    employment_status: plain.employment_status || (plain.is_active === false ? 'resigned' : 'active')
  } : null;
}

async function getDutyCalendar({ year: yearValue, ruleId }) {
  const year = assertYear(yearValue);
  await ensureOfficialHolidaySnapshot(year);
  const rule = await requireDutyRule(ruleId);
  const [revisions, exceptions, swaps, staff] = await Promise.all([
    loadRevisions(year),
    DutyScheduleException.findAll({
      where: {
        rule_id: rule.id,
        calendar_date: { [Op.between]: [yearStart(year), yearEnd(year)] },
        status: ACTIVE_STATUS
      },
      order: [['calendar_date', 'ASC']]
    }),
    DutyScheduleSwap.findAll({
      where: {
        rule_id: rule.id,
        status: ACTIVE_STATUS,
        [Op.or]: [
          { date_a: { [Op.between]: [yearStart(year), yearEnd(year)] } },
          { date_b: { [Op.between]: [yearStart(year), yearEnd(year)] } }
        ]
      },
      order: [['date_a', 'ASC'], ['date_b', 'ASC']]
    }),
    Staff.findAll({ order: [['sort_order', 'ASC'], ['created_at', 'ASC']] })
  ]);
  const snapshot = loadOfficialHolidaySnapshot(year);
  const latest = latestRevision(revisions);
  const suggested = await suggestedEffectiveFrom(rule, year);
  const displayRevision = latest || normalizeRevision({
    id: '',
    calendar_year: year,
    revision_no: 0,
    effective_from: suggested,
    official_days: snapshot?.days || [],
    manual_overrides: {},
    source_title: snapshot?.source_title || '',
    source_url: snapshot?.source_url || '',
    source_version: snapshot?.version || '',
    source_verified_at: snapshot?.verified_at || null,
    is_active: false
  });
  const days = dateRange(yearStart(year), yearEnd(year))
    .map(date => deriveCalendarDay(date, displayRevision, rule));
  return {
    year,
    revision: displayRevision,
    revision_no: displayRevision.revision_no,
    feature_active: revisions.length > 0,
    first_effective_from: revisions[0]?.effective_from || suggested,
    official_data_available: Boolean(snapshot),
    holiday_sync: getOfficialHolidaySyncStatus(year),
    suggested_effective_from: suggested,
    days,
    exceptions: exceptions.map(row => normalizeException(row, rule.id)),
    swaps: swaps.map(row => normalizeSwap(row, rule.id)),
    staff: staff.filter(isNonResigned).map(serializeStaff)
  };
}

async function loadResolverContext(rule, from, to, draft = null) {
  const startYear = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
  const revisionsByYear = new Map();
  for (const year of years) {
    await ensureOfficialHolidaySnapshot(year);
    revisionsByYear.set(year, await loadRevisions(year));
  }
  const draftCalendar = draft?.calendar_revision || draft?.calendar || null;
  if (draftCalendar) {
    const year = assertYear(draftCalendar.calendar_year || draftCalendar.year || from.slice(0, 4));
    const revisions = revisionsByYear.get(year) || [];
    const current = latestRevision(revisions);
    const snapshot = loadOfficialHolidaySnapshot(year);
    revisions.push(normalizeRevision({
      id: `draft-${year}`,
      calendar_year: year,
      revision_no: (current?.revision_no || 0) + 1,
      effective_from: draftCalendar.effective_from,
      official_days: snapshot?.days || [],
      manual_overrides: draftCalendar.manual_overrides || {},
      source_title: snapshot?.source_title || '',
      source_url: snapshot?.source_url || '',
      source_version: snapshot?.version || '',
      source_verified_at: snapshot?.verified_at || null,
      is_active: true
    }));
    revisionsByYear.set(year, revisions);
  }

  let exceptions;
  if (Array.isArray(draft?.exceptions)) {
    exceptions = draft.exceptions.map(value => normalizeException(value, rule.id)).filter(item => item.status === ACTIVE_STATUS);
  } else {
    const rows = await DutyScheduleException.findAll({ where: { rule_id: rule.id, status: ACTIVE_STATUS } });
    exceptions = rows.map(row => normalizeException(row, rule.id));
  }
  let swaps;
  if (Array.isArray(draft?.swaps)) {
    swaps = draft.swaps.map(value => normalizeSwap(value, rule.id)).filter(item => item.status === ACTIVE_STATUS);
  } else {
    const rows = await DutyScheduleSwap.findAll({ where: { rule_id: rule.id, status: ACTIVE_STATUS } });
    swaps = rows.map(row => normalizeSwap(row, rule.id));
  }
  const staffRows = await Staff.findAll({ order: [['sort_order', 'ASC'], ['created_at', 'ASC']] });
  const staffMap = new Map(staffRows.map(staff => [String(staff.id), staff]));
  const exceptionMap = new Map(exceptions.map(item => [item.calendar_date, item]));
  return { revisionsByYear, exceptions, exceptionMap, swaps, staffMap };
}

function buildDutyEvents(date, item) {
  if (!item?.enabled || !item.staff_ids?.length) return [];
  const events = [];
  if (item.start_message) {
    events.push({
      kind: 'start',
      scheduled_at: new Date(`${date}T${item.start_time}+08:00`).toISOString(),
      message: item.start_message,
      staff_ids: item.staff_ids
    });
  }
  if (item.send_mode === DUTY_SEND_MODE_BOTH && item.end_message) {
    events.push({
      kind: 'end',
      scheduled_at: new Date(`${date}T${item.end_time}+08:00`).toISOString(),
      message: item.end_message,
      staff_ids: item.staff_ids
    });
  }
  return events;
}

function ruleHasConfiguredSourceForDate(rule, ymd) {
  const config = normalizeDutyConfig(rule?.duty_config);
  if (rule?.schedule_type === 'monthly') {
    if (rule.schedule_year && Number(rule.schedule_year) !== Number(ymd.slice(0, 4))) return false;
    return Object.values(config.monthly).some(dutyItemConfigured);
  }
  const profile = resolveWeeklyProfile(config, ymd);
  return Object.values(profile.weekly).some(item => {
    const normalized = normalizeDutyItem(item);
    if (profile.weekly_mode !== WEEKLY_DUTY_MODE_ROTATION) return dutyItemConfigured(normalized);
    return Boolean(normalized.enabled && normalized.start_message && profile.weekly_rotation.staff_ids.length);
  });
}

function emptyScheduleResult(date, calendarDay, configured, reason) {
  return {
    date,
    configured,
    whole_day_skipped: Boolean(calendarDay?.effective_skipped),
    skip_reasons: reason ? [reason] : (calendarDay?.skip_reasons || []),
    base_staff_ids: [],
    skipped_staff_ids: [],
    replacement_staff_ids: [],
    swapped_staff_ids: [],
    final_staff_ids: [],
    source_date: null,
    item: null,
    events: [],
    warnings: []
  };
}

function activeStaffIds(ids, staffMap) {
  return uniqueStrings(ids).filter(id => isNonResigned(staffMap.get(String(id))));
}

function simulateRevisionSegment(rule, revision, segmentEnd, context) {
  const start = revision.effective_from;
  const endOfYear = yearEnd(Number(start.slice(0, 4)));
  const sourceUnits = dateRange(start, endOfYear)
    .map(date => ({ date, item: normalizeDutyItem(rawDutyItemForDate(rule, date) || {}) }))
    .filter(unit => dutyItemConfigured(unit.item));
  const results = new Map();
  let sourceCursor = 0;
  for (const date of dateRange(start, segmentEnd)) {
    const rawDestination = rawDutyItemForDate(rule, date);
    const calendarDay = deriveCalendarDay(date, revision, rule);
    const configured = dutyItemConfigured(rawDestination) || (
      calendarDay.is_adjusted_workday && ruleHasConfiguredSourceForDate(rule, date)
    );
    if (!configured) {
      results.set(date, emptyScheduleResult(date, calendarDay, false, '规则未配置'));
      continue;
    }
    if (calendarDay.effective_skipped) {
      results.set(date, emptyScheduleResult(date, calendarDay, true, '整日停排'));
      continue;
    }
    const exception = context.exceptionMap.get(date) || normalizeException({ calendar_date: date }, rule.id);
    const skipIds = new Set(exception.skip_staff_ids.map(String));
    let unit = sourceUnits[sourceCursor] || null;
    if (unit) sourceCursor += 1;
    const originalBaseIds = unit ? activeStaffIds(unit.item.staff_ids, context.staffMap) : [];
    const replacementIds = [];
    const consumedSources = [];
    let available = [];
    let baseIds = [];
    while (unit) {
      consumedSources.push(unit.date);
      baseIds = activeStaffIds(unit.item.staff_ids, context.staffMap);
      available = baseIds.filter(id => !skipIds.has(String(id)));
      if (available.length > 0) break;
      const nextUnit = sourceUnits[sourceCursor] || null;
      if (!nextUnit) {
        unit = null;
        break;
      }
      unit = nextUnit;
      sourceCursor += 1;
      replacementIds.push(...activeStaffIds(unit.item.staff_ids, context.staffMap));
    }
    if (!unit || available.length === 0) {
      const result = emptyScheduleResult(date, calendarDay, true, '无人可补位');
      result.configured = true;
      result.whole_day_skipped = false;
      result.skipped_staff_ids = [...skipIds];
      result.warnings.push('所有可用排班单元均无人可补位');
      results.set(date, result);
      continue;
    }
    const finalItem = normalizeDutyItem({ ...unit.item, enabled: true, staff_ids: available });
    results.set(date, {
      date,
      configured: true,
      whole_day_skipped: false,
      skip_reasons: [],
      base_staff_ids: originalBaseIds,
      skipped_staff_ids: originalBaseIds.filter(id => skipIds.has(String(id))),
      replacement_staff_ids: uniqueStrings(replacementIds),
      swapped_staff_ids: [],
      final_staff_ids: available,
      source_date: unit.date,
      consumed_source_dates: consumedSources,
      item: finalItem,
      events: buildDutyEvents(date, finalItem),
      warnings: []
    });
  }
  return results;
}

function legacyScheduleResult(rule, date, context) {
  const item = normalizeDutyItem(rawDutyItemForDate(rule, date) || {});
  if (!dutyItemConfigured(item)) return emptyScheduleResult(date, null, false, '规则未配置');
  const validIds = activeStaffIds(item.staff_ids, context.staffMap);
  const finalItem = normalizeDutyItem({ ...item, enabled: validIds.length > 0, staff_ids: validIds });
  return {
    date,
    configured: true,
    whole_day_skipped: false,
    skip_reasons: [],
    base_staff_ids: validIds,
    skipped_staff_ids: [],
    replacement_staff_ids: [],
    swapped_staff_ids: [],
    final_staff_ids: validIds,
    source_date: date,
    item: finalItem,
    events: buildDutyEvents(date, finalItem),
    warnings: validIds.length ? [] : ['值班人员当前均不可用']
  };
}

function applySwaps(results, swaps, staffMap) {
  swaps.forEach(swap => {
    if (swap.status !== ACTIVE_STATUS) return;
    const left = results.get(swap.date_a);
    const right = results.get(swap.date_b);
    if (!left || !right) return;
    const leftIndex = left.final_staff_ids.indexOf(swap.staff_a_id);
    const rightIndex = right.final_staff_ids.indexOf(swap.staff_b_id);
    if (leftIndex < 0 || rightIndex < 0) {
      const warning = `临时换班 ${swap.date_a}/${swap.date_b} 的人员已不在基础排班中`;
      left.warnings.push(warning);
      right.warnings.push(warning);
      return;
    }
    if (!isNonResigned(staffMap.get(swap.staff_a_id)) || !isNonResigned(staffMap.get(swap.staff_b_id))) {
      const warning = '临时换班人员当前不可用，已回退基础排班';
      left.warnings.push(warning);
      right.warnings.push(warning);
      return;
    }
    left.final_staff_ids[leftIndex] = swap.staff_b_id;
    right.final_staff_ids[rightIndex] = swap.staff_a_id;
    left.swapped_staff_ids = uniqueStrings([...left.swapped_staff_ids, swap.staff_a_id, swap.staff_b_id]);
    right.swapped_staff_ids = uniqueStrings([...right.swapped_staff_ids, swap.staff_a_id, swap.staff_b_id]);
    left.item = normalizeDutyItem({ ...left.item, staff_ids: left.final_staff_ids });
    right.item = normalizeDutyItem({ ...right.item, staff_ids: right.final_staff_ids });
    left.events = buildDutyEvents(left.date, left.item);
    right.events = buildDutyEvents(right.date, right.item);
  });
}

function attachStaffDetails(result, staffMap) {
  return {
    ...result,
    base_staff: result.base_staff_ids.map(id => serializeStaff(staffMap.get(id))).filter(Boolean),
    final_staff: result.final_staff_ids.map(id => serializeStaff(staffMap.get(id))).filter(Boolean)
  };
}

function applyPresentationScheduleBeforeFirstEffective({
  rule,
  context,
  results,
  simulationFrom,
  simulationTo
}) {
  const startYear = Number(simulationFrom.slice(0, 4));
  const endYear = Number(simulationTo.slice(0, 4));
  for (let year = startYear; year <= endYear; year += 1) {
    const revisions = context.revisionsByYear.get(year) || [];
    if (revisions.length === 0) continue;
    const firstEffectiveFrom = revisions
      .map(revision => revision.effective_from)
      .sort()[0];
    const projectionTo = dateToYmd(addDays(firstEffectiveFrom, -1));
    if (projectionTo < yearStart(year) || projectionTo < simulationFrom) continue;

    const displayRevision = latestRevision(revisions);
    const presentationRevision = {
      ...displayRevision,
      id: `presentation-${year}`,
      effective_from: yearStart(year)
    };
    const projected = simulateRevisionSegment(
      rule,
      presentationRevision,
      projectionTo < simulationTo ? projectionTo : simulationTo,
      context
    );
    projected.forEach((value, date) => {
      if (date < simulationFrom || date > simulationTo || date >= firstEffectiveFrom) return;
      results.set(date, {
        ...value,
        presentation_only: true,
        runtime_effective_from: firstEffectiveFrom
      });
    });
  }
}

async function previewDutySchedule({
  ruleId,
  from,
  to,
  draft = null,
  presentationBeforeFirstEffective = false
}) {
  if (!isValidYmd(from) || !isValidYmd(to) || from > to) {
    throw httpError('预览日期范围无效');
  }
  const count = daysBetween(from, to);
  if (count > MAX_PREVIEW_DAYS) throw httpError(`单次最多预览 ${MAX_PREVIEW_DAYS} 天`);
  if (Array.isArray(draft?.exceptions) && draft.exceptions.length > MAX_YEAR_RECORDS) {
    throw httpError(`单年日期例外不能超过 ${MAX_YEAR_RECORDS} 条`);
  }
  if (Array.isArray(draft?.swaps) && draft.swaps.length > MAX_YEAR_RECORDS) {
    throw httpError(`单年临时换班不能超过 ${MAX_YEAR_RECORDS} 条`);
  }
  const rule = await requireDutyRule(ruleId);
  const context = await loadResolverContext(rule, from, to, draft);
  const expandedDates = [from, to];
  context.swaps.forEach(swap => {
    if (swap.date_a.slice(0, 4) === from.slice(0, 4)) expandedDates.push(swap.date_a);
    if (swap.date_b.slice(0, 4) === from.slice(0, 4)) expandedDates.push(swap.date_b);
  });
  const simulationFrom = expandedDates.sort()[0];
  const simulationTo = expandedDates.sort().at(-1);
  const allDates = dateRange(simulationFrom, simulationTo);
  const results = new Map();
  const segments = new Map();
  allDates.forEach(date => {
    const revisions = context.revisionsByYear.get(Number(date.slice(0, 4))) || [];
    const revision = revisionForDate(revisions, date);
    if (!revision) {
      results.set(date, legacyScheduleResult(rule, date, context));
      return;
    }
    if (!segments.has(revision.id)) segments.set(revision.id, { revision, lastDate: date });
    segments.get(revision.id).lastDate = date;
  });
  segments.forEach(({ revision, lastDate }) => {
    const segmentResults = simulateRevisionSegment(rule, revision, lastDate, context);
    segmentResults.forEach((value, key) => {
      if (key >= simulationFrom && key <= simulationTo && revisionForDate(
        context.revisionsByYear.get(Number(key.slice(0, 4))) || [], key
      )?.id === revision.id) {
        results.set(key, value);
      }
    });
  });
  if (presentationBeforeFirstEffective === true) {
    applyPresentationScheduleBeforeFirstEffective({
      rule,
      context,
      results,
      simulationFrom,
      simulationTo
    });
  }
  const activeCalendarSwaps = context.swaps.filter(swap => (
    contextRevisionForDate(context, swap.date_a) && contextRevisionForDate(context, swap.date_b)
  ));
  applySwaps(results, activeCalendarSwaps, context.staffMap);
  const requested = dateRange(from, to).map(date => attachStaffDetails(results.get(date), context.staffMap));
  const warnings = requested.flatMap(day => day.warnings.map(message => ({ date: day.date, message })));
  const conflicts = requested
    .filter(day => day.configured && !day.whole_day_skipped && day.final_staff_ids.length === 0)
    .map(day => ({ date: day.date, code: 'no_available_staff', message: '无人可补位' }));
  return {
    rule_id: rule.id,
    from,
    to,
    days: requested,
    warnings,
    conflicts,
    summary: {
      total_days: requested.length,
      configured_days: requested.filter(day => day.configured).length,
      whole_day_skipped: requested.filter(day => day.whole_day_skipped).length,
      person_skip_days: requested.filter(day => day.skipped_staff_ids.length > 0).length,
      swapped_days: requested.filter(day => day.swapped_staff_ids.length > 0).length
    }
  };
}

function validateExceptionPayloads(values, year, ruleId, staffMap) {
  if (Array.isArray(values) && values.length > MAX_YEAR_RECORDS) {
    throw httpError(`单年日期例外不能超过 ${MAX_YEAR_RECORDS} 条`);
  }
  const byDate = new Map();
  (Array.isArray(values) ? values : []).forEach(raw => {
    if (String(raw?.notice_message || '').length > 5000) {
      throw httpError('特殊通知内容不能超过 5000 个字符');
    }
    const item = normalizeException(raw, ruleId);
    if (!isValidYmd(item.calendar_date) || Number(item.calendar_date.slice(0, 4)) !== year) {
      throw httpError('日期例外包含无效日期');
    }
    if (item.notice_enabled && !item.notice_message) {
      throw httpError(`${item.calendar_date} 的特殊通知内容不能为空`);
    }
    if (item.notice_at_mode === 'people' && item.notice_staff_ids.length === 0) {
      throw httpError(`${item.calendar_date} 的特殊通知尚未选择 @ 人员`);
    }
    if (item.skip_staff_ids.length > MAX_STAFF_PER_DATE || item.notice_staff_ids.length > MAX_STAFF_PER_DATE) {
      throw httpError(`${item.calendar_date} 的人员数量超过系统上限`);
    }
    [...item.skip_staff_ids, ...item.notice_staff_ids].forEach(id => {
      if (!isNonResigned(staffMap.get(id))) throw httpError(`${item.calendar_date} 包含不可用人员`);
    });
    byDate.set(item.calendar_date, item);
  });
  return [...byDate.values()];
}

function validateSwapPayloads(values, year, ruleId, staffMap) {
  if (Array.isArray(values) && values.length > MAX_YEAR_RECORDS) {
    throw httpError(`单年临时换班不能超过 ${MAX_YEAR_RECORDS} 条`);
  }
  const result = [];
  const participation = new Set();
  (Array.isArray(values) ? values : []).forEach(raw => {
    const item = normalizeSwap(raw, ruleId);
    if (
      !isValidYmd(item.date_a) ||
      !isValidYmd(item.date_b) ||
      item.date_a === item.date_b ||
      Number(item.date_a.slice(0, 4)) !== year ||
      Number(item.date_b.slice(0, 4)) !== year
    ) {
      throw httpError('临时换班必须选择同一年内两个不同的有效日期');
    }
    if (!item.staff_a_id || !item.staff_b_id || item.staff_a_id === item.staff_b_id) {
      throw httpError('临时换班必须选择两名不同人员');
    }
    if (!isNonResigned(staffMap.get(item.staff_a_id)) || !isNonResigned(staffMap.get(item.staff_b_id))) {
      throw httpError('临时换班人员当前不可用');
    }
    [`${item.date_a}:${item.staff_a_id}`, `${item.date_b}:${item.staff_b_id}`].forEach(key => {
      if (participation.has(key)) throw httpError('同一日期同一人员只能参与一次临时换班');
      participation.add(key);
    });
    result.push(item);
  });
  return result;
}

async function saveDutyCalendar({ year: yearValue, ruleId, payload }) {
  const year = assertYear(yearValue);
  const effectiveFrom = String(payload?.effective_from || '').slice(0, 10);
  if (!isValidYmd(effectiveFrom) || Number(effectiveFrom.slice(0, 4)) !== year) {
    throw httpError('生效日期必须属于当前年份');
  }
  const rule = await requireDutyRule(ruleId);
  const [currentRevisions, staffRows] = await Promise.all([
    loadRevisions(year),
    Staff.findAll()
  ]);
  const current = latestRevision(currentRevisions);
  const clientRevision = Number(payload?.revision_no) || 0;
  if (clientRevision !== (current?.revision_no || 0)) {
    throw httpError('配置已被其他人更新，请刷新后重试', 409, 'duty_calendar_revision_conflict');
  }
  if (current && effectiveFrom < current.effective_from) {
    throw httpError(`新的生效日期不得早于当前修订 ${current.effective_from}`);
  }
  const snapshot = loadOfficialHolidaySnapshot(year);
  if (!snapshot) {
    throw httpError(
      '当年国家法定节假日数据尚未发布或尚未同步成功，暂不能保存生效',
      409,
      'official_holiday_data_unavailable'
    );
  }
  const overrides = normalizeOverrideMap(payload?.manual_overrides, year);
  const staffMap = new Map(staffRows.map(staff => [String(staff.id), staff]));
  const exceptions = validateExceptionPayloads(payload?.exceptions, year, rule.id, staffMap);
  const swaps = validateSwapPayloads(payload?.swaps, year, rule.id, staffMap);
  const calendarAppliesOn = date => effectiveFrom <= date || currentRevisions.some(revision => revision.effective_from <= date);
  exceptions.forEach(item => {
    if (item.skip_staff_ids.length > 0 && !calendarAppliesOn(item.calendar_date)) {
      throw httpError(`${item.calendar_date} 早于节假日排班规则生效日期，不能配置人员跳过`);
    }
  });
  swaps.forEach(item => {
    if (!calendarAppliesOn(item.date_a) || !calendarAppliesOn(item.date_b)) {
      throw httpError('临时换班日期必须处于节假日排班规则生效范围内');
    }
  });
  if (swaps.length > 0) {
    const successfulStarts = await AutoTaskRunLog.findAll({
      where: {
        rule_id: rule.id,
        event_type: 'duty_start',
        status: 'success',
        scheduled_at: {
          [Op.between]: [
            new Date(`${yearStart(year)}T00:00:00+08:00`),
            new Date(`${yearEnd(year)}T23:59:59+08:00`)
          ]
        }
      },
      attributes: ['scheduled_at']
    });
    const executedDates = new Set(successfulStarts.map(row => getBeijingParts(row.scheduled_at).date));
    swaps.forEach(item => {
      if (executedDates.has(item.date_a) || executedDates.has(item.date_b)) {
        throw httpError('已成功执行值班通知的日期不能新增或编辑临时换班', 409, 'duty_swap_already_executed');
      }
    });
  }
  const draft = {
    calendar_revision: { calendar_year: year, effective_from: effectiveFrom, manual_overrides: overrides },
    exceptions,
    swaps
  };
  const validationDates = [
    effectiveFrom,
    ...exceptions.filter(item => item.skip_staff_ids.length > 0).map(item => item.calendar_date),
    ...swaps.flatMap(item => [item.date_a, item.date_b])
  ];
  const previewFrom = validationDates.sort()[0];
  const preview = await previewDutySchedule({
    ruleId: rule.id,
    from: previewFrom,
    to: yearEnd(year),
    draft
  });
  if (preview.conflicts.length > 0) {
    throw httpError(`保存前发现 ${preview.conflicts.length} 个无人可补位日期，请调整后重试`, 400, 'duty_calendar_conflict');
  }
  const previewByDate = new Map(preview.days.map(day => [day.date, day]));
  exceptions.filter(item => item.skip_staff_ids.length > 0).forEach(item => {
    const day = previewByDate.get(item.calendar_date);
    if (!day?.configured || day.whole_day_skipped) {
      throw httpError(`${item.calendar_date} 不是可执行排班日，不能配置人员跳过`);
    }
  });
  swaps.forEach(item => {
    const left = previewByDate.get(item.date_a);
    const right = previewByDate.get(item.date_b);
    const leftApplied = left?.swapped_staff_ids?.includes(item.staff_a_id) && left.swapped_staff_ids.includes(item.staff_b_id);
    const rightApplied = right?.swapped_staff_ids?.includes(item.staff_a_id) && right.swapped_staff_ids.includes(item.staff_b_id);
    if (!leftApplied || !rightApplied) {
      throw httpError('临时换班双方必须位于两个未停排、已配置且人员匹配的日期', 400, 'duty_swap_conflict');
    }
  });
  const now = new Date();
  try {
    await sequelize.transaction(async transaction => {
      const locked = await DutyCalendarRevision.findOne({
        where: { calendar_year: year, is_active: true },
        order: [['revision_no', 'DESC']],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if ((Number(locked?.revision_no) || 0) !== clientRevision) {
        throw httpError('配置已被其他人更新，请刷新后重试', 409, 'duty_calendar_revision_conflict');
      }
      await DutyCalendarRevision.update(
        { is_active: false, updated_at: now },
        { where: { calendar_year: year, is_active: true }, transaction }
      );
      await DutyCalendarRevision.create({
        id: uuidv4(),
        calendar_year: year,
        revision_no: clientRevision + 1,
        effective_from: effectiveFrom,
        source_title: snapshot?.source_title || '',
        source_url: snapshot?.source_url || '',
        source_version: snapshot?.version || '',
        source_verified_at: snapshot?.verified_at ? new Date(snapshot.verified_at) : null,
        official_days: JSON.stringify(snapshot?.days || []),
        manual_overrides: JSON.stringify(overrides),
        audit_summary: JSON.stringify({
          rule_id: rule.id,
          override_count: Object.keys(overrides).length,
          exception_count: exceptions.length,
          swap_count: swaps.length
        }),
        is_active: true,
        created_at: now,
        updated_at: now
      }, { transaction });

      const existingExceptions = await DutyScheduleException.findAll({
        where: {
          rule_id: rule.id,
          calendar_date: { [Op.between]: [yearStart(year), yearEnd(year)] }
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const incomingDates = new Set(exceptions.map(item => item.calendar_date));
      for (const row of existingExceptions) {
        if (!incomingDates.has(String(row.calendar_date).slice(0, 10))) {
          await row.update({ status: CANCELLED_STATUS, revision: Number(row.revision || 0) + 1, updated_at: now }, { transaction });
        }
      }
      for (const item of exceptions) {
        const row = existingExceptions.find(value => String(value.calendar_date).slice(0, 10) === item.calendar_date);
        const values = {
          rule_id: rule.id,
          calendar_date: item.calendar_date,
          skip_staff_ids: JSON.stringify(item.skip_staff_ids),
          notice_enabled: item.notice_enabled,
          notice_time: item.notice_time,
          notice_message: item.notice_message,
          notice_at_mode: item.notice_at_mode,
          notice_staff_ids: JSON.stringify(item.notice_staff_ids),
          notice_webhook_ids: JSON.stringify([]),
          status: ACTIVE_STATUS,
          revision: Number(row?.revision || 0) + 1,
          updated_at: now
        };
        if (row) await row.update(values, { transaction });
        else await DutyScheduleException.create({ id: uuidv4(), ...values, created_at: now }, { transaction });
      }

      const existingSwaps = await DutyScheduleSwap.findAll({
        where: {
          rule_id: rule.id,
          [Op.or]: [
            { date_a: { [Op.between]: [yearStart(year), yearEnd(year)] } },
            { date_b: { [Op.between]: [yearStart(year), yearEnd(year)] } }
          ]
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const swapKey = value => {
        const item = normalizeSwap(value, rule.id);
        return [item.date_a, item.date_b, item.staff_a_id, item.staff_b_id].join(':');
      };
      const existingById = new Map(existingSwaps.map(row => [String(row.id), row]));
      const existingByNaturalKey = new Map(existingSwaps.map(row => [swapKey(row), row]));
      const matchedRows = swaps.map(item => (
        (item.id && existingById.get(String(item.id))) || existingByNaturalKey.get(swapKey(item)) || null
      ));
      const incomingIds = new Set(matchedRows.filter(Boolean).map(row => String(row.id)));
      for (const row of existingSwaps) {
        if (!incomingIds.has(String(row.id))) {
          await row.update({ status: CANCELLED_STATUS, revision: Number(row.revision || 0) + 1, updated_at: now }, { transaction });
        }
      }
      for (let index = 0; index < swaps.length; index += 1) {
        const item = swaps[index];
        const row = matchedRows[index];
        const values = {
          rule_id: rule.id,
          date_a: item.date_a,
          date_b: item.date_b,
          staff_a_id: item.staff_a_id,
          staff_b_id: item.staff_b_id,
          status: ACTIVE_STATUS,
          revision: Number(row?.revision || 0) + 1,
          updated_at: now
        };
        if (row) await row.update(values, { transaction });
        else await DutyScheduleSwap.create({ id: uuidv4(), ...values, created_at: now }, { transaction });
      }
    });
  } catch (error) {
    if (error?.name === 'SequelizeUniqueConstraintError') {
      throw httpError('配置已被其他人更新，请刷新后重试', 409, 'duty_calendar_revision_conflict');
    }
    throw error;
  }
  invalidateResolverCache();
  return getDutyCalendar({ year, ruleId: rule.id });
}

async function resolveDutyDate(ruleValue, ymd) {
  const rule = ruleValue?.toJSON ? ruleValue : await requireDutyRule(ruleValue.id || ruleValue);
  const cacheKey = `${resolverCacheGeneration}:${ruleCacheStamp(rule)}:${ymd}`;
  const cached = readRuntimeCache(resolvedDutyDateCache, cacheKey);
  if (cached !== undefined) return cached;
  const preview = await previewDutySchedule({ ruleId: rule.id, from: ymd, to: ymd });
  return writeRuntimeCache(resolvedDutyDateCache, cacheKey, preview.days[0]);
}

async function getNextDutyRunAt(ruleValue, now = new Date()) {
  const rule = ruleValue?.toJSON ? ruleValue : await requireDutyRule(ruleValue.id || ruleValue);
  if (!rule.enabled) return null;
  const nowTime = now.getTime();
  const timeBucket = Math.floor(nowTime / RUNTIME_CACHE_TTL_MS);
  const cacheKey = `${resolverCacheGeneration}:${ruleCacheStamp(rule)}:${timeBucket}`;
  const cached = readRuntimeCache(nextDutyRunCache, cacheKey, nowTime);
  if (cached !== undefined) return cached;
  const from = getBeijingParts(now).date;
  const to = dateToYmd(addDays(from, MAX_PREVIEW_DAYS - 1));
  const preview = await previewDutySchedule({ ruleId: rule.id, from, to });
  for (const day of preview.days) {
    const next = day.events
      .map(event => new Date(event.scheduled_at))
      .filter(date => date > now)
      .sort((a, b) => a - b)[0];
    if (next) return writeRuntimeCache(nextDutyRunCache, cacheKey, next, nowTime);
  }
  return writeRuntimeCache(nextDutyRunCache, cacheKey, null, nowTime);
}

async function hasSuccessfulDutyStart(ruleId, ymd) {
  const start = new Date(`${ymd}T00:00:00+08:00`);
  const end = new Date(`${ymd}T23:59:59+08:00`);
  const count = await AutoTaskRunLog.count({
    where: {
      rule_id: ruleId,
      event_type: 'duty_start',
      status: 'success',
      scheduled_at: { [Op.between]: [start, end] }
    }
  });
  return count > 0;
}

module.exports = {
  ACTIVE_STATUS,
  CANCELLED_STATUS,
  OVERRIDE_FORCE_WORK,
  OVERRIDE_MANUAL_SKIP,
  deriveCalendarDay,
  ensureDutyCalendarTables,
  getDutyCalendar,
  getGlobalCalendarDay,
  getGlobalScheduleSourceDates,
  getNextDutyRunAt,
  getNextGlobalWorkDate,
  hasSuccessfulDutyStart,
  invalidateResolverCache,
  loadOfficialHolidaySnapshot,
  normalizeDutyConfig,
  normalizeException,
  normalizeOverrideMap,
  normalizeSwap,
  previewDutySchedule,
  rawDutyItemForDate,
  resolveDutyDate,
  saveDutyCalendar,
  get resolverCacheGeneration() { return resolverCacheGeneration; }
};
