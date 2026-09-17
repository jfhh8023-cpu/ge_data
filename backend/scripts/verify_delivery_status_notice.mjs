// REQ-069: independently specified display states and scope-sensitive unfinished requirements.
import assert from 'node:assert/strict'
import { deliveryStatus, incompleteRequirementRows } from '../../frontend/src/utils/deliveryStatus.js'

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
const metric = (deliveryRate, weightedDeliveryRate, extra = {}) => ({ deliveredHours: 32, standardHours: 40, calendarStatus: 'official', deliveryRate, weightedDeliveryRate, ...extra })
check('equal, lower and higher displayed rates have separate exact messages', () => {
  assert.equal(deliveryStatus(metric(80, 80)).text, '周期内需求交付进度100%')
  assert.equal(deliveryStatus(metric(80, 40)).text, '部分需求需跨周期完成。')
  assert.equal(deliveryStatus(metric(80, 40)).canView, true)
  assert.equal(deliveryStatus(metric(80, 81)).text, '数据统计需确认')
  assert.equal(deliveryStatus(metric(80, 81)).canView, false)
  assert.equal(deliveryStatus(metric(120, 120)).state, 'complete')
  assert.equal(deliveryStatus(metric(49.994, 49.991)).state, 'complete')
})
check('empty hours or invalid rates never claim100; impossible higher rate still warns', () => {
  assert.equal(deliveryStatus(null).state, 'unavailable')
  assert.equal(deliveryStatus(metric(null, null)).state, 'unavailable')
  assert.equal(deliveryStatus(metric(0, 0, { deliveredHours: 0 })).state, 'empty')
  assert.equal(deliveryStatus(metric(0, 1, { deliveredHours: 0 })).state, 'warning')
  assert.equal(deliveryStatus(metric(80, 80, { calendarStatus: 'invalid_period' })).state, 'unavailable')
  assert.equal(deliveryStatus(metric(80, NaN)).state, 'unavailable')
})
const tasks = [
  { id: 'w37', year: 2026, week_number: 37, end_date: '2026-09-13' },
  { id: 'w38', year: 2026, week_number: 38, end_date: '2026-09-20' }
]
const units = ['a', 'b'].flatMap(staffId => tasks.map(task => ({ staffId, taskId: task.id, endDate: task.end_date })))
const capacity = { units }
const row = (id, progress, extra = {}) => ({ id, source_type: 'engineering', staff_id: 'a', task_id: 'w38', staff: { id: 'a', name: '甲', role: 'ai_dev', employment_status: 'active' }, version: 'v1', requirement_title: id, hours: 8, delivery_progress: progress, created_at: '2026-09-17T03:00:00Z', ...extra })
check('unfinished list contains actual0/1/50 only, excluding defaults/full-credit/unversioned/resigned/zero-hours', () => {
  const records = [row('zero', 0), row('one', 1), row('half', 50), row('done', 100), row('unknown', null),
    row('special', null, { requirement_title: '培训' }), row('raw', 30, { version: '' }),
    row('resigned', 30, { staff: { employment_status: 'resigned' } }), row('no-hours', 30, { hours: 0 })]
  const before = JSON.stringify(records)
  assert.deepEqual(incompleteRequirementRows(records, capacity, tasks).map(item => item.progress).sort((a, b) => a - b), [0, 1, 50])
  assert.equal(JSON.stringify(records), before)
})
check('same person/version/title uses latest selected week, not later editing timestamp in an old week', () => {
  const old = row('old', 50, { task_id: 'w37', requirement_title: '跨周需求', updated_at: '2026-10-01T00:00:00Z' })
  const recent = row('new', 100, { requirement_title: '跨周需求' })
  assert.equal(incompleteRequirementRows([old, recent], capacity, tasks).length, 0)
  const onlyOld = { units: units.filter(unit => unit.taskId === 'w37') }
  const rows = incompleteRequirementRows([old, recent], onlyOld, tasks)
  assert.equal(rows.length, 1); assert.equal(rows[0].progress, 50); assert.equal(rows[0].weekLabel, '2026年第37周')
  const current = incompleteRequirementRows([old, { ...recent, delivery_progress: 1 }], capacity, tasks)
  assert.equal(current.length, 1); assert.equal(current[0].progress, 1); assert.equal(current[0].weekLabel, '2026年第38周')
  assert.equal(incompleteRequirementRows([old, { ...recent, hours: 0 }], capacity, tasks).length, 0, 'zero-hour latest100 still closes the accumulated requirement')
})
check('list honors exact person and task capacity, deduplicates source IDs and orders later weeks first', () => {
  const old = row('old', 50, { task_id: 'w37' }), recent = row('new', 1)
  const other = row('other', 60, { staff_id: 'b', staff: { id: 'b', name: '乙', role: 'ai_quality' } })
  const person = { units: units.filter(unit => unit.staffId === 'a') }
  const results = incompleteRequirementRows([old, recent, recent, other], person, tasks)
  assert.equal(results.length, 2); assert.equal(results[0].requirementTitle, 'new'); assert.equal(results[0].staffName, '甲')
  assert.equal(results[0].version, 'v1'); assert.equal(results[0].weekLabel, '2026年第38周')
  assert.deepEqual(incompleteRequirementRows([old], null, tasks), [])
  assert.deepEqual(incompleteRequirementRows([old], { units: [] }, tasks), [])
})
console.log(`${passed} passed; no API or database writes`)
