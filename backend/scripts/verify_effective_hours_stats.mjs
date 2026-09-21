// REQ-064/065/066 independent hand-calculated regressions; no API, database or business writes.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { summarizeDelivery, summarizeStaffDelivery, groupRequirementProgress, weightedRateText, deliveryMetricTip } from '../../frontend/src/utils/deliverySummary.js'
const require = createRequire(import.meta.url)
const { buildWorkHours } = require('../src/services/WorkHoursCompletionService.js')
const { buildDeliverySummary } = require('../src/services/DeliverySummaryService.js')
let passed = 0, failed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}
const staff = [{ id: 's1', name: '甲', role: 'ai_dev', employment_status: 'active' }]
const week37 = { id: 'w37', title: 'W37', start_date: '2026-09-07', end_date: '2026-09-13', time_dimension: 'week' }
const week38 = { id: 'w38', title: 'W38', start_date: '2026-09-14', end_date: '2026-09-20', time_dimension: 'week' }
const record = (id, title, hours, progress, extra = {}) => ({ id, requirement_title: title, hours, delivery_progress: progress, version: 'v4.1', staff_id: 's1', task_id: 'w38', source_type: 'engineering', ...extra })
const capacityFor = (records, people = staff, tasks = [week38]) => buildWorkHours({ records, staff: people, tasks })
const fields = ['recordedHours', 'deliveredHours', 'unversionedHours', 'standardHours', 'deliveryRate', 'fullCreditHours', 'versionedHours', 'weightedDeliveredHours', 'knownWeightedDeliveredHours', 'weightedDeliveryRate', 'missingProgressHours', 'missingProgressCount', 'progressKnownHours', 'requirementProgress', 'progressCoverage']
function compare(records, capacity) {
  const front = summarizeDelivery(records, capacity), back = buildDeliverySummary(records, capacity)
  for (const key of fields) assert.equal(front[key], back[key], `frontend/backend ${key}: ${front[key]} versus ${back[key]}`)
  return front
}
const baseline = [record('a', '语音识别', 16, 50), record('b', '导出', 8, 100), record('c', '权限', 8, 50), record('d', '培训', 8, null, { version: '' })]
check('40h: effective100%, weighted70%, requirement62.5%, coverage100%', () => {
  const m = compare(baseline, capacityFor(baseline))
  assert.equal(m.standardHours, 40); assert.equal(m.deliveredHours, 40); assert.equal(m.fullCreditHours, 8)
  assert.equal(m.deliveryRate, 100); assert.equal(m.weightedDeliveryRate, 70); assert.equal(m.weightedDeliveredHours, 28)
  assert.equal(m.requirementProgress, 62.5); assert.equal(m.progressCoverage, 100)
})
check('latest selected period null uses 100 only for weighted calculation; raw null and coverage remain unchanged', () => {
  const rows = [record('a1', '同需求', 16, 50, { task_id: 'w37', created_at: '2026-10-01T00:00:00Z' }), record('a2', '同需求', 8, null), record('l', '请假', 8, null, { version: '' })]
  const capacity = capacityFor(rows, staff, [week37, week38]), m = summarizeDelivery(rows, capacity)
  assert.equal(m.standardHours, 80); assert.equal(m.deliveredHours, 32); assert.equal(m.deliveryRate, 40)
  assert.equal(m.missingProgressHours, 24); assert.equal(m.missingProgressCount, 1); assert.equal(m.weightedDeliveryRate, 40)
  assert.equal(m.weightedDeliveredHours, 32); assert.equal(m.knownWeightedDeliveredHours, 8)
  assert.equal(m.requirementProgress, null); assert.equal(m.progressCoverage, 0); assert.equal(weightedRateText(m), '40%')
  assert.equal(rows[1].delivery_progress, null)
  assert.equal(groupRequirementProgress(rows, capacity)[0].progress, null)
  compare(rows, capacity)
})
check('range eligibility preserves each included person entire selected weeks', () => {
  const people = [...staff, { id: 's2', name: '乙', role: 'ai_pm', employment_status: 'retained' }, { id: 's3', name: '无记录', role: 'ai_dev', employment_status: 'active' }, { id: 's4', name: '离职', role: 'ai_dev', employment_status: 'resigned' }]
  const rows = [record('a', '甲周37', 32, 50, { task_id: 'w37' }), record('b', '甲周38', 16, 100), record('c', '乙周38', 16, 100, { staff_id: 's2', source_type: 'product_manager' }), record('d', '离职记录', 40, 100, { staff_id: 's4' })]
  const capacity = capacityFor(rows, people, [week37, week38]), m = compare(rows, capacity)
  assert.equal(capacity.standardHours, 160); assert.deepEqual([...new Set(capacity.units.map(x => x.staffId))], ['s1', 's2'])
  assert.equal(m.recordedHours, 64); assert.equal(m.deliveryRate, 40); assert.equal(m.weightedDeliveryRate, 30)
  const perPerson = summarizeStaffDelivery(rows, capacity)
  assert.equal(perPerson.length, 2); assert.deepEqual(perPerson.map(x => x.standardHours), [80, 80])
  assert.equal(perPerson.reduce((n, x) => n + x.deliveredHours, 0), m.deliveredHours)
  assert.equal(perPerson.reduce((n, x) => n + x.weightedDeliveredHours, 0), m.weightedDeliveredHours)
  assert.equal(capacityFor(rows, people, [week37]).standardHours, 40)
  assert.equal(capacityFor([], people, [week38]).standardHours, 0)
  people[3].employment_status = 'long_leave'
  assert.equal(capacityFor(rows, people, [week37, week38]).standardHours, 240)
})
check('duplicate source+ID counts once; separate sources may reuse ID', () => {
  const engineering = record('same', '研发', 16, 50), product = record('same', '产品', 8, 100, { source_type: 'product_manager' })
  const rows = [engineering, { ...engineering }, product], m = compare(rows, capacityFor(rows))
  assert.equal(m.recordedHours, 24); assert.equal(m.weightedDeliveredHours, 16); assert.equal(m.weightedDeliveryRate, 40)
  assert.equal(summarizeStaffDelivery(rows, capacityFor(rows))[0].recordCount, 2)
})
check('five categories empty/versioned count once, ordinary empty/dash excluded', () => {
  const rows = ['请假', '培训', '公司会议', '出差', '团建'].map((title, index) => record(`s${index}`, ` ${title} `, 2, null, { version: index % 2 ? '' : 'v260917' }))
  rows.push(record('u', '日常', 4, 100, { version: '' }), record('u2', '日常2', 4, 100, { version: '-' }))
  const m = compare(rows, capacityFor(rows))
  assert.equal(m.recordedHours, 18); assert.equal(m.deliveredHours, 10); assert.equal(m.fullCreditHours, 10); assert.equal(m.unversionedHours, 8)
  assert.equal(m.weightedDeliveryRate, 25); assert.equal(m.requirementProgress, null); assert.equal(m.progressCoverage, null)
  assert.equal(summarizeStaffDelivery(rows, capacityFor(rows))[0].requirementCount, 2)
})
check('both delivery rates require valid nonzero capacity and permit excess above100', () => {
  const rows = [record('a', '出差', 48, null)], normal = capacityFor(rows)
  for (const cap of [{ ...normal, standardHours: 0 }, { ...normal, calendarStatus: 'invalid_period' }]) {
    const m = compare(rows, cap); assert.equal(m.recordedHours, 48); assert.equal(m.deliveryRate, null); assert.equal(m.weightedDeliveryRate, null); assert.equal(weightedRateText(m), '—')
  }
  assert.equal(compare(rows, normal).weightedDeliveryRate, 120)
  assert.equal(compare(rows, normal).deliveryRate, 120)
})
check('department merges8h at100% and32h at50% over80h capacity to30%, with personal rates20% and40%', () => {
  const people = [...staff, { id: 's2', name: '乙', role: 'ai_dev', employment_status: 'active' }]
  const rows = [record('a', '需求甲', 8, 100), record('b', '需求乙', 32, 50, { staff_id: 's2' })]
  const capacity = capacityFor(rows, people), m = compare(rows, capacity)
  assert.equal(m.standardHours, 80); assert.equal(m.weightedDeliveryRate, 30); assert.equal(m.weightedDeliveredHours, 24); assert.equal(m.deliveredHours, 40)
  assert.deepEqual(summarizeStaffDelivery(rows, capacity).map(person => person.weightedDeliveryRate), [20, 40])
  for (const row of rows) row.delivery_progress = 100
  assert.equal(compare(rows, capacity).weightedDeliveryRate, 50)
  assert.deepEqual(summarizeStaffDelivery(rows, capacity).map(person => person.weightedDeliveryRate), [20, 80])
})
check('historical null defaults100, explicit0 stays0, special stays full and ordinary unversioned stays excluded', () => {
  const rows = [record('unknown', '旧未知', 8, null), record('zero', '旧零', 8, 0), record('half', '新需求', 8, 50),
    record('leave', '请假', 8, null, { version: '' }), record('raw', '仅记录', 8, 100, { version: '-' })]
  const m = compare(rows, capacityFor(rows))
  assert.equal(m.recordedHours, 40); assert.equal(m.deliveredHours, 32); assert.equal(m.weightedDeliveredHours, 20)
  assert.equal(m.weightedDeliveryRate, 50); assert.equal(m.knownWeightedDeliveredHours, 12)
  assert.equal(m.requirementProgress, 25); assert.equal(m.progressCoverage, 66.67)
  assert.equal(rows[0].delivery_progress, null); assert.equal(rows[1].delivery_progress, 0)
})
check('valid40h capacity with no effective hours returns0%, while an empty scope returns an em dash', () => {
  const rows = [record('raw', '普通无版本', 8, 100, { version: '' }), record('zero', '零工时', 0, null)]
  const m = compare(rows, capacityFor(rows))
  assert.equal(m.standardHours, 40); assert.equal(m.deliveredHours, 0); assert.equal(m.weightedDeliveryRate, 0); assert.equal(weightedRateText(m), '0%')
  const empty = compare([], capacityFor([]))
  assert.equal(empty.standardHours, 0); assert.equal(empty.weightedDeliveryRate, null); assert.equal(weightedRateText(empty), '—')
})
check('missing second week keeps40h capacity and zero weighted work:40/80=50%,8/80=10%', () => {
  for (const [hours, expected] of [[40, 50], [8, 10]]) for (const progress of [null, 100]) {
    const rows = [record('first', '已填周需求', hours, progress, { task_id: 'w37' })]
    const capacity = capacityFor(rows, [...staff, { id: 'never', employment_status: 'active', role: 'ai_dev' }], [week37, week38])
    const m = compare(rows, capacity), back = buildDeliverySummary(rows, capacity)
    assert.equal(m.standardHours, 80); assert.equal(m.weightedDeliveredHours, hours); assert.equal(m.weightedDeliveryRate, expected)
    assert.deepEqual(back.units.map(unit => [unit.standardHours, unit.weightedDeliveredHours, unit.weightedDeliveryRate]), [[40, hours, expected * 2], [40, 0, 0]])
    assert.deepEqual(summarizeStaffDelivery(rows, capacity).map(person => [person.staffId, person.standardHours, person.weightedDeliveryRate]), [['s1', 80, expected]])
    assert.equal(capacityFor(rows, staff, [week38]).standardHours, 0, 'whole selected range without records excludes the person')
    assert.equal(rows[0].delivery_progress, progress)
  }
})
check('frozen historical-null/zero/special case gives16/40=40% while true progress remains0 and coverage50%', () => {
  const rows = [record('unknown', '历史未知', 8, null), record('zero', '历史零', 8, 0), record('special', '培训', 8, null, { version: '' }), record('raw', '无版本', 8, 100, { version: '' })]
  const before = JSON.stringify(rows), m = compare(rows, capacityFor(rows))
  assert.equal(m.weightedDeliveredHours, 16); assert.equal(m.standardHours, 40); assert.equal(m.weightedDeliveryRate, 40)
  assert.equal(m.requirementProgress, 0); assert.equal(m.progressCoverage, 50); assert.equal(m.missingProgressHours, 8)
  assert.equal(JSON.stringify(rows), before)
})
check('selected latest progress uses8+8 over80=20%, while selecting only old8h at50% over40 gives10%', () => {
  const rows = [record('old', '同一需求', 8, 50, { task_id: 'w37' }), record('new', '同一需求', 8, null)]
  assert.equal(compare(rows, capacityFor(rows, staff, [week37, week38])).weightedDeliveryRate, 20)
  assert.equal(compare(rows, capacityFor(rows, staff, [week37])).weightedDeliveryRate, 10)
  assert.equal(rows[1].delivery_progress, null)
})
check('unequal person capacities use total weighted hours over total expected hours, never an average of rates', () => {
  const rows = [record('a', '需求甲', 8, 100), record('b', '需求乙', 32, 50, { staff_id: 's2' })]
  const people = [...staff, { id: 's2', name: '乙', role: 'ai_dev', employment_status: 'active' }]
  const capacity = capacityFor(rows, people)
  capacity.units[1].workDates = capacity.units[1].workDates.slice(0, 3)
  capacity.units[1].standardHours = 24
  capacity.standardHours = 64
  const m = compare(rows, capacity), perPerson = summarizeStaffDelivery(rows, capacity)
  assert.equal(m.weightedDeliveryRate, 37.5)
  assert.deepEqual(perPerson.map(person => person.weightedDeliveryRate), [20, 66.67])
  assert.notEqual(m.weightedDeliveryRate, (perPerson[0].weightedDeliveryRate + perPerson[1].weightedDeliveryRate) / 2)
})
check('tooltips disclose the period denominator, missing-week rule, and true zero progress coverage', () => {
  const rows = [record('unknown', '历史需求', 32, null)], m = compare(rows, capacityFor(rows))
  assert.equal(m.weightedDeliveryRate, 80); assert.equal(m.requirementProgress, null); assert.equal(m.progressCoverage, 0)
  const tip = deliveryMetricTip(m, 'weightedDeliveryRate')
  for (const text of ['应交付40h', '缺填周仍计应交付', '实际进度填报覆盖0%', '实际需求填报进度未填写', '历史空进度', '原值仍为空']) assert.ok(tip.includes(text), text)
  assert.ok(deliveryMetricTip(m, 'progressCoverage').includes('实际进度填报覆盖0%'))
})
check('same-period latest timestamp compares instants, not date string spelling', () => {
  const rows = [record('a', '需求', 8, 100, { updated_at: '2026-09-18T03:00:00Z' }), record('b', '需求', 8, 0, { updated_at: '2026-09-18T09:30:00+08:00' })]
  const capacity = capacityFor(rows), m = summarizeDelivery(rows, capacity)
  assert.equal(m.requirementProgress, 100, '11:00 China time is later than09:30')
  compare(rows, capacity)
})
check('REQ071 suffixed five-category rows weight by their latest progress (40% -> 3.2h), null stays 100, requirement progress excludes them', () => {
  const rows = [record('a', '张三请假【【23', 8, 40, { version: 'v260914' }), record('b', '培训', 4, null, { version: 'v260914' }), record('c', '需求X', 8, 50)]
  const capacity = capacityFor(rows), m = compare(rows, capacity)
  assert.equal(m.fullCreditHours, 12); assert.equal(m.deliveredHours, 20)
  assert.equal(m.weightedDeliveredHours, 11.2); assert.equal(m.knownWeightedDeliveredHours, 11.2)
  assert.equal(m.requirementProgress, 50); assert.equal(m.progressCoverage, 100); assert.equal(m.missingProgressCount, 0)
  const groups = groupRequirementProgress(rows, capacity)
  assert.equal(groups.find(group => group.fullCredit && group.latest.id === 'a').progress, 40)
  assert.equal(groups.find(group => group.fullCredit && group.latest.id === 'b').progress, 100)
  // two weeks of the same five-category group: latest period decides for both
  const twoWeeks = [record('d', '张三请假', 8, 40, { version: 'v260907', task_id: 'w37' }), record('e', '张三请假', 8, 100, { version: 'v260907' })]
  assert.equal(compare(twoWeeks, capacityFor(twoWeeks, staff, [week37, week38])).weightedDeliveredHours, 16)
  assert.equal(compare(twoWeeks, capacityFor(twoWeeks, staff, [week37])).weightedDeliveredHours, 3.2)
})
check('REQ072 per-period deltas 10/70 + 5/80 + 3/100 accumulate to 18h at 100; selecting the first two weeks gives 15h at 80', () => {
  const week39 = { id: 'w39', title: 'W39', start_date: '2026-09-21', end_date: '2026-09-27', time_dimension: 'week' }
  const rows = [record('a', '需求X', 10, 70, { version: 'V1', task_id: 'w37' }), record('b', '需求X', 5, 80, { version: 'V1', task_id: 'w38' }), record('c', '需求X', 3, 100, { version: 'V1', task_id: 'w39' })]
  const all = capacityFor(rows, staff, [week37, week38, week39])
  const group = groupRequirementProgress(rows, all)[0]
  assert.equal(group.hours, 18); assert.equal(group.progress, 100)
  const m = compare(rows, all)
  assert.equal(m.deliveredHours, 18); assert.equal(m.weightedDeliveredHours, 18); assert.equal(m.requirementProgress, 100)
  const twoWeeks = rows.slice(0, 2), partial = capacityFor(twoWeeks, staff, [week37, week38])
  assert.equal(groupRequirementProgress(twoWeeks, partial)[0].hours, 15); assert.equal(groupRequirementProgress(twoWeeks, partial)[0].progress, 80)
  assert.equal(compare(twoWeeks, partial).weightedDeliveredHours, 12)
  // zero-delta week still moves the group to 100 and keeps the total at 10
  const zeroDelta = [record('a', '需求X', 10, 70, { version: 'V1', task_id: 'w37' }), record('z', '需求X', 0, 100, { version: 'V1', task_id: 'w38' })]
  const zeroCapacity = capacityFor(zeroDelta, staff, [week37, week38])
  assert.deepEqual([groupRequirementProgress(zeroDelta, zeroCapacity)[0].hours, groupRequirementProgress(zeroDelta, zeroCapacity)[0].progress], [10, 100])
  assert.equal(compare(zeroDelta, zeroCapacity).weightedDeliveredHours, 10)
})
console.log(`${passed} passed; ${failed} failed`)
process.exitCode = failed ? 1 : 0
