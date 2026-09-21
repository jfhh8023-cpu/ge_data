// REQ-072 CH4-F: pure frontend rules for cumulative carry-over hours. No API, database or business writes.
import assert from 'node:assert/strict'
import { effectivePreviousHours, periodHours, toPeriodRows, attachCarryOverHistory, hoursBreakdown, excludedPreviousHours, isCarryOverModified } from '../../frontend/src/utils/carryOverHours.js'
import { summarizeDraftWeightedHours } from '../../frontend/src/utils/effectiveHours.js'

let checked = 0
function check(name, fn) { fn(); checked++; console.log(`PASS ${name}`) }
const history = [{ requirement_title: '需求X', version: 'V1', previous_hours: 10, previous_progress: 70, source_week_number: 36, source_task_title: '第36周',
  history_weeks: [{ task_id: 'w35', week_number: 35, task_title: '第35周', hours: 6 }, { task_id: 'w36', week_number: 36, task_title: '第36周', hours: 4 }] }]
const linked = () => attachCarryOverHistory([{ requirement_title: '需求X', version: 'V1', hours: 5, delivery_progress: 80 }], history)[0]

check('CH4-F-001 effectivePreviousHours: linked 10, decoupled title/version 0, duplicate 0, unlinked 0', () => {
  const row = linked()
  assert.equal(effectivePreviousHours(row), 10)
  assert.equal(effectivePreviousHours({ ...row, requirement_title: '需求X2' }), 0)
  assert.equal(effectivePreviousHours({ ...row, version: 'V2' }), 0)
  assert.equal(isCarryOverModified({ ...row, requirement_title: ' 需求X ' }), false, 'trim tolerant')
  assert.equal(effectivePreviousHours({ ...row, _carry_over_duplicate: true }), 0)
  assert.equal(effectivePreviousHours({ requirement_title: '普通', hours: 3 }), 0)
})
check('CH4-F-002 periodHours: cumulative 15 -> 5, 10 -> 0, 8 -> -2 (UI rejects), unlinked passthrough, null stays null', () => {
  const row = linked()
  assert.equal(row.hours, 15, 'stored delta 5 + previous 10 is shown')
  assert.equal(periodHours(row), 5)
  assert.equal(periodHours({ ...row, hours: 10 }), 0)
  assert.equal(periodHours({ ...row, hours: 8 }), -2)
  assert.equal(periodHours({ requirement_title: '普通', hours: 3 }), 3)
  assert.equal(periodHours({ ...row, hours: null }), null)
  assert.deepEqual(toPeriodRows([row, { requirement_title: '普通', hours: 3 }]).map(r => r.hours), [5, 3])
})
check('CH4-F-003 attachCarryOverHistory: first row linked, second duplicate flagged, unmatched untouched, carried null hours show previous', () => {
  const rows = attachCarryOverHistory([
    { requirement_title: '需求X', version: 'V1', hours: 5 }, { requirement_title: '需求X', version: 'V1', hours: 2 }, { requirement_title: '需求Y', version: 'V1', hours: 3 },
    { requirement_title: '需求X', version: 'V1', hours: null, _carry_over: { previous_progress: 70 } }
  ], history)
  assert.equal(rows[0]._carry_over.previous_hours, 10); assert.equal(rows[0]._carry_over.original_title, '需求X'); assert.equal(rows[0].hours, 15)
  assert.equal(rows[1]._carry_over_duplicate, true); assert.equal(rows[1]._carry_over, undefined); assert.equal(rows[1].hours, 2)
  assert.equal(rows[2]._carry_over, undefined); assert.equal(rows[2].hours, 3)
  assert.equal(rows[3]._carry_over_duplicate, true, 'third same-group row is also a duplicate')
  const carried = attachCarryOverHistory([{ requirement_title: '需求X', version: 'V1', hours: null, _carry_over: { previous_progress: 70 } }], history)[0]
  assert.equal(carried.hours, 10, 'a freshly carried row shows the previous cumulative value'); assert.equal(periodHours(carried), 0)
})
check('CH4-F-004 hoursBreakdown: previous weeks orange in order, current period last; empty without history', () => {
  const parts = hoursBreakdown(linked(), '第37周（本周）')
  assert.deepEqual(parts, [{ previous: true, text: '第35周 6h' }, { previous: true, text: '第36周 4h' }, { previous: false, text: '第37周（本周） 5h' }])
  assert.deepEqual(hoursBreakdown({ requirement_title: '普通', hours: 3 }), [])
  assert.deepEqual(hoursBreakdown({ ...linked(), requirement_title: '改名' }), [])
  const summary = excludedPreviousHours([linked(), { requirement_title: '普通', hours: 3 }])
  assert.deepEqual(summary, { hours: 10, weeks: [35, 36] })
})
check('CH4-F-005 page estimates use period hours: 15 shown / 5 stored at 80% -> 4h weighted', () => {
  const rows = toPeriodRows([linked(), { requirement_title: '普通', version: 'V2', hours: 8, delivery_progress: 50 }])
  const result = summarizeDraftWeightedHours(rows, 40)
  assert.equal(result.versionedHours, 13); assert.equal(result.weightedDeliveredHours, 8); assert.equal(result.weightedDeliveryRate, 20)
})
console.log(`${checked} checks passed`)
