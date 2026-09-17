import { groupRequirementProgress } from './deliverySummary.js'
import { uniqueStatsRecords } from './statsTable.js'

export function deliveryStatus(metric) {
  const effective = metric?.deliveryRate, weighted = metric?.weightedDeliveryRate
  if (metric?.calendarStatus === 'invalid_period' || effective == null || weighted == null
    || !Number.isFinite(Number(effective)) || !Number.isFinite(Number(weighted))) {
    return { state: 'unavailable', text: '交付率暂无法计算', canView: false }
  }
  const effectiveDisplay = Number(Number(effective).toFixed(2)), weightedDisplay = Number(Number(weighted).toFixed(2))
  if (weightedDisplay > effectiveDisplay) return { state: 'warning', text: '数据统计需确认', canView: false }
  if (!(metric.deliveredHours > 0)) return { state: 'empty', text: '当前周期暂无有效交付工时', canView: false }
  if (weightedDisplay === effectiveDisplay) return { state: 'complete', text: '周期内需求交付进度100%', canView: false }
  return { state: 'partial', text: '部分需求需跨周期完成。', canView: true }
}

/** Use the same eligible records and latest selected-period progress as the card. */
export function incompleteRequirementRows(records = [], capacity = null, tasks = []) {
  if (!Array.isArray(capacity?.units)) return []
  const taskMap = new Map(tasks.map(task => [String(task.id), task]))
  const unitMap = new Map(capacity.units.map(unit => [String(unit.taskId), unit]))
  const eligible = uniqueStatsRecords(records, capacity).filter(row => row.hours != null && String(row.hours).trim() !== '')
  const timestamp = value => Date.parse(String(value || '').replace(' ', 'T')) || 0
  return groupRequirementProgress(eligible, capacity)
    .filter(group => group.hours > 0 && group.progress != null && group.progress < 100)
    .map(group => {
      const record = group.latest
      const task = taskMap.get(String(record.task_id)) || record.task || {}
      const unit = unitMap.get(String(record.task_id)) || {}
      const periodEnd = unit.endDate || task.end_date || unit.startDate || task.start_date || ''
      const year = task.year || String(periodEnd).slice(0, 4)
      const week = Number(task.week_number)
      return {
        key: group.key,
        staffName: record.staff?.name || record.staffName || record.staff_name || '-',
        role: record.staff?.role || record.role || '',
        version: String(record.version || '').trim(),
        requirementTitle: String(record.requirement_title || '').trim(),
        progress: group.progress,
        periodEnd,
        weekLabel: Number.isInteger(week) && week > 0 ? `${year ? `${year}年` : ''}第${week}周` : task.title || periodEnd || '周期未标注',
        createdAt: record.created_at || ''
      }
    })
    .sort((a, b) => timestamp(b.periodEnd) - timestamp(a.periodEnd) || timestamp(b.createdAt) - timestamp(a.createdAt))
}
