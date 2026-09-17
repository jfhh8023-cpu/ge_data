export const WORK_HOURS_TIP = '工时完成度 = 已填工时 ÷ 应填工时 × 100%；应填工时 = 所属周期实际工作日 × 每天8小时（按人员逐日去重）。5个工作日为40小时：32小时=80%，40小时=100%，48小时=120%、超额20%。跨人员、跨周按应填工时加权，即总已填÷总应填，不直接平均百分比。'

export const WORK_HOURS_SCOPE_TIP = '统计仅纳入当前非离职且所选范围有记录的人员，纳入后漏填某周仍计完整范围容量；填写预估按当前人员所属完整周期计算。同人同日只计一次，使用官方假期与补班，不随提交日期或值班停排改变。应填为0时比例不适用；缺官方日历按周一至周五估算并标注待核实。'

const round = value => Number(value.toFixed(2))
const nonNegative = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0

/** Reuse server-provided capacity; never infer the denominator from record count. */
export function summarizeWorkHours(records = [], units = []) {
  const dates = new Set()
  for (const unit of units) {
    if (!unit.staffId) continue
    for (const date of unit.workDates || []) dates.add(`${unit.staffId}|${date}`)
  }
  const seenRecords = new Set()
  const actualHours = records.reduce((sum, record) => {
    const source = record.source_type || (record.is_product_manager_record || record.demand_sources !== undefined ? 'product_manager' : 'engineering')
    const identity = record.id ? `${source}:${record.id}` : null
    if (identity && seenRecords.has(identity)) return sum
    if (identity) seenRecords.add(identity)
    return sum + nonNegative(record.hours)
  }, 0)
  const standardHours = dates.size * 8
  const statuses = new Set(units.map(unit => unit.calendarStatus).filter(Boolean))
  const validCapacity = standardHours > 0 && !statuses.has('invalid_period')
  const completionRate = validCapacity ? round(actualHours * 100 / standardHours) : null
  return {
    actualHours: round(actualHours), standardHours, completionRate,
    excessRate: validCapacity ? round(Math.max(actualHours / standardHours * 100 - 100, 0)) : null,
    workingDays: dates.size,
    calendarStatus: statuses.has('invalid_period') ? 'invalid_period' : [...statuses].some(status => /fallback|missing|partial|estimate/.test(status)) ? 'weekday_fallback' : units.length ? 'official' : 'empty',
    units, formula: WORK_HOURS_TIP
  }
}

export function workHoursExportRows(metric) {
  return [
    ['工时完成度公式', WORK_HOURS_TIP],
    ['工作日与人员范围', WORK_HOURS_SCOPE_TIP],
    ['已填工时/h', metric?.actualHours ?? 0],
    ['应填工时/h', metric?.standardHours ?? 0],
    ['工时完成度', metric?.completionRate == null ? '不适用' : `${metric.completionRate}%`],
    ['超额比例', metric?.excessRate == null ? '不适用' : `${metric.excessRate}%`],
    ['日历状态', metric?.calendarStatus || '待核实'],
    ['具体统计范围', metric?.scopeNote || '所选人员与周期；同人同日去重']
  ]
}
