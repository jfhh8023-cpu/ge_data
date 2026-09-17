const { getBeijingParts } = require('../utils/beijingTime');

const FULL_CREDIT_TITLES = Object.freeze(['请假', '培训', '公司会议', '出差', '团建']);
const fullCreditTitles = new Set(FULL_CREDIT_TITLES);
const VALID_PROGRESS = new Set([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

function isFullCreditRecord(record) {
  return fullCreditTitles.has(String(record?.requirement_title ?? record ?? '').trim());
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

/** Only server-loaded saved data may supply the original date; client versions are ignored. */
function normalizeFullCreditRecord(record, previous = null, now = new Date()) {
  if (!isFullCreditRecord(record)) return record;
  const saved = previous?.toJSON ? previous.toJSON() : previous;
  let version = dateVersion(now);
  if (saved && isFullCreditRecord(saved)) {
    const savedVersion = String(saved.version || '').trim();
    if (/^v\d{6}$/i.test(savedVersion)) version = savedVersion.toLowerCase();
    else if (saved.created_at && Number.isFinite(new Date(saved.created_at).getTime())) version = dateVersion(new Date(saved.created_at));
  }
  return { ...record, requirement_title: String(record.requirement_title).trim(), version,
    automatic_version_date: `20${version.slice(1, 3)}-${version.slice(3, 5)}-${version.slice(5, 7)}`,
    delivery_progress: null, product_managers: [], demand_sources: [], demand_source_ids: [], demand_source_weights: {} };
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

module.exports = { FULL_CREDIT_TITLES, VALID_PROGRESS, isFullCreditRecord, normalizeProgress,
  dateVersion, normalizeFullCreditRecord, validateManualHours };
