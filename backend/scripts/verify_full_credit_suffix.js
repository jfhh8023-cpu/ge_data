/**
 * REQ-071 FC4-M-001/002, FC4-P-001/002, FC4-S-001/002: pure-function checks, no DB.
 * Usage: node scripts/verify_full_credit_suffix.js
 */
const assert = require('assert');
const { isFullCreditRecord, fullCreditCategoryOf, fullCreditProgress, normalizeFullCreditRecord, fullCreditVersionKey, dateVersion } = require('../src/services/EffectiveHoursService');
const { buildDeliverySummary, buildCarryOverRows } = require('../src/services/DeliverySummaryService');

const results = [];
const check = (name, fn) => { try { fn(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); } };

check('FC4-M-001 suffix / traditional / trailing symbols, digits and letters match', () => {
  const hits = ['请假', ' 请假 ', '培训', '公司会议', '出差', '团建', '张三请假', '张三“请假', '张三”请假“', '张三‘请假’@@', '张三请假【【23', '请假abc', '请假ABC 12', '出差（2）', '团建!!!', '請假', '培訓', '張三團建12', '張三公司會議', '年假请假'];
  for (const title of hits) assert.ok(isFullCreditRecord(title), `should match: ${title}`);
  assert.ok(isFullCreditRecord({ requirement_title: '张三出差 2' }));
  assert.strictEqual(fullCreditCategoryOf('張三公司會議!!'), '公司会议');
  assert.strictEqual(fullCreditCategoryOf('张三请假【【23'), '请假');
});

check('FC4-M-002 ordinary titles stay ordinary', () => {
  const misses = ['培训系统开发', '公司会议纪要', '请假申请开发', '出差报销', '团建活动平台', '请假开发', '公司会', 'abc', '123', '“”', '', null, undefined, '请假 开发', '出差（北京）'];
  for (const title of misses) assert.ok(!isFullCreditRecord(title), `should not match: ${title}`);
  assert.ok(!isFullCreditRecord({ requirement_title: '培训系统开发' }));
});

check('FC4-P-001 fullCreditProgress: empty -> 100, valid kept, invalid -> 400', () => {
  for (const value of [null, undefined, '', '  ']) assert.strictEqual(fullCreditProgress(value), 100);
  assert.strictEqual(fullCreditProgress(40), 40);
  assert.strictEqual(fullCreditProgress('40'), 40);
  assert.strictEqual(fullCreditProgress(1), 1);
  for (const value of [5, 0, 101, 'x', 55]) {
    assert.throws(() => fullCreditProgress(value), error => error.status === 400 && /交付进度/.test(error.message), `should reject ${value}`);
  }
});

check('FC4-P-002 normalizeFullCreditRecord keeps progress, defaults 100, honours only verified carried versions', () => {
  const now = new Date('2026-09-21T09:00:00+08:00');
  const today = dateVersion(now);
  const plain = normalizeFullCreditRecord({ requirement_title: ' 张三请假 ', hours: 8 }, null, now);
  assert.strictEqual(plain.requirement_title, '张三请假');
  assert.strictEqual(plain.version, today);
  assert.strictEqual(plain.delivery_progress, 100);
  assert.deepStrictEqual(plain.product_managers, []);
  assert.strictEqual(normalizeFullCreditRecord({ requirement_title: '请假', hours: 8, delivery_progress: 40 }, null, now).delivery_progress, 40);
  const allowed = new Set([fullCreditVersionKey('张三请假', 'v260914')]);
  assert.strictEqual(normalizeFullCreditRecord({ requirement_title: '张三请假', version: 'v260914', hours: 8 }, null, now, { allowedVersions: allowed }).version, 'v260914');
  assert.strictEqual(normalizeFullCreditRecord({ requirement_title: '张三请假', version: 'V260914', hours: 8 }, null, now, { allowedVersions: allowed }).version, 'v260914');
  assert.strictEqual(normalizeFullCreditRecord({ requirement_title: '张三请假', version: 'v250101', hours: 8 }, null, now, { allowedVersions: allowed }).version, today, 'forged version must be regenerated');
  assert.strictEqual(normalizeFullCreditRecord({ requirement_title: '李四请假', version: 'v260914', hours: 8 }, null, now, { allowedVersions: allowed }).version, today, 'other title cannot borrow');
  assert.strictEqual(normalizeFullCreditRecord({ requirement_title: '张三请假', version: 'v260914', hours: 8 }, null, now).version, today, 'no allow-list -> today');
  const previous = { requirement_title: '张三请假', version: 'v260901', delivery_progress: null };
  const edited = normalizeFullCreditRecord({ requirement_title: '张三请假', version: 'v260914', hours: 8 }, previous, now, { allowedVersions: allowed });
  assert.strictEqual(edited.version, 'v260901', 'saved original still wins');
  assert.strictEqual(normalizeFullCreditRecord({ requirement_title: '普通需求', version: 'V1.0', delivery_progress: null }, null, now).delivery_progress, null, 'ordinary untouched');
});

const task = (id, start, end) => ({ id, start_date: start, end_date: end, week_number: Number(id.slice(1)), title: `W${id.slice(1)}` });
const w36 = task('t36', '2026-08-31', '2026-09-06'), w37 = task('t37', '2026-09-07', '2026-09-13');
const unit = (taskId, standardHours = 40) => ({ staffId: 's1', taskId, startDate: null, endDate: taskId === 't36' ? w36.end_date : w37.end_date, standardHours, calendarStatus: 'ok' });
const record = (id, taskId, requirement_title, version, hours, delivery_progress) => ({ id, task_id: taskId, staff_id: 's1', requirement_title, version, hours, delivery_progress, created_at: `2026-09-0${taskId === 't36' ? 1 : 8}T00:00:00Z` });

check('FC4-S-001 buildDeliverySummary weights five categories by their latest progress; null still 100; requirementProgress excludes them', () => {
  const rows = [record('a', 't37', '张三请假', 'v260907', 8, 40), record('b', 't37', '培训', 'v260907', 4, null), record('c', 't37', '需求X', 'V1.0', 8, 50)];
  const summary = buildDeliverySummary(rows, { units: [unit('t37')], standardHours: 40, calendarStatus: 'ok' });
  assert.strictEqual(summary.deliveredHours, 20);
  assert.strictEqual(summary.fullCreditHours, 12);
  assert.strictEqual(summary.fullCreditWeightedHours, 3.2 + 4);
  assert.strictEqual(summary.weightedDeliveredHours, 3.2 + 4 + 4);
  assert.strictEqual(summary.requirementProgress, 50, 'five categories do not enter requirement progress');
  assert.strictEqual(summary.progressCoverage, 100);
  assert.strictEqual(summary.missingProgressCount, 0);
  // same group across two weeks: latest period wins (w36 40 -> w37 100 => both weeks count at 100)
  const twoWeeks = [record('d', 't36', '张三请假', 'v260831', 8, 40), record('e', 't37', '张三请假', 'v260831', 8, 100)];
  const merged = buildDeliverySummary(twoWeeks, { units: [unit('t36'), unit('t37')], standardHours: 80, calendarStatus: 'ok' });
  assert.strictEqual(merged.weightedDeliveredHours, 16);
  const onlyEarlier = buildDeliverySummary(twoWeeks, { units: [unit('t36')], standardHours: 40, calendarStatus: 'ok' });
  assert.strictEqual(onlyEarlier.weightedDeliveredHours, 3.2);
});

check('FC4-S-002 buildCarryOverRows includes five categories below 100 with their source version; null/100 excluded', () => {
  const rows = [record('a', 't36', '张三请假', 'v260831', 8, 40), record('b', 't36', '培训', 'v260831', 8, null), record('c', 't36', '出差', 'v260831', 8, 100), record('d', 't36', '需求X', 'V1.0', 8, 60)];
  const carried = buildCarryOverRows(rows, [w36, w37], w37);
  assert.deepStrictEqual(carried.map(row => [row.requirement_title, row.version, row.delivery_progress]).sort(), [['张三请假', 'v260831', 40], ['需求X', 'V1.0', 60]]);
});

for (const result of results) console.log(`${result.status}  ${result.name}${result.error ? `  -- ${result.error}` : ''}`);
const failed = results.filter(result => result.status === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
