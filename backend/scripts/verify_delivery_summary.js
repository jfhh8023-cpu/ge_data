/* Pure, read-only delivery-metric regression checks. */
const assert = require('node:assert/strict');
const { buildDeliverySummary, hasValidVersion, versionTypeOf } = require('../src/services/DeliverySummaryService');
const { buildWorkHours } = require('../src/services/WorkHoursCompletionService');
const snapshots = new Map([[2026, require('../src/data/holidays/2026.json')]]);
const staff = [{ id: 's1', name: '测试人员', role: 'ai_dev', employment_status: 'active' }];
const tasks = [{ id: 't1', time_dimension: 'week', start_date: '2026-09-07', end_date: '2026-09-13' }];
const row = (id, hours, version, extra = {}) => ({ id, task_id: 't1', staff_id: 's1', hours, version, ...extra });
const capacity = (records, options = {}) => buildWorkHours({ tasks, staff, snapshots, records, ...options });
let checked = 0;
function check(name, run) { run(); checked += 1; console.log(`PASS ${name}`); }

check('version eligibility trims whitespace and excludes only empty values and a lone hyphen', () => {
  for (const value of [null, undefined, '', ' ', '\n\t', '-', ' - ']) assert.equal(hasValidVersion(value), false);
  for (const value of ['v1', ' v1 ', '0', 'v-2']) assert.equal(hasValidVersion(value), true);
  assert.equal(versionTypeOf({ version: ' - ' }), 'no_version');
  assert.equal(versionTypeOf({ version: ' v1 ' }), 'versioned');
});
check('32 versioned hours at manual 0% plus 16 blank hours at manual 100% deliver 32h and 80%', () => {
  const records = [row('a', 32, ' v1 ', { delivery_progress: 0 }), row('b', 16, ' ', { delivery_progress: 100 })];
  const result = buildDeliverySummary(records, capacity(records));
  assert.equal(result.deliveredHours, 32);
  assert.equal(result.recordedHours, 48);
  assert.equal(result.unversionedHours, 16);
  assert.equal(result.standardHours, 40);
  assert.equal(result.deliveryRate, 80);
  assert.equal(result.units[0].deliveredHours, 32);
  assert.equal(result.units[0].recordedHours, 48);
});
check('recorded manual progress and historical flags cannot override delivery hours or rate', () => {
  for (const progress of [null, 0, 50, 100]) {
    const records = [row('a', 32, 'v1', { delivery_progress: progress, historical_progress_override: true })];
    assert.equal(buildDeliverySummary(records, capacity(records)).deliveryRate, 80);
  }
});
check('40/40 and 48/40 yield 100% and 120% without a cap', () => {
  for (const [hours, expected] of [[40, 100], [48, 120]]) {
    const records = [row('a', hours, 'v1', { delivery_progress: 0 })];
    assert.equal(buildDeliverySummary(records, capacity(records)).deliveryRate, expected);
  }
});
check('unversioned rows preserve recorded hours and the same capacity while contributing zero delivered hours', () => {
  const records = [row('a', 16, '-'), row('b', 16, null), row('c', 16, ' - ')];
  const result = buildDeliverySummary(records, capacity(records));
  assert.equal(result.deliveredHours, 0);
  assert.equal(result.recordedHours, 48);
  assert.equal(result.unversionedHours, 48);
  assert.equal(result.standardHours, 40);
  assert.equal(result.deliveryRate, 0);
});
check('people without records in the selected scope do not enter the denominator', () => {
  const records = [row('a', 32, 'v1')];
  const result = buildDeliverySummary(records, capacity(records, { staff: [...staff, { ...staff[0], id: 's2' }] }));
  assert.equal(result.standardHours, 40);
  assert.equal(result.deliveryRate, 80);
  assert.equal(result.units.some(unit => unit.staffId === 's2'), false);
});
check('different calendar capacities weight by person-workdays rather than averaging percentages', () => {
  const selected = [...tasks, { ...tasks[0], id: 't2', start_date: '2026-10-05', end_date: '2026-10-11' }];
  const records = [row('a', 32, 'v1'), row('b', 16, 'v2', { task_id: 't2' }), row('c', 48, '', { task_id: 't2' })];
  const result = buildDeliverySummary(records, capacity(records, { tasks: selected }));
  assert.equal(result.standardHours, 64);
  assert.equal(result.deliveredHours, 48);
  assert.equal(result.deliveryRate, 75);
});
check('duplicate records and overlapping periods do not duplicate delivered hours or capacity', () => {
  const records = [row('a', 32, 'v1'), row('a', 32, 'v1'), row('b', 8, 'v2', { task_id: 't2' })];
  const result = buildDeliverySummary(records, capacity(records, { tasks: [...tasks, { ...tasks[0], id: 't2' }] }));
  assert.equal(result.standardHours, 40);
  assert.equal(result.deliveredHours, 40);
  assert.equal(result.deliveryRate, 100);
});
check('allocated demand-source hours are used instead of original record hours', () => {
  const records = [row('a', 30, 'v1', { originalHours: 40 })];
  assert.equal(buildDeliverySummary(records, capacity(records)).deliveryRate, 75);
});
check('zero-workday holiday week preserves delivered hours and returns a null rate', () => {
  const records = [row('a', 8, 'v1')];
  const selected = [{ ...tasks[0], start_date: '2026-02-16', end_date: '2026-02-22' }];
  const result = buildDeliverySummary(records, capacity(records, { tasks: selected }));
  assert.equal(result.deliveredHours, 8);
  assert.equal(result.standardHours, 0);
  assert.equal(result.deliveryRate, null);
});
check('an invalid mixed period cannot claim a definitive rate', () => {
  const records = [row('a', 32, 'v1'), row('b', 8, 'v1', { task_id: 'invalid' })];
  const selected = [...tasks, { ...tasks[0], id: 'invalid', start_date: 'invalid' }];
  const result = buildDeliverySummary(records, capacity(records, { tasks: selected }));
  assert.equal(result.deliveredHours, 40);
  assert.equal(result.deliveryRate, null);
  assert.equal(result.calendarStatus, 'invalid_period');
});
check('missing calendars stay explicitly estimated and empty scopes have no capacity', () => {
  const result = buildDeliverySummary([], capacity([], { snapshots: new Map() }));
  assert.equal(result.deliveryRate, null);
  assert.equal(result.calendarStatus, 'weekday_fallback');
  assert.match(result.calendarNote, /估算/);
});
check('out-of-scope people or tasks cannot contribute to the numerator', () => {
  const records = [row('a', 32, 'v1'), row('b', 100, 'v1', { staff_id: 'other' }), row('c', 100, 'v1', { task_id: 'other' })];
  const result = buildDeliverySummary(records, capacity(records));
  assert.equal(result.deliveredHours, 32);
  assert.equal(result.deliveryRate, 80);
});
console.log(`Verified ${checked} delivery-summary scenarios.`);
