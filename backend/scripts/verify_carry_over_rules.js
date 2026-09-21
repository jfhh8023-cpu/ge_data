/**
 * REQ-070 CO4-D-001~003 (+ REQ-071 FC4-S-002): pure-function checks for buildCarryOverRows (no DB, no network).
 * Usage: node scripts/verify_carry_over_rules.js
 */
const assert = require('assert');
const { buildCarryOverRows } = require('../src/services/DeliverySummaryService');

const STAFF = 'staff-1';
const tasks = [
  { id: 'w1', title: '第36周', week_number: 36, start_date: '2026-08-31', end_date: '2026-09-06' },
  { id: 'w2', title: '第37周', week_number: 37, start_date: '2026-09-07', end_date: '2026-09-13' },
  { id: 'w3', title: '第38周', week_number: 38, start_date: '2026-09-14', end_date: '2026-09-20' }
];
const current = tasks[2];
const rec = (id, task_id, requirement_title, version, delivery_progress, extra = {}) =>
  ({ id, task_id, staff_id: STAFF, requirement_title, version, hours: 8, delivery_progress, created_at: `${task_id}-${id}`, ...extra });

const records = [
  rec('a1', 'w1', 'A需求', 'V1.0', 40), rec('a2', 'w2', 'A需求', 'V1.0', 100),          // A: latest 100 -> excluded
  rec('b1', 'w1', 'B需求', 'V1.1', 100), rec('b2', 'w2', 'B需求', 'V1.1', 40, { product_managers: '["PM甲"]' }), // B: latest 40 -> carried (JSON string column)
  rec('c1', 'w2', 'C需求', 'V2.0', 0),                                                    // C: 0 -> carried, progress null, previous 0
  rec('d1', 'w2', 'D需求', 'V2.1', null),                                                 // D: historical null -> excluded
  rec('e1', 'w2', '请假', 'v260907', 50),                                                 // E: full credit 50 -> carried (REQ-071)
  rec('e2', 'w2', '张三培训', 'v260907', null),                                           // E2: full credit null -> excluded
  rec('f1', 'w2', 'F需求', '-', 30),                                                      // F: no version -> excluded
  rec('g1', 'w1', 'G需求', 'V3.0', 60, { product_managers: ['PM乙'] }),                  // G: only in w1 -> carried 60
  rec('h1', 'w3', 'H需求', 'V4.0', 20)                                                    // H: in current task -> ignored
];

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.message }); }
}

const rows = buildCarryOverRows(records, tasks, current);
const byTitle = Object.fromEntries(rows.map(row => [row.requirement_title, row]));

check('CO4-D-001 candidate set is exactly B, C, G + five-category E (REQ-071)', () => {
  assert.deepStrictEqual(Object.keys(byTitle).sort(), ['B需求', 'C需求', 'G需求', '请假']);
  assert.strictEqual(byTitle['请假'].delivery_progress, 50);
  assert.strictEqual(byTitle['请假'].version, 'v260907');
});
check('CO4-D-001 B carries latest 40 with parsed product_managers and source week 37', () => {
  assert.strictEqual(byTitle['B需求'].delivery_progress, 40);
  assert.deepStrictEqual(byTitle['B需求'].product_managers, ['PM甲']);
  assert.strictEqual(byTitle['B需求']._carry_over.source_week_number, 37);
  assert.strictEqual(byTitle['B需求']._carry_over.previous_progress, 40);
});
check('CO4-D-001 C progress 0 -> delivery_progress null, previous_progress 0', () => {
  assert.strictEqual(byTitle['C需求'].delivery_progress, null);
  assert.strictEqual(byTitle['C需求']._carry_over.previous_progress, 0);
});
check('CO4-D-001 G carried from two weeks back (all earlier tasks, D1 default)', () => {
  assert.strictEqual(byTitle['G需求'].delivery_progress, 60);
  assert.strictEqual(byTitle['G需求']._carry_over.source_task_id, 'w1');
});
check('CO4-A-003 rows have no id / existing_record_id', () => {
  for (const row of rows) { assert.ok(!('id' in row)); assert.ok(!('existing_record_id' in row)); }
});
check('CO4-D-001 ordering: newer source week first', () => {
  assert.deepStrictEqual(rows.map(row => row._carry_over.source_task_id), ['w2', 'w2', 'w2', 'w1']);
});
check('CO4-D-002 no current task / no earlier tasks -> []', () => {
  assert.deepStrictEqual(buildCarryOverRows(records, tasks, null), []);
  assert.deepStrictEqual(buildCarryOverRows(records, tasks, tasks[0]), []);
});
check('CO4-D-003 Sequelize-like instances (toJSON) are accepted', () => {
  const wrap = value => ({ toJSON: () => value });
  const wrapped = buildCarryOverRows(records.map(wrap), tasks.map(wrap), wrap(current));
  assert.strictEqual(wrapped.length, 4);
});
check('CH4-P-001 previous_hours sums all earlier periods of the group; history_weeks ascend by end_date', () => {
  assert.strictEqual(byTitle['B需求']._carry_over.previous_hours, 16);
  assert.deepStrictEqual(byTitle['B需求']._carry_over.history_weeks.map(week => [week.week_number, week.hours]), [[36, 8], [37, 8]]);
  assert.strictEqual(byTitle['G需求']._carry_over.previous_hours, 8);
  assert.deepStrictEqual(byTitle['G需求']._carry_over.history_weeks.map(week => [week.week_number, week.hours]), [[36, 8]]);
});
check('CH4-P-002/003 zero-hour rows appear in the breakdown, string hours parse, invalid hours count as 0', () => {
  const rows = buildCarryOverRows([
    rec('z1', 'w1', 'Z需求', 'V9', 50, { hours: '4.50' }), rec('z2', 'w2', 'Z需求', 'V9', 70, { hours: 0 }),
    rec('y1', 'w1', 'Y需求', 'V8', 30, { hours: 'abc' }), rec('y2', 'w2', 'Y需求', 'V8', 40, { hours: 2 })
  ], tasks, current);
  const z = rows.find(row => row.requirement_title === 'Z需求')._carry_over, y = rows.find(row => row.requirement_title === 'Y需求')._carry_over;
  assert.strictEqual(z.previous_hours, 4.5); assert.deepStrictEqual(z.history_weeks.map(week => week.hours), [4.5, 0]);
  assert.strictEqual(y.previous_hours, 2); assert.deepStrictEqual(y.history_weeks.map(week => week.hours), [0, 2]);
});
check('CO4-D-001 product manager records keep demand sources and weights', () => {
  const pm = buildCarryOverRows([rec('p1', 'w2', 'P需求', 'V5.0', 50, { demand_sources: ['甲', '乙'], demand_source_ids: [1, 2], demand_source_weights: '{"甲":60,"乙":40}' })], tasks, current);
  assert.deepStrictEqual(pm[0].demand_sources, ['甲', '乙']);
  assert.deepStrictEqual(pm[0].demand_source_weights, { 甲: 60, 乙: 40 });
});

for (const result of results) console.log(`${result.status}  ${result.name}${result.error ? `  -- ${result.error}` : ''}`);
const failed = results.filter(result => result.status === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
