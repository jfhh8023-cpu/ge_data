const { getBeijingParts } = require('../utils/beijingTime');

const FULL_CREDIT_TITLES = Object.freeze(['请假', '培训', '公司会议', '出差', '团建']);
// Input validation is stricter than historical read normalization (which still accepts explicit 0%).
const VALID_PROGRESS = new Set([100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 1]);
const FULL_CREDIT_DEFAULT_PROGRESS = 100;
const TRADITIONAL_TO_SIMPLIFIED = { '請': '请', '訓': '训', '會': '会', '議': '议', '團': '团' };
const TRAILING_NON_HAN = /[^\u3400-\u4dbf\u4e00-\u9fff]+$/u;

/** REQ-071: the nearest Han text at the end of the title (after trailing digits/symbols/letters) decides. */
function fullCreditCategoryOf(record) {
  const raw = record !== null && typeof record === 'object' ? record.requirement_title ?? record.title ?? '' : record ?? '';
  const core = String(raw).trim().replace(TRAILING_NON_HAN, '').replace(/[\u8acb\u8a13\u6703\u8b70\u5718]/g, char => TRADITIONAL_TO_SIMPLIFIED[char]);
  if (!core) return null;
  return FULL_CREDIT_TITLES.find(title => core.endsWith(title)) || null;
}

function isFullCreditRecord(record) {
  return fullCreditCategoryOf(record) !== null;
}

/** Empty means the default 100; an explicit value must be a selectable progress. */
function fullCreditProgress(value, label = '记录') {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return FULL_CREDIT_DEFAULT_PROGRESS;
  const progress = normalizeProgress(value);
  if (progress === null || !VALID_PROGRESS.has(progress)) {
    const error = new Error(`${label}：交付进度请选择1%或10%至100%（每10%一档）`);
    error.status = 400;
    throw error;
  }
  return progress;
}

function normalizeProgress(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const progress = Number(value);
  return Number.isFinite(progress) && progress >= 0 && progress <= 100 ? progress : null;
}

function dateVersion(date = new Date()) {
  const { year, month, day } = getBeijingParts(date);
  return `v${String(year).slice(-2)}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

const fullCreditVersionKey = (title, version) => `${String(title || '').trim()}\u0000${String(version || '').trim().toLowerCase()}`;

/**
 * Only server-loaded saved data may supply the original date. A client version is honoured solely when it
 * names an existing saved (title, version) of the same author (REQ-070 carry-over), via options.allowedVersions.
 */
function normalizeFullCreditRecord(record, previous = null, now = new Date(), options = {}) {
  if (!isFullCreditRecord(record)) return record;
  const saved = previous?.toJSON ? previous.toJSON() : previous;
  const title = String(record.requirement_title).trim();
  let version = dateVersion(now);
  if (saved && isFullCreditRecord(saved)) {
    const savedVersion = String(saved.version || '').trim();
    if (/^v\d{6}$/i.test(savedVersion)) version = savedVersion.toLowerCase();
    else if (saved.created_at && Number.isFinite(new Date(saved.created_at).getTime())) version = dateVersion(new Date(saved.created_at));
  } else {
    const requested = String(record.version || '').trim().toLowerCase();
    if (/^v\d{6}$/.test(requested) && options.allowedVersions instanceof Set && options.allowedVersions.has(fullCreditVersionKey(title, requested))) version = requested;
  }
  const progress = normalizeProgress(record.delivery_progress);
  return { ...record, requirement_title: title, version,
    automatic_version_date: `20${version.slice(1, 3)}-${version.slice(3, 5)}-${version.slice(5, 7)}`,
    delivery_progress: progress === null ? FULL_CREDIT_DEFAULT_PROGRESS : progress,
    product_managers: [], demand_sources: [], demand_source_ids: [], demand_source_weights: {} };
}

function validateManualHours(record, label = '记录') {
  const value = record?.hours;
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === ''
      || !Number.isFinite(Number(value)) || Number(value) < 0) {
    const error = new Error(`${label}：请手动填写有效工时`);
    error.status = 400;
    throw error;
  }
}

module.exports = { FULL_CREDIT_TITLES, FULL_CREDIT_DEFAULT_PROGRESS, VALID_PROGRESS, isFullCreditRecord, fullCreditCategoryOf,
  fullCreditProgress, fullCreditVersionKey, normalizeProgress, dateVersion, normalizeFullCreditRecord, validateManualHours };
