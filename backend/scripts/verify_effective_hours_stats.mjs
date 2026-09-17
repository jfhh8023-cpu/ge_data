// REQ-064 independent hand-calculated regressions; no API, database or business writes.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { summarizeDelivery, summarizeStaffDelivery, groupRequirementProgress, weightedRateText } from '../../frontend/src/utils/deliverySummary.js'
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
const fields = ['recordedHours', 'deliveredHours', 'unversionedHours', 'standardHours', 'deliveryRate', 'fullCreditHours', 'versionedHours', 'weightedDeliveredHours', 'weightedDeliveryRate', 'missingProgressHours', 'missingProgressCount', 'progressKnownHours', 'requirementProgress', 'progressCoverage']
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
check('latest selected period null stays unknown; no fallback or fake0/100', () => {
  const rows = [record('a1', '同需求', 16, 50, { task_id: 'w37', created_at: '2026-10-01T00:00:00Z' }), record('a2', '同需求', 8, null), record('l', '请假', 8, null, { version: '' })]
  const capacity = capacityFor(rows, staff, [week37, week38]), m = summarizeDelivery(rows, capacity)
  assert.equal(m.standardHours, 80); assert.equal(m.deliveredHours, 32); assert.equal(m.deliveryRate, 40)
  assert.equal(m.missingProgressHours, 24); assert.equal(m.missingProgressCount, 1); assert.equal(m.weightedDeliveryRate, null)
  assert.equal(m.requirementProgress, null); assert.equal(m.progressCoverage, 0); assert.equal(weightedRateText(m), '待补进度')
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
check('zero/invalid capacity preserves hours with no false rates; over100 remains', () => {
  const rows = [record('a', '出差', 48, null)], normal = capacityFor(rows)
  for (const cap of [{ ...normal, standardHours: 0 }, { ...normal, calendarStatus: 'invalid_period' }]) {
    const m = compare(rows, cap); assert.equal(m.recordedHours, 48); assert.equal(m.deliveryRate, null); assert.equal(m.weightedDeliveryRate, null); assert.equal(weightedRateText(m), '—')
  }
  assert.equal(compare(rows, normal).weightedDeliveryRate, 120)
})
check('same-period latest timestamp compares instants, not date string spelling', () => {
  const rows = [record('a', '需求', 8, 100, { updated_at: '2026-09-18T03:00:00Z' }), record('b', '需求', 8, 0, { updated_at: '2026-09-18T09:30:00+08:00' })]
  const capacity = capacityFor(rows), m = summarizeDelivery(rows, capacity)
  assert.equal(m.requirementProgress, 100, '11:00 China time is later than09:30')
  compare(rows, capacity)
})
console.log(`${passed} passed; ${failed} failed`)
process.exitCode = failed ? 1 : 0
