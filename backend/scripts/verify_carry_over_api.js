/**
 * REQ-070 CO4-A-001~004: API check against the local backend.
 * Uses real local tokens when available; otherwise creates an isolated fixture staff (name prefix REQ070_)
 * with <100 progress in two earlier tasks, and always deletes it in finally. Local DB only.
 * Usage: node scripts/verify_carry_over_api.js   (backend must be running on 3001)
 */
const assert = require('assert');
const { v4: uuidv4 } = require('uuid');
const { sequelize, StaffFillLink, CollectionTask, Staff, WorkRecord } = require('../src/models');

const FIXTURE_PREFIX = 'REQ070_';
const fixture = { staffId: null };

async function createFixture(current) {
  const earlier = await CollectionTask.findAll({ where: { start_date: { [require('sequelize').Op.lt]: current.start_date } }, order: [['start_date', 'DESC']], limit: 2 });
  assert.ok(earlier.length === 2, 'need two earlier tasks for fixture');
  const [last, beforeLast] = earlier;
  const staff = await Staff.create({ id: uuidv4(), name: `${FIXTURE_PREFIX}测试员`, role: 'ai_dev', employment_status: 'active', is_active: true, sort_order: 9999 });
  fixture.staffId = staff.id;
  const sfl = await StaffFillLink.create({ id: uuidv4(), staff_id: staff.id, token: `${FIXTURE_PREFIX}${uuidv4()}` });
  const row = (task, requirement_title, version, delivery_progress) => ({ id: uuidv4(), task_id: task.id, staff_id: staff.id, requirement_title, version, hours: 8, delivery_progress, product_managers: ['测试PM'], submit_count: 1 });
  await WorkRecord.bulkCreate([
    row(beforeLast, `${FIXTURE_PREFIX}A需求`, 'V1.0', 40), row(last, `${FIXTURE_PREFIX}A需求`, 'V1.0', 100),
    row(beforeLast, `${FIXTURE_PREFIX}B需求`, 'V1.1', 100), row(last, `${FIXTURE_PREFIX}B需求`, 'V1.1', 40),
    row(last, `${FIXTURE_PREFIX}C需求`, 'V2.0', 0),
    row(last, `${FIXTURE_PREFIX}D需求`, 'V2.1', null),
    row(beforeLast, `${FIXTURE_PREFIX}G需求`, 'V3.0', 60)
  ]);
  return { staff, sfl, last, beforeLast };
}

async function cleanupFixture() {
  if (!fixture.staffId) return;
  await WorkRecord.destroy({ where: { staff_id: fixture.staffId } });
  await StaffFillLink.destroy({ where: { staff_id: fixture.staffId } });
  await Staff.destroy({ where: { id: fixture.staffId } });
  const [left] = await sequelize.query('SELECT COUNT(*) n FROM work_records WHERE requirement_title LIKE :p', { replacements: { p: `${FIXTURE_PREFIX}%` } });
  console.log(`fixture cleaned, remaining fixture rows: ${left[0].n}`);
}

const API = process.env.API_BASE || 'http://127.0.0.1:3001/api';
const results = [];
const check = async (name, fn) => { try { await fn(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); } };

async function main() {
  if (!['localhost', '127.0.0.1', '::1'].includes(String(process.env.DB_HOST || 'localhost'))) throw new Error('local DB only');
  if (process.env.CLEANUP_ONLY === '1') {
    const leftovers = await Staff.findAll({ where: { name: { [require('sequelize').Op.like]: `${FIXTURE_PREFIX}%` } } });
    for (const staff of leftovers) { fixture.staffId = staff.id; await cleanupFixture(); }
    fixture.staffId = null;
    return;
  }
  const current = await CollectionTask.findOne({ where: { is_preferred: true, status: 'active' } })
    || await CollectionTask.findOne({ where: { status: 'active' }, order: [['created_at', 'DESC']] });
  assert.ok(current, 'no active task in local DB');
  console.log('current task:', current.title, current.start_date, 'week', current.week_number);

  const sql = `SELECT w.staff_id, s.name, s.role, COUNT(*) n
    FROM work_records w JOIN staff s ON s.id = w.staff_id JOIN collection_tasks t ON t.id = w.task_id
    WHERE t.start_date < :start AND w.delivery_progress IS NOT NULL AND w.delivery_progress < 100
      AND w.version IS NOT NULL AND w.version <> '' AND w.version <> '-'
      AND w.staff_id NOT IN (SELECT staff_id FROM work_records WHERE task_id = :cur)
    GROUP BY w.staff_id, s.name, s.role LIMIT 3`;
  const [candidates] = await sequelize.query(sql, { replacements: { start: current.start_date, cur: current.id } });
  const [busy] = await sequelize.query('SELECT DISTINCT staff_id FROM work_records WHERE task_id = :cur LIMIT 1', { replacements: { cur: current.id } });

  const fetchFill = async token => { const res = await fetch(`${API}/fill/${token}`); assert.strictEqual(res.status, 200); const body = await res.json(); assert.strictEqual(body.code, 0); return body.data; };

  let carriedData = null;
  for (const candidate of candidates) {
    const sfl = await StaffFillLink.findOne({ where: { staff_id: candidate.staff_id } });
    if (!sfl) continue;
    const data = await fetchFill(sfl.token);
    if (data.blocked || (Array.isArray(data.draft_records) && data.draft_records.length)) continue;
    carriedData = { candidate, data };
    break;
  }
  let created = null;
  if (!carriedData) {
    console.log('no natural candidate in local DB -> using isolated fixture');
    created = await createFixture(current);
    carriedData = { candidate: { name: created.staff.name }, data: await fetchFill(created.sfl.token) };
  }

  await check('CO4-D-001 fixture: carried set is B(40), C(0->null), G(60); A/D excluded', async () => {
    if (!created) return;
    const byTitle = Object.fromEntries(carriedData.data.carry_over_records.map(row => [row.requirement_title.replace(FIXTURE_PREFIX, ''), row]));
    assert.deepStrictEqual(Object.keys(byTitle).sort(), ['B需求', 'C需求', 'G需求']);
    assert.strictEqual(byTitle['B需求'].delivery_progress, 40);
    assert.strictEqual(byTitle['B需求']._carry_over.source_week_number, created.last.week_number);
    assert.strictEqual(byTitle['C需求'].delivery_progress, null);
    assert.strictEqual(byTitle['C需求']._carry_over.previous_progress, 0);
    assert.strictEqual(byTitle['G需求'].delivery_progress, 60);
    assert.deepStrictEqual(byTitle['G需求'].product_managers, ['测试PM']);
  });
  await check('CO4-H-001 GET did not modify fixture history rows', async () => {
    if (!created) return;
    const rows = await WorkRecord.findAll({ where: { staff_id: created.staff.id }, raw: true });
    assert.strictEqual(rows.length, 7);
    assert.strictEqual(rows.filter(r => r.task_id === created.last.id && r.requirement_title.endsWith('B需求'))[0].delivery_progress, 40);
  });
  if (created) console.log('fixture token (for browser check, deleted at exit unless KEEP_FIXTURE=1):', created.sfl.token);

  await check('CO4-A-001 system token without records/draft returns non-empty carry_over_records', async () => {
    assert.ok(carriedData, 'no eligible local candidate found');
    assert.ok(Array.isArray(carriedData.data.carry_over_records) && carriedData.data.carry_over_records.length > 0);
    console.log(`  ${carriedData.candidate.name}: ${carriedData.data.carry_over_records.length} carried rows`);
  });
  await check('CO4-A-003 carried row shape (no id/existing_record_id, has _carry_over)', async () => {
    for (const row of carriedData.data.carry_over_records) {
      for (const key of ['requirement_title', 'version', 'product_managers', 'demand_sources', 'demand_source_ids', 'demand_source_weights', 'delivery_progress', '_carry_over']) assert.ok(key in row, `missing ${key}`);
      assert.ok(!('id' in row) && !('existing_record_id' in row));
      const progress = row.delivery_progress;
      assert.ok(progress === null || (progress > 0 && progress < 100), `progress ${progress}`);
      assert.ok(row._carry_over.previous_progress >= 0 && row._carry_over.previous_progress < 100);
    }
    console.log('  sample:', JSON.stringify(carriedData.data.carry_over_records[0]));
  });
  await check('CO4-A-001 existing response fields unchanged', async () => {
    for (const key of ['linkType', 'staff', 'task', 'workHours', 'records', 'draft_records', 'draft_saved_at', 'is_submitted', 'demandSources']) assert.ok(key in carriedData.data, key);
  });
  await check('CO4-A-001 staff with records in current task gets []', async () => {
    assert.ok(busy.length, 'no staff with current records locally');
    const sfl = await StaffFillLink.findOne({ where: { staff_id: busy[0].staff_id } });
    assert.ok(sfl, 'no token');
    const data = await fetchFill(sfl.token);
    assert.ok(data.records.length > 0);
    assert.deepStrictEqual(data.carry_over_records, []);
  });
  await check('CO4-A-001 invalid token still 404', async () => {
    const res = await fetch(`${API}/fill/not-a-real-token`);
    assert.strictEqual(res.status, 404);
  });
}

main().catch(error => results.push({ name: 'setup', status: 'FAIL', error: error.message })).finally(async () => {
  if (process.env.KEEP_FIXTURE === '1') console.log('KEEP_FIXTURE=1: fixture retained; run with CLEANUP_ONLY=1 later'); else await cleanupFixture();
  await sequelize.close();
  for (const result of results) console.log(`${result.status}  ${result.name}${result.error ? `  -- ${result.error}` : ''}`);
  const failed = results.filter(result => result.status === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
});
