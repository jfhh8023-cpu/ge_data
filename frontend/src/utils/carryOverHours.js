/**
 * REQ-072: the fill page edits cumulative hours for a requirement carried over from earlier periods,
 * while the database, drafts and payloads keep only the current period's delta.
 */
const round = value => Number((Number(value) || 0).toFixed(2))
const key = (title, version) => `${String(title || '').trim()}\u0000${String(version || '').trim()}`

export function isCarryOverModified(row) {
  const info = row?._carry_over
  if (!info) return false
  return String(row.requirement_title || '').trim() !== info.original_title || String(row.version || '').trim() !== info.original_version
}

/** Hours already stored in earlier periods for this row's group; 0 once the title/version has been decoupled. */
export function effectivePreviousHours(row) {
  const info = row?._carry_over
  if (!info || row?._carry_over_duplicate || isCarryOverModified(row)) return 0
  const previous = Number(info.previous_hours)
  return Number.isFinite(previous) && previous > 0 ? round(previous) : 0
}

/** Current-period delta derived from the cumulative value shown in the input. */
export function periodHours(row) {
  if (row?.hours === null || row?.hours === undefined || row?.hours === '') return row?.hours ?? null
  const shown = Number(row.hours)
  if (!Number.isFinite(shown)) return row.hours
  return round(shown - effectivePreviousHours(row))
}

export const toPeriodRows = rows => rows.map(row => ({ ...row, hours: periodHours(row) }))

/**
 * Attach server history to saved/draft rows by (title, version). Only the first row of a group is linked;
 * later duplicates are flagged so they are treated as plain period hours (D4).
 * `hoursMode` 'period' converts stored deltas to the cumulative display value.
 */
export function attachCarryOverHistory(rows, history = [], { hoursMode = 'period' } = {}) {
  const byKey = new Map((Array.isArray(history) ? history : []).map(item => [key(item.requirement_title, item.version), item]))
  const linked = new Set()
  for (const row of rows) {
    const rowKey = key(row.requirement_title, row.version)
    const info = byKey.get(rowKey)
    if (!info) continue
    if (linked.has(rowKey)) { row._carry_over_duplicate = true; continue }
    linked.add(rowKey)
    const { requirement_title, version, ...carry } = info
    row._carry_over = { ...(row._carry_over || {}), ...carry, original_title: String(requirement_title).trim(), original_version: String(version).trim() }
    row._carry_over_duplicate = false
    if (hoursMode === 'period') {
      const stored = Number(row.hours)
      row.hours = Number.isFinite(stored) ? round(stored + effectivePreviousHours(row)) : effectivePreviousHours(row)
    }
  }
  return rows
}

/** `含 第36周 10h + 第37周（本周）5h`; parts flagged previous:true are rendered orange by the page. */
export function hoursBreakdown(row, currentWeekLabel = '本周') {
  const previous = effectivePreviousHours(row)
  if (previous <= 0) return []
  const weeks = Array.isArray(row._carry_over?.history_weeks) && row._carry_over.history_weeks.length > 0
    ? row._carry_over.history_weeks
    : [{ week_number: row._carry_over?.source_week_number, task_title: row._carry_over?.source_task_title, hours: previous }]
  const label = week => (week.week_number ? `第${week.week_number}周` : (week.task_title || '此前周期'))
  const parts = weeks.map(week => ({ previous: true, text: `${label(week)} ${round(week.hours)}h` }))
  parts.push({ previous: false, text: `${currentWeekLabel} ${round(periodHours(row))}h` })
  return parts
}

/** Sum of previous hours excluded from the page total, with the periods they came from. */
export function excludedPreviousHours(rows) {
  const weeks = new Set()
  let total = 0
  for (const row of rows) {
    const previous = effectivePreviousHours(row)
    if (previous <= 0) continue
    total += previous
    for (const week of row._carry_over?.history_weeks || []) if (week.week_number) weeks.add(week.week_number)
  }
  return { hours: round(total), weeks: [...weeks].sort((a, b) => a - b) }
}
