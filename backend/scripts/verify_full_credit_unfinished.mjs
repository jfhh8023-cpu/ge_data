// REQ-071 FC4-U-003 (list part): a five-category group below 100 appears in the REQ-069 unfinished list; 100/null do not.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { incompleteRequirementRows } from '../../frontend/src/utils/deliveryStatus.js'
const require = createRequire(import.meta.url)
const { buildWorkHours } = require('../src/services/WorkHoursCompletionService.js')

const staff = [{ id: 's1', name: '甲', role: 'ai_dev', employment_status: 'active' }]
const week37 = { id: 'w37', title: 'W37', start_date: '2026-09-07', end_date: '2026-09-13', time_dimension: 'week', week_number: 37 }
const week38 = { id: 'w38', title: 'W38', start_date: '2026-09-14', end_date: '2026-09-20', time_dimension: 'week', week_number: 38 }
const record = (id, title, hours, progress, extra = {}) => ({ id, requirement_title: title, hours, delivery_progress: progress, version: 'v260907', staff_id: 's1', task_id: 'w38', source_type: 'engineering', staff: staff[0], ...extra })
const records = [
  record('a', '张三请假【【23', 8, 40),
  record('b', '培训', 4, null),
  record('c', '出差', 2, 100),
  record('d', '需求X', 8, 50, { version: 'V1.0' }),
  record('e', '李四团建', 8, 40, { task_id: 'w37' }), record('f', '李四团建', 8, 100)
]
const tasks = [week37, week38]
const capacity = buildWorkHours({ records, staff, tasks })
const rows = incompleteRequirementRows(records, capacity, tasks)
const titles = rows.map(row => row.requirementTitle ?? row.title ?? row.requirement_title ?? row.key).map(String)
assert.equal(rows.length, 2, JSON.stringify(rows))
assert.ok(titles.some(title => title.includes('张三请假【【23')), 'five-category 40% listed')
assert.ok(titles.some(title => title.includes('需求X')), 'ordinary 50% listed')
assert.ok(!titles.some(title => title.includes('培训')), 'null five-category reads 100, not listed')
assert.ok(!titles.some(title => title.includes('出差')), '100 not listed')
assert.ok(!titles.some(title => title.includes('团建')), 'group whose latest period is 100 not listed')
const onlyW37 = incompleteRequirementRows(records, buildWorkHours({ records, staff, tasks: [week37] }), tasks)
assert.ok(onlyW37.some(row => JSON.stringify(row).includes('李四团建')), 'selecting only the earlier week still shows 40%')
console.log('PASS FC4-U-003 unfinished list includes five-category <100 and follows latest-period rule')
