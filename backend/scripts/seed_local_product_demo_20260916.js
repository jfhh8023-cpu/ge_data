/** Local-only, additive and idempotent AI product chart demo data. No API or notification calls. */
const fs = require('fs');
const path = require('path');
const { v5: uuidv5, v4: uuidv4 } = require('uuid');
process.env.DOTENV_CONFIG_QUIET = 'true';
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!localHosts.has(String(process.env.DB_HOST || '').toLowerCase())) {
  console.error('Refused: this script requires an explicitly configured loopback DB host.');
  process.exit(2);
}

const { Op } = require('sequelize');
const { sequelize, Staff, StaffStatusHistory, StaffFillLink, FillLink, CollectionTask,
  ProductManagerWorkRecord, DemandSource } = require('../src/models');
const SEED = 'local-product-demo-20260916';
const NAMESPACE = 'ed475c21-6fc1-46cb-96b9-30ced5d99570';
const names = ['示例产品-李四', '示例产品-王五', '示例产品-赵六', '示例产品-陈七'];
const manifestPath = path.resolve(__dirname, '../../docs/@development/local_product_demo_20260916.manifest.json');
const idFor = value => uuidv5(`${SEED}:${value}`, NAMESPACE);
const models = { staff: Staff, statusHistory: StaffStatusHistory, staffFillLinks: StaffFillLink,
  fillLinks: FillLink, records: ProductManagerWorkRecord };

function saveManifest(manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temporary = `${manifestPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, manifestPath);
}

async function main() {
  if (!localHosts.has(String(sequelize.config.host || '').toLowerCase())) throw new Error('LOCAL_HOST_GUARD');
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  if (previous && previous.seed !== SEED) throw new Error('MANIFEST_MISMATCH');
  const added = Object.fromEntries(Object.keys(models).map(key => [key, []]));
  let result;
  let manifest;
  await sequelize.transaction(async transaction => {
    const options = { transaction };
    const task = previous?.task?.id
      ? await CollectionTask.findByPk(previous.task.id, options)
      : await CollectionTask.findOne({ ...options, where: { year: 2026, end_date: { [Op.between]: ['2026-07-01', '2026-09-30'] } }, order: [['end_date', 'DESC'], ['created_at', 'DESC']] });
    if (!task) throw new Error('NO_Q3_TASK');
    const sources = await DemandSource.findAll({ ...options, where: { is_active: true }, order: [['sort_order', 'ASC'], ['id', 'ASC']] });
    if (sources.length !== 4) throw new Error('EXPECTED_FOUR_ACTIVE_DEMAND_SOURCES');
    const allProductStaff = await Staff.findAll({ ...options, where: { role: 'ai_pm' } });
    const nonDemo = allProductStaff.filter(person => !names.includes(person.name));
    if (nonDemo.length !== 1 || nonDemo[0].name !== '张三') throw new Error('EXISTING_STAFF_SCOPE_CHANGED');
    const preservedRecords = await ProductManagerWorkRecord.findAll({ ...options, where: { staff_id: nonDemo[0].id }, raw: true });
    if (!preservedRecords.some(record => record.task_id === task.id && Number(record.hours) > 0)) throw new Error('EXISTING_PERSON_HAS_NO_SELECTED_TASK_HOURS');
    const preservedSnapshot = JSON.stringify(preservedRecords);
    const effectiveAt = new Date(`${task.start_date}T00:00:00+08:00`);
    const now = new Date();
    const demoStaff = [];

    async function insertOwned(key, values, expected) {
      const existing = await models[key].findByPk(values.id, options);
      if (existing) {
        if (!expected(existing)) throw new Error(`OWNERSHIP_MISMATCH_${key}`);
        return existing;
      }
      const created = await models[key].create(values, options);
      added[key].push(created.id);
      return created;
    }

    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      const staffId = idFor(`staff:${name}`);
      const nameCollision = allProductStaff.find(person => person.name === name && person.id !== staffId);
      if (nameCollision) throw new Error('DEMO_NAME_ALREADY_OWNED');
      await insertOwned('staff', { id: staffId, name, phone: null, role: 'ai_pm', employment_status: 'active',
        is_active: true, status_changed_at: effectiveAt, created_at: now, sort_order: 100 + index },
      row => row.name === name && row.role === 'ai_pm');
      await insertOwned('statusHistory', { id: idFor(`status:${staffId}`), staff_id: staffId, status: 'active',
        started_at: effectiveAt, ended_at: null, created_at: now }, row => row.staff_id === staffId && row.status === 'active');
      await insertOwned('staffFillLinks', { id: idFor(`staff-link:${staffId}`), staff_id: staffId,
        token: `local_demo_${uuidv4().replace(/-/g, '')}`, created_at: now, updated_at: now }, row => row.staff_id === staffId);
      const linkId = idFor(`task-link:${task.id}:${staffId}`);
      await insertOwned('fillLinks', { id: linkId, task_id: task.id, staff_id: staffId,
        token: `local_demo_${uuidv4().replace(/-/g, '')}`, is_submitted: true,
        last_action: 'submitted', last_action_at: now, created_at: now }, row => row.staff_id === staffId && row.task_id === task.id);
      const hours = [8, 10, 6, 8].map(value => value + index * 2);
      const recordIds = [];
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        const source = sources[sourceIndex];
        const id = idFor(`record:${task.id}:${staffId}:${source.id}`);
        recordIds.push(id);
        await insertOwned('records', { id, link_id: linkId, task_id: task.id, staff_id: staffId,
          requirement_title: `【本地示例】产品图表展示 ${source.name}（20260916）`,
          version: sourceIndex === 3 ? '' : `DEMO-2026.09.${index + 1}`,
          demand_sources: [source.name], demand_source_ids: [source.id], demand_source_weights: { [source.name]: 100 },
          hours: hours[sourceIndex], delivery_progress: [100, 80, 60, 100][sourceIndex],
          created_at: new Date(now.getTime() - (index * 4 + sourceIndex) * 1000), updated_at: now,
          is_active: true, edit_count: 0, submit_count: 1 },
        row => row.staff_id === staffId && row.task_id === task.id && row.requirement_title.startsWith('【本地示例】'));
      }
      demoStaff.push({ id: staffId, name, hours: hours.reduce((sum, value) => sum + value, 0), recordIds });
    }
    const preservedAfter = await ProductManagerWorkRecord.findAll({ ...options, where: { staff_id: nonDemo[0].id }, raw: true });
    if (JSON.stringify(preservedAfter) !== preservedSnapshot) throw new Error('EXISTING_RECORDS_CHANGED');
    const created = Object.fromEntries(Object.keys(models).map(key => [key, [...new Set([...(previous?.created?.[key] || []), ...added[key]])]]));
    result = { localHost: sequelize.config.host, task: { id: task.id, title: task.title, start_date: task.start_date, end_date: task.end_date },
      createdCounts: Object.fromEntries(Object.entries(added).map(([key, values]) => [key, values.length])),
      preserved: { staffId: nonDemo[0].id, name: nonDemo[0].name, recordCount: preservedAfter.length }, demoStaff };
    manifest = { seed: SEED, status: 'prepared', task: result.task, created, demoStaff,
      sources: sources.map(source => ({ id: source.id, name: source.name })),
      runs: [...(previous?.runs || []), { at: now.toISOString(), created: added, counts: result.createdCounts }],
      note: 'Only local demo rows. Tokens and DB credentials intentionally omitted. Remove only created IDs, child tables before staff.' };
    // Persist IDs before commit, so a filesystem failure rolls the DB transaction back.
    saveManifest(manifest);
  });
  manifest.status = 'committed';
  saveManifest(manifest);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  // Connection errors may contain configuration; expose only controlled codes/names.
  console.error(JSON.stringify({ error: error.name, code: error.original?.code || (/^[A-Z_]+$/.test(error.message) ? error.message : 'SEED_FAILED') }));
  process.exitCode = 1;
}).finally(() => sequelize.close());
