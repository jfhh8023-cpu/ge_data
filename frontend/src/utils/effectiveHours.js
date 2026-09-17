import { normalizeProgress } from './progress.js'

export { normalizeProgress }
export const FULL_CREDIT_TITLES = Object.freeze(['请假', '培训', '公司会议', '出差', '团建'])
export const POSITIVE_PROGRESS_OPTIONS = Object.freeze([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
export const FULL_CREDIT_NOTE = `${FULL_CREDIT_TITLES.join('、')}：工时手填，版本自动锁定为 vYYMMDD，按完整工时计入有效交付及加权工时；普通无版本工时仅记录。`
export const isFullCreditRecord = value => FULL_CREDIT_TITLES.includes(String(typeof value === 'object' ? value?.requirement_title ?? value?.title ?? '' : value ?? '').trim())
const round = value => Number(value.toFixed(2))
const canPreserveHistoricalNull = row => Boolean(row?.existing_record_id && row?._original_progress_missing === true)

/** A saved null may be retained; an explicitly resubmitted ordinary progress must be positive. */
export function isValidSubmittedProgress(row) {
  if (isFullCreditRecord(row)) return true
  const raw = row?.delivery_progress
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')
  if (empty) return canPreserveHistoricalNull(row)
  return POSITIVE_PROGRESS_OPTIONS.includes(normalizeProgress(raw))
}

function chinaDate(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(validDate)
  const part = type => parts.find(item => item.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function dateVersion(value = new Date()) {
  return `v${chinaDate(value).replaceAll('-', '').slice(2)}`
}

const ordinaryFields = row => ({
  version: row.version || '', delivery_progress: normalizeProgress(row.delivery_progress),
  product_managers: [...(row.product_managers || [])], demand_sources: [...(row.demand_sources || [])],
  demand_source_weights: { ...(row.demand_source_weights || {}) }
})
const emptyOrdinaryFields = () => ordinaryFields({})

/** Only presentation fields change; the manually entered hours must never change. */
export function initializeSpecialRow(row, now = new Date(), { newRow = false } = {}) {
  row._special_active = isFullCreditRecord(row)
  if (!row._special_active) return row
  row._ordinary_fields = row._ordinary_fields || emptyOrdinaryFields()
  const savedVersion = !newRow && /^v\d{6}$/i.test(String(row.version || '')) ? row.version : null
  row.automatic_version_date = savedVersion
    ? `20${savedVersion.slice(1, 3)}-${savedVersion.slice(3, 5)}-${savedVersion.slice(5, 7)}`
    : chinaDate(newRow ? now : row.automatic_version_date || row.created_at || now)
  row.version = savedVersion || dateVersion(row.automatic_version_date)
  row.delivery_progress = null
  row.product_managers = []
  row.demand_sources = []
  row.demand_source_weights = {}
  return row
}

export function syncSpecialRow(row, now = new Date()) {
  const special = isFullCreditRecord(row)
  if (special && !row._special_active) {
    row._ordinary_fields = ordinaryFields(row)
    row.automatic_version_date ||= chinaDate(now)
    row.version = dateVersion(row.automatic_version_date)
    row.delivery_progress = null
    row.product_managers = []
    row.demand_sources = []
    row.demand_source_weights = {}
  } else if (!special && row._special_active) {
    Object.assign(row, ordinaryFields(row._ordinary_fields || emptyOrdinaryFields()))
  }
  row._special_active = special
  return row
}

/** Form-only estimate: no saved records are added to the current inputs. */
export function summarizeDraftWeightedHours(rows = [], standardHours = 0) {
  let weightedDeliveredHours = 0, fullCreditHours = 0, versionedHours = 0, missingProgressHours = 0, historicalDefaultHours = 0
  for (const row of rows) {
    const hours = Number(row.hours)
    if (!Number.isFinite(hours) || hours <= 0) continue
    if (isFullCreditRecord(row)) {
      fullCreditHours += hours
      weightedDeliveredHours += hours
      continue
    }
    const version = String(row.version || '').trim()
    if (!version || version === '-') continue
    versionedHours += hours
    const progress = normalizeProgress(row.delivery_progress)
    if (progress === null && canPreserveHistoricalNull(row)) {
      historicalDefaultHours += hours
      weightedDeliveredHours += hours
    } else if (progress === null) missingProgressHours += hours
    else weightedDeliveredHours += hours * progress / 100
  }
  return {
    weightedDeliveredHours: missingProgressHours > 0 ? null : round(weightedDeliveredHours),
    knownWeightedDeliveredHours: round(weightedDeliveredHours - historicalDefaultHours), historicalDefaultHours: round(historicalDefaultHours), fullCreditHours: round(fullCreditHours),
    versionedHours: round(versionedHours), missingProgressHours: round(missingProgressHours),
    weightedDeliveryRate: Number(standardHours) > 0 && missingProgressHours === 0
      ? round(weightedDeliveredHours * 100 / Number(standardHours)) : null
  }
}
