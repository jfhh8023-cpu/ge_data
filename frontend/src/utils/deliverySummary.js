import { summarizeWorkHours } from './workHours.js'
import { latestCreatedAt } from './recordOrder.js'
import { requirementIdentity } from './statsTable.js'
import { isFullCreditRecord, normalizeProgress, FULL_CREDIT_TITLES } from './effectiveHours.js'

export const DELIVERY_NOTE = `有效已交付＝有版本号的普通工时＋${FULL_CREDIT_TITLES.join('、')}工时；五类全额计一次。有效交付率＝有效已交付÷应交付工时；加权交付率＝（普通版本工时×最新需求进度＋五类工时）÷当前范围应交付工时。历史空进度计算按100%，原值保留；明确0%仍按0%。部门、岗位合并加权工时及应交付工时计算，个人仅算本人；普通无版本只记录。应交付按所选周期工作日每天8小时、同人同日去重，缺填周仍计应交付且加权工时为0。应交付为0或日历无效显示“—”，有效容量下零加权工时显示0%，超过100%如实显示。`
export const hasDeliveryVersion = record => isFullCreditRecord(record) || Boolean(String(record?.version ?? '').trim() && String(record?.version ?? '').trim() !== '-')
const round = value => Number(value.toFixed(2))
const unitKey = (staffId, taskId) => JSON.stringify([String(staffId || ''), String(taskId || '')])

/** The latest selected period determines cumulative progress, including an explicit unknown. */
export function groupRequirementProgress(records = [], capacity = {}) {
  const periods = new Map((capacity?.units || []).map(unit => [String(unit.taskId), unit.endDate || unit.startDate || '']))
  const time = value => { const parsed = Date.parse(String(value || '').replace(' ', 'T')); return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY }
  const rank = record => [time(periods.get(String(record.task_id)) || record.task?.end_date || record.task?.start_date), time(record.updated_at || record.created_at), time(record.created_at), String(record.id || '')]
  const isLater = (a, b) => {
    const left = rank(a), right = rank(b)
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return left[i] > right[i]
    }
    return false
  }
  const groups = new Map()
  for (const record of records) {
    if (isFullCreditRecord(record) || !hasDeliveryVersion(record)) continue
    const key = JSON.stringify([String(record.staff_id || record.staff?.id || ''), String(record.version).trim(), String(record.requirement_title || '').trim()])
    if (!groups.has(key)) groups.set(key, { key, hours: 0, latest: record, records: [] })
    const group = groups.get(key)
    group.hours += Number(record.hours) || 0
    group.records.push(record)
    if (isLater(record, group.latest)) group.latest = record
  }
  return [...groups.values()].map(group => ({ ...group, progress: normalizeProgress(group.latest.delivery_progress) }))
}

const display = value => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
export function deliveryMetricTip(metric, key) {
  if (!metric) return '当前范围暂无数据。'
  const m = metric, f = display
  const people = '仅纳入当前非离职且所选范围有记录的人员；纳入后按完整所选周期计算，同人同日去重。'
  const five = FULL_CREDIT_TITLES.join('、')
  const calendar = m.calendarNote || ''
  const actualProgress = m.requirementProgress == null ? '未填写' : `${f(m.requirementProgress)}%`
  const actualCoverage = m.progressCoverage == null ? '不适用（无普通版本工时）' : `${f(m.progressCoverage)}%`
  const texts = {
    recordedHours: `总工时＝全部已填原始工时，含有版本、普通无版本及${five}；当前${f(m.recordedHours)}h。`,
    standardHours: `应交付工时＝所选范围人员实际工作日×每天8小时＝${f(m.standardHours)}h。${people}${calendar}`,
    deliveredHours: `有效已交付＝有版本号的普通工时${f(m.versionedHours ?? (m.deliveredHours - (m.fullCreditHours || 0)))}h＋${five}工时${f(m.fullCreditHours)}h＝${f(m.deliveredHours)}h。五类不论历史是否有版本均全额计一次；普通无版本不计入。`,
    unversionedHours: `普通无版本工时合计${f(m.unversionedHours)}h，只记录，不计入有效交付率和加权交付率；五类工时除外。`,
    deliveryRate: `有效交付率＝有效已交付${f(m.deliveredHours)}h÷应交付${f(m.standardHours)}h×100%。超过100%如实显示；应交付为0或日历无效时显示“—”。${calendar}`,
    weightedDeliveryRate: `加权交付率＝[Σ(普通有版本需求累计工时×范围内最新周期填写进度)＋${five}工时]÷当前范围应交付工时×100%。当前折算${f(m.weightedDeliveredHours)}h÷应交付${f(m.standardHours)}h。${m.missingProgressHours > 0 ? `${f(m.missingProgressHours)}h历史空进度仅在本计算中按100%，原值仍为空；` : '历史空进度计算按100%；'}明确0%仍按0%。同人、同版本、同标题合并；五类全额计入且不要求进度。部门、岗位合并加权工时及应交付工时计算，不平均个人百分比；个人仅算本人。${people}缺填周仍计应交付，该周加权工时为0。应交付大于0且日历有效时无加权工时显示0%；应交付为0或日历无效显示“—”；超过100%如实显示。实际进度填报覆盖${m.progressCoverage == null ? '不适用（无普通版本工时）' : `${f(m.progressCoverage)}%（已知进度${f(m.progressKnownHours)}h÷普通版本${f(m.versionedHours)}h）`}；兼容默认值不算实际填报。${calendar}`,
    requirementProgress: `需求填报进度＝Σ(普通有版本需求累计工时×最新填写进度)÷已知进度的普通版本工时${f(m.progressKnownHours)}h；实际需求填报进度${actualProgress}。五类、普通无版本不参与；缺失进度保留未知，明确0%有效。`,
    progressCoverage: `实际进度填报覆盖${actualCoverage}＝已有进度的普通版本工时${f(m.progressKnownHours)}h÷普通版本工时${f(m.versionedHours)}h；缺进度${f(m.missingProgressHours)}h。不包含${five}，历史兼容默认值不算实际填报。`
  }
  texts.weightedDeliveryRate += `实际需求填报进度${actualProgress}，仅使用真实已知进度，历史兼容默认值不参与该进度平均。`
  return texts[key] || DELIVERY_NOTE
}

export const weightedRateText = metric => !metric || metric.weightedDeliveryRate == null
  ? '—' : `${display(metric.weightedDeliveryRate)}%`

/** Capacity comes from the working-day calendar; record progress never changes saved hours. */
export function summarizeDelivery(records = [], capacity = null) {
  if (!capacity) return null
  const allowedUnits = Array.isArray(capacity.units)
    ? new Set(capacity.units.map(unit => unitKey(unit.staffId, unit.taskId))) : null
  const seen = new Set()
  let deliveredHours = 0
  let unversionedHours = 0
  let fullCreditHours = 0
  const eligibleRecords = []
  for (const record of records) {
    if (!record || (allowedUnits && !allowedUnits.has(unitKey(record.staff_id || record.staff?.id, record.task_id)))) continue
    if (record.staff?.employment_status === 'resigned') continue
    const source = record.source_type || (record.is_product_manager_record || record.demand_sources !== undefined ? 'product_manager' : 'engineering')
    const id = record.id ? `${source}:${record.id}` : null
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    const hours = Number(record.hours)
    if (record.hours == null || String(record.hours).trim() === '' || !Number.isFinite(hours) || hours < 0) continue
    eligibleRecords.push(record)
    if (isFullCreditRecord(record)) fullCreditHours += hours
    if (hasDeliveryVersion(record)) deliveredHours += hours
    else unversionedHours += hours
  }
  const standardHours = Number(capacity.standardHours) || 0
  const groups = groupRequirementProgress(eligibleRecords, capacity)
  const known = groups.filter(group => group.progress != null)
  const progressKnownHours = known.reduce((sum, group) => sum + group.hours, 0)
  const versionedHours = deliveredHours - fullCreditHours
  const weightedOrdinaryHours = known.reduce((sum, group) => sum + group.hours * group.progress / 100, 0)
  const missingProgressHours = groups.filter(group => group.progress == null).reduce((sum, group) => sum + group.hours, 0)
  const weightedDeliveredHours = weightedOrdinaryHours + missingProgressHours + fullCreditHours
  return {
    deliveredHours: round(deliveredHours), unversionedHours: round(unversionedHours),
    recordedHours: round(deliveredHours + unversionedHours), standardHours,
    deliveryRate: standardHours > 0 && capacity.calendarStatus !== 'invalid_period' ? round(deliveredHours * 100 / standardHours) : null,
    fullCreditHours: round(fullCreditHours), versionedHours: round(versionedHours),
    weightedDeliveredHours: round(weightedDeliveredHours),
    knownWeightedDeliveredHours: round(weightedOrdinaryHours + fullCreditHours),
    weightedDeliveryRate: standardHours > 0 && capacity.calendarStatus !== 'invalid_period' ? round(weightedDeliveredHours * 100 / standardHours) : null,
    missingProgressHours: round(missingProgressHours), missingProgressCount: groups.filter(group => group.progress == null && group.hours > 0).length,
    progressKnownHours: round(progressKnownHours),
    requirementProgress: progressKnownHours > 0 ? round(weightedOrdinaryHours * 100 / progressKnownHours) : null,
    progressCoverage: versionedHours > 0 ? round(progressKnownHours * 100 / versionedHours) : null,
    calendarStatus: capacity.calendarStatus, calendarNote: capacity.calendarNote, formula: DELIVERY_NOTE
  }
}

/** Records determine eligible people; all selected dates remain in each eligible person's capacity. */
export function summarizeStaffDelivery(records = [], capacity = null) {
  if (!Array.isArray(capacity?.units)) return []

  const people = new Map()
  const allowedUnits = new Set()
  for (const unit of capacity.units) {
    if (!unit?.staffId) continue
    const staffKey = String(unit.staffId)
    if (!people.has(staffKey)) {
      people.set(staffKey, {
        staffId: unit.staffId, staffName: '', role: '', units: [], records: []
      })
    }
    const person = people.get(staffKey)
    if (!person.staffName && unit.staffName) person.staffName = unit.staffName
    if (!person.role && unit.role) person.role = unit.role
    person.units.push({
      ...unit,
      calendarStatus: unit.calendarStatus || capacity.calendarStatus || 'weekday_fallback'
    })
    if (unit.taskId) allowedUnits.add(unitKey(unit.staffId, unit.taskId))
  }

  // Deduplicate across all people before splitting; source tables may legitimately reuse an ID.
  const seenRecords = new Set()
  for (const record of Array.isArray(records) ? records : []) {
    const staffId = record?.staff_id || record?.staff?.id
    if (!record || !staffId || !record.task_id || !allowedUnits.has(unitKey(staffId, record.task_id))) continue
    if (record.staff?.employment_status === 'resigned') continue
    const source = record.source_type || (record.is_product_manager_record || record.demand_sources !== undefined ? 'product_manager' : 'engineering')
    const identity = record.id ? `${source}:${record.id}` : null
    if (identity && seenRecords.has(identity)) continue
    if (identity) seenRecords.add(identity)
    const hours = Number(record.hours)
    if (!Number.isFinite(hours) || hours < 0) continue

    const person = people.get(String(staffId))
    person.records.push(record)
    if (!person.staffName) person.staffName = record.staff?.name || record.staffName || record.staff_name || ''
    if (!person.role) person.role = record.staff?.role || record.role || ''
  }

  return [...people.values()].filter(person => person.records.length).map(person => {
    const workHours = summarizeWorkHours(person.records, person.units)
    workHours.calendarNote = workHours.calendarStatus === 'invalid_period'
      ? '部分周期日期无效，应交付工时基准不完整，暂不计算交付率；已记录工时仍完整保留。'
      : workHours.calendarStatus === 'weekday_fallback'
        ? '部分年份缺少官方节假日快照，暂按周一至周五估算，未计该年份节假日与调休，待核实。'
        : '工作日按官方节假日和调休补班计算。'
    const summary = summarizeDelivery(person.records, workHours)
    return {
      ...summary,
      staffId: person.staffId, staffName: person.staffName || '-', role: person.role,
      standardHours: summary.standardHours, deliveredHours: summary.deliveredHours,
      deliveryRate: summary.deliveryRate, recordedHours: summary.recordedHours,
      unversionedHours: summary.unversionedHours, calendarStatus: summary.calendarStatus,
      calendarNote: summary.calendarNote,
      recordCount: person.records.length,
      taskCount: new Set(person.records.map(record => String(record.task_id))).size,
      requirementCount: new Set(person.records.filter(record => !isFullCreditRecord(record)).map(requirementIdentity)).size,
      created_at: latestCreatedAt(person.records)
    }
  })
}
