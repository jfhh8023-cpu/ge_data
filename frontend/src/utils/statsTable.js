const numericColumns = new Set(['hours', 'total', 'share', 'standardHours', 'deliveredHours', 'deliveryRate', 'weightedDeliveryRate', 'requirementProgress', 'progressCoverage', 'progress', 'recordCount', 'taskCount', 'requirementCount'])

/** Stable full-dataset sorting. Missing values stay last in either direction. */
export function sortStatsRows(rows = [], sort = {}) {
  if (!sort?.prop || !sort?.order) return rows
  const { prop, order } = sort
  const direction = order === 'descending' ? -1 : 1
  const valueOf = row => {
    const raw = row[prop]
    const value = Array.isArray(raw) ? raw.map(item => String(item ?? '').trim()).filter(Boolean).join('、') : typeof raw === 'string' ? raw.trim() : raw
    if (value == null || value === '' || value === '—' || value === '-') return null
    if (prop === 'created_at') {
      const time = Date.parse(String(value).replace(' ', 'T'))
      return Number.isFinite(time) ? time : null
    }
    if (numericColumns.has(prop) || typeof value === 'number') {
      const number = Number(value)
      return Number.isFinite(number) ? number : null
    }
    return String(value)
  }
  return rows.map((row, index) => ({ row, index, value: valueOf(row) })).sort((a, b) => {
    if (a.value == null && b.value != null) return 1
    if (a.value != null && b.value == null) return -1
    if (a.value == null) return a.index - b.index
    const compared = typeof a.value === 'number' && typeof b.value === 'number'
      ? a.value - b.value : String(a.value).localeCompare(String(b.value), 'zh-CN', { numeric: true })
    return compared * direction || a.index - b.index
  }).map(item => item.row)
}

export const recordSource = row => row.source_type || (row.is_product_manager_record || row.demand_sources !== undefined ? 'product_manager' : 'engineering')
export const recordStaffId = row => String(row.staff_id || row.staff?.id || '')
export const requirementIdentity = row => JSON.stringify([String(row.task_id || ''), String(row.version || '').trim().replace(/^-$/, ''), row.requirement_title || ''])

/** Raw records are the common source; presentation groups and total rows are never records. */
export function uniqueStatsRecords(records = [], capacity) {
  const allowed = Array.isArray(capacity?.units) ? new Set(capacity.units.map(unit => JSON.stringify([String(unit.staffId), String(unit.taskId)]))) : null
  const seen = new Set()
  return records.filter(row => {
    if (!row || !Number.isFinite(Number(row.hours)) || Number(row.hours) < 0) return false
    if (row.staff?.employment_status === 'resigned') return false
    if (allowed && !allowed.has(JSON.stringify([recordStaffId(row), String(row.task_id || '')]))) return false
    const key = row.id ? `${recordSource(row)}:${row.id}` : null
    if (key && seen.has(key)) return false
    if (key) seen.add(key)
    return true
  })
}

export function recordTableRows(records = [], tasks = []) {
  const taskMap = new Map(tasks.map(task => [String(task.id), task]))
  return records.map(row => {
    const task = taskMap.get(String(row.task_id))
    let managers = row.product_managers || []
    if (typeof managers === 'string') { try { managers = JSON.parse(managers) } catch { managers = [managers] } }
    return {
      ...row,
      sourceLabel: recordSource(row) === 'product_manager' ? 'AI产品' : '研发',
      staffName: row.staff?.name || row.staffName || row.staff_name || '-',
      roleLabel: row.roleLabel || row.staff?.role || row.role || '-',
      weekLabel: task?.week_number ? `W${String(task.week_number).padStart(2, '0')}` : '-',
      versionLabel: String(row.version || '').trim() && String(row.version).trim() !== '-' ? row.version : '无版本号',
      demandSourcesLabel: row.demand_sources?.join('、') || '-',
      pmNames: Array.isArray(managers) ? managers.join('、') || '-' : '-',
      hours: Number(row.hours) || 0
    }
  })
}
