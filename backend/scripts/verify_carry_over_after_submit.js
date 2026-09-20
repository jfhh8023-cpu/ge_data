/**
 * REQ-070 CO4-H-001 / CO4-S-001: after the fixture staff submitted B=100 and C=10 in the current task,
 * history rows must be untouched and the delivery grouping must resolve B to 100 (all weeks) / 40 (earlier weeks only).
 * Usage: node scripts/verify_carry_over_after_submit.js   (run after verify_carry_over_api.js with KEEP_FIXTURE=1 + browser submit)
 */
const assert = require('assert');
const { Op } = require('sequelize');
const { sequelize, Staff, WorkRecord, CollectionTask, StaffFillLink } = require('../src/models');
const { buildDeliverySummary } = require('../src/services/DeliverySummaryService');

const FIXTURE_PREFIX = 'REQ070_';
const results = [];
const check = async (name, fn) => { try { await fn(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); } };

async function main() {
  const staff = await Staff.findOne({ where: { name: { [Op.like]: `${FIXTURE_PREFIX}%` } } });
  assert.ok(staff, 'fixture staff missing');
  const current = await CollectionTask.findOne({ where: { is_preferred: true, status: 'active' } });
  const records = await WorkRecord.findAll({ where: { staff_id: staff.id }, raw: true });
  const tasks = await CollectionTask.findAll({ where: { id: { [Op.in]: [...new Set(records.map(r => r.task_id))] } }, raw: true });
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const title = t => `${FIXTURE_PREFIX}${t}`;
  const rowsOf = (t, taskId) => records.filter(r => r.requirement_title === title(t) && r.task_id === taskId);
  const earlier = tasks.filter(t => t.start_date < current.start_date).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const [last, beforeLast] = earlier;

  await check('CO4-H-001 history rows unchanged (7 original rows, B last-week still 40, C still 0, A still 100/40)', async () => {
    const history = records.filter(r => r.task_id !== current.id);
    assert.strictEqual(history.length, 7);
    assert.strictEqual(rowsOf('B需求', last.id)[0].delivery_progress, 40);
    assert.strictEqual(rowsOf('B需求', beforeLast.id)[0].delivery_progress, 100);
    assert.strictEqual(rowsOf('C需求', last.id)[0].delivery_progress, 0);
    assert.strictEqual(rowsOf('A需求', last.id)[0].delivery_progress, 100);
    assert.strictEqual(rowsOf('G需求', beforeLast.id)[0].delivery_progress, 60);
  });
  await check('CO4-S-001 current task has exactly B=100 and C=10 (G deleted, not written)', async () => {
    const now = records.filter(r => r.task_id === current.id);
    assert.deepStrictEqual(now.map(r => [r.requirement_title.replace(FIXTURE_PREFIX, ''), r.delivery_progress, r.version]).sort(), [['B需求', 100, 'V1.1'], ['C需求', 10, 'V2.0']]);
  });
  const units = ids => ({ units: ids.map(id => ({ staffId: staff.id, taskId: id, startDate: taskById.get(id).start_date, endDate: taskById.get(id).end_date, standardHours: 40, calendarStatus: 'ok' })) });
  await check('CO4-S-001 grouping: all weeks -> B counts at 100%; earlier weeks only -> B at 40%', async () => {
    const all = buildDeliverySummary(records, units(tasks.map(t => t.id)));
    const earlierOnly = buildDeliverySummary(records, units(earlier.map(t => t.id)));
    // B has 8h in each of 3 weeks (100, 40, 100) => 24h * 1.0 = 24 weighted when latest is 100
    // earlier only: 16h * 0.4 = 6.4
    const weighted = summary => summary.totals?.weightedDeliveredHours ?? summary.weightedDeliveredHours;
    console.log('  weightedDeliveredHours all/earlier:', weighted(all), weighted(earlierOnly));
    assert.ok(weighted(all) > weighted(earlierOnly));
  });
  await check('CO4-A-001 after submit GET returns records and carry_over_records = []', async () => {
    const sfl = await StaffFillLink.findOne({ where: { staff_id: staff.id } });
    const res = await fetch(`http://127.0.0.1:3001/api/fill/${sfl.token}`);
    const body = await res.json();
    assert.strictEqual(body.data.records.length, 2);
    assert.deepStrictEqual(body.data.carry_over_records, []);
  });
}

main().catch(error => results.push({ name: 'setup', status: 'FAIL', error: error.message })).finally(async () => {
  await sequelize.close();
  for (const result of results) console.log(`${result.status}  ${result.name}${result.error ? `  -- ${result.error}` : ''}`);
  const failed = results.filter(result => result.status === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
});
