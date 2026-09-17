/* REQ-064: pure/in-memory business regressions. No database, server, scheduler or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const effective = require('../src/services/EffectiveHoursService');
const { buildWorkHours } = require('../src/services/WorkHoursCompletionService');
const { buildDeliverySummary, versionTypeOf } = require('../src/services/DeliverySummaryService');
// Two controlled five-day weeks; official holiday/makeup behavior is covered by verify_work_hours_completion.js.
const calendar = new Map([[2026, { days: [] }]]);
const tasks = [
  { id: 'old', start_date: '2026-09-07', end_date: '2026-09-13', time_dimension: 'week' },
  { id: 'now', start_date: '2026-09-14', end_date: '2026-09-20', time_dimension: 'week' }
];
const staff = [
  { id: 'a', name: '甲', role: 'ai_dev', employment_status: 'active' },
  { id: 'b', name: '乙', role: 'ai_pm', employment_status: 'resigned' },
  { id: 'empty', name: '无记录人员', role: 'ai_dev', employment_status: 'active' }
];
const row = (id, hours, progress, extra = {}) => ({ id, hours, delivery_progress: progress, staff_id: 'a',
  task_id: 'now', requirement_title: id, version: 'v1', ...extra });
const capacity = (records, overrides = {}) => buildWorkHours({ tasks: [tasks[1]], staff, snapshots: calendar, records, ...overrides });
const metric = (records, overrides) => buildDeliverySummary(records, capacity(records, overrides));
let checked = 0;
async function check(name, run) { await run(); checked += 1; console.log(`PASS ${name}`); }

function loadModule(relative, dependencies) {
  const filename = path.join(__dirname, relative), exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: exported, exports: exported.exports,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; },
    Date, Map, Set, console, Buffer }, { filename });
  return exported.exports;
}

async function run() {
  await check('five exact trimmed titles retain manually entered decimal hours and ignore forged version/progress', () => {
    for (const title of effective.FULL_CREDIT_TITLES) {
      const result = effective.normalizeFullCreditRecord({ requirement_title: ` ${title} `, hours: 3.5, version: 'v990101', delivery_progress: 10 }, null, new Date('2026-09-16T16:01:00Z'));
      assert.equal(result.hours, 3.5); assert.equal(result.version, 'v260917'); assert.equal(result.delivery_progress, null);
      assert.equal(versionTypeOf({ requirement_title: title, version: '' }), 'versioned');
    }
    for (const title of ['培训系统开发', '公司会议纪要', '请假审批']) assert.equal(effective.isFullCreditRecord({ requirement_title: title }), false);
  });
  await check('China date boundary, special edit preservation and ordinary-to-special today conversion', () => {
    assert.equal(effective.dateVersion(new Date('2026-09-16T15:59:59Z')), 'v260916');
    const now = new Date('2026-09-17T00:00:00Z');
    const input = { requirement_title: '请假', hours: 0, version: 'v991231' };
    assert.equal(effective.normalizeFullCreditRecord(input, { requirement_title: '培训', version: 'v260901' }, now).version, 'v260901');
    assert.equal(effective.normalizeFullCreditRecord(input, { requirement_title: '请假', version: '', created_at: '2026-08-31T16:00:00Z' }, now).version, 'v260901');
    assert.equal(effective.normalizeFullCreditRecord(input, { requirement_title: '普通需求', version: 'v260901', created_at: '2026-08-31T16:00:00Z' }, now).version, 'v260917');
    assert.equal(effective.normalizeFullCreditRecord(input, null, now).hours, 0);
    assert.throws(() => effective.validateManualHours({ hours: '' }), /手动填写/);
    for (const value of [null, undefined, '', false]) assert.equal(effective.normalizeProgress(value), null);
    assert.equal(effective.normalizeProgress(0), 0);
  });
  await check('32 normal version hours + 8 special gives 100% effective, 70% weighted and 62.5% demand progress', () => {
    const m = metric([row('one', 16, 50), row('two', 8, 100), row('three', 8, 50), row('leave', 8, null, { requirement_title: '请假', version: '' })]);
    assert.equal(m.standardHours, 40); assert.equal(m.deliveredHours, 40); assert.equal(m.deliveryRate, 100);
    assert.equal(m.weightedDeliveryRate, 70); assert.equal(m.requirementProgress, 62.5); assert.equal(m.progressCoverage, 100);
    assert.equal(m.fullCreditHours, 8); assert.equal(m.unversionedHours, 0);
  });
  await check('latest selected period progress weights cumulative hours, not newest edit of an older period', () => {
    const records = [row('r-old', 32, 20, { task_id: 'old', requirement_title: '需求', updated_at: '2030-01-01' }),
      row('r-new', 8, 50, { requirement_title: '需求', updated_at: '2026-09-17' })];
    const m = metric(records, { tasks });
    assert.equal(m.standardHours, 80); assert.equal(m.weightedDeliveredHours, 20); assert.equal(m.weightedDeliveryRate, 25); assert.equal(m.requirementProgress, 50);
    assert.equal(m.units.reduce((sum, unit) => sum + unit.weightedDeliveredHours, 0), 20);
    records[1].delivery_progress = null;
    const pending = metric(records, { tasks });
    assert.equal(pending.weightedDeliveredHours, 40); assert.equal(pending.weightedDeliveryRate, 50);
    assert.equal(pending.knownWeightedDeliveredHours, 0); assert.equal(records[1].delivery_progress, null);
    assert.equal(pending.missingProgressHours, 40); assert.equal(pending.missingProgressCount, 1); assert.equal(pending.progressCoverage, 0);
  });
  await check('all five special categories count once, unversioned ordinary hours stay raw, explicit zero stays known', () => {
    const records = effective.FULL_CREDIT_TITLES.map((title, i) => row(`s${i}`, 2, null, { requirement_title: title, version: i % 2 ? '' : 'v260917' }));
    records.push(row('zero', 16, 0), row('unversioned', 8, 100, { version: '-' }));
    const m = metric([...records, records[0]]);
    assert.equal(m.fullCreditHours, 10); assert.equal(m.deliveredHours, 26); assert.equal(m.recordedHours, 34);
    assert.equal(m.weightedDeliveredHours, 10); assert.equal(m.requirementProgress, 0); assert.equal(m.progressCoverage, 100);
  });
  await check('current resignation hides all historical records; restore uses same records and full selected capacity', () => {
    const records = [row('a', 8, 50, { task_id: 'old' }), row('b', 8, 100, { staff_id: 'b' })];
    assert.equal(metric(records, { tasks }).recordedHours, 8);
    const restored = staff.map(person => ({ ...person, employment_status: person.id === 'b' ? 'retained' : person.employment_status }));
    const m = metric(records, { tasks, staff: restored });
    assert.equal(m.recordedHours, 16); assert.equal(m.standardHours, 160); assert.equal(m.units.length, 4);
    assert.equal(metric(records, { tasks: [tasks[0]], staff: restored }).standardHours, 40);
    assert.equal(capacity([]).standardHours, 0);
    assert.equal(capacity([], { staff: [staff[0]], includeEmptyStaff: true }).standardHours, 40);
  });
  await check('overlapping dates deduplicate capacity; both delivery rates are uncapped and require a valid calendar', () => {
    const records = [row('a', 48, 100)];
    assert.equal(metric(records).deliveryRate, 120);
    assert.equal(metric(records).weightedDeliveryRate, 120);
    assert.equal(metric(records, { tasks: [tasks[1], { ...tasks[1], id: 'duplicate' }] }).standardHours, 40);
    assert.equal(metric(records, { tasks: [{ ...tasks[1], start_date: 'invalid' }] }).weightedDeliveryRate, null);
  });
  await check('actual status service hides resigned historical authors and read-filters old snapshots without rewriting', async () => {
    const currentPeople = staff.map(value => ({ ...value }));
    const normalizeRole = role => ({ frontend: 'ai_dev', backend: 'ai_dev', test: 'ai_quality' })[role] || role;
    const statusService = loadModule('../src/services/PersonStatusService.js', {
      uuid: { v4: () => 'unused' }, sequelize: { DataTypes: {}, Op: { in: 'in' } },
      '../models': { Staff: { findAll: async () => currentPeople }, sequelize: {}, ProductManager: {}, StaffStatusHistory: {}, ProductManagerStatusHistory: {} },
      '../utils/parseJson': { safeParseJsonArray: value => Array.isArray(value) ? value : value ? JSON.parse(value) : [] },
      '../utils/beijingTime': require('../src/utils/beijingTime'), './RoleService': { normalizeStaffRole: normalizeRole }
    });
    const records = [row('a', 8, 50, { task_id: 'old' }), row('b', 16, 100, { task_id: 'old', staff_id: 'b' })];
    assert.equal((await statusService.filterRecordsByStaffStatus(records)).length, 1);
    const snapshots = [{ id: 'g', frontend: [{ staffName: '甲', hours: 8 }], role_buckets: { ai_dev: [{ staffName: '甲', hours: 8 }], ai_pm: [{ staffName: '乙', hours: 16 }] } }];
    const before = JSON.stringify(snapshots);
    const visible = await statusService.filterMatchGroupsByStaffStatus(snapshots);
    assert.equal(visible[0].role_buckets.ai_pm.length, 0); assert.equal(JSON.stringify(snapshots), before);
    currentPeople[1].employment_status = 'long_leave';
    assert.equal((await statusService.filterRecordsByStaffStatus(records)).length, 2);
    assert.equal((await statusService.filterMatchGroupsByStaffStatus(snapshots))[0].role_buckets.ai_pm.length, 1);
  });
  await check('matching does not merge same-day categories or different authors into one requirement', () => {
    const matcher = loadModule('../src/services/MatchService.js', {
      uuid: { v4: () => 'group' }, './EffectiveHoursService': effective,
      '../utils/parseJson': { safeParseJsonArray: value => Array.isArray(value) ? value : [] },
      './RoleService': { ROLE_AI_DEV: 'ai_dev', ROLE_AI_QUALITY: 'ai_quality', ROLE_VOIP: 'voip', normalizeStaffRole: value => value || 'ai_dev' }
    });
    const records = [row('a', 4, null, { requirement_title: '培训', version: 'v260917' }),
      row('b', 4, null, { requirement_title: '请假', version: 'v260917' }),
      row('c', 4, null, { requirement_title: '培训', version: 'v260917', staff_id: 'b' }),
      row('normal', 4, 100, { requirement_title: '普通需求', version: 'v260917' })];
    assert.equal(matcher.matchRecords(records).length, 4);
  });

  const entries = { engineering: [], product: [] };
  let failure = false, nextId = 0;
  const matches = (record, where = {}) => Object.entries(where).every(([key, value]) => Array.isArray(value) ? value.includes(record[key]) : value && typeof value === 'object' && value.in ? value.in.includes(record[key]) : record[key] === value);
  const plain = value => JSON.parse(JSON.stringify(value));
  function model(table) {
    return { sequelize: { async transaction(run) {
      const backup = plain(entries);
      try { return await run({}); } catch (error) { entries.engineering = backup.engineering; entries.product = backup.product; throw error; }
    } }, async findAll({ where = {} } = {}) { return entries[table].filter(row => matches(row, where)).map(wrap); },
    async findByPk(id) { const record = entries[table].find(row => row.id === id); return record ? wrap(record) : null; },
    async destroy({ where }) { entries[table] = entries[table].filter(row => !matches(row, where)); },
    async create(value) { if (failure) throw new Error('fixture-write-failure'); const saved = { created_at: new Date(), ...value }; entries[table].push(saved); return wrap(saved); },
    async bulkCreate(values) { const result = []; for (const value of values) result.push(await this.create(value)); return result; } };
  }
  function wrap(record) { return { ...record, toJSON() { const { toJSON, save, ...value } = this; return value; }, async save() { Object.assign(record, this.toJSON()); } }; }
  const WorkRecord = model('engineering'), ProductManagerWorkRecord = model('product');
  const person = { id: 'a', name: '甲', role: 'ai_dev', employment_status: 'active' };
  const task = { ...tasks[1], status: 'active' };
  const sfl = { id: 'sfl', staff_id: 'a', staff: person, draft_data: [], draft_task_id: null, async save() {} };
  const link = { id: 'legacy', staff_id: 'a', task_id: 'now', staff: person, task, draft_data: [], async save() {} };
  let legacy = false;
  const models = { WorkRecord, ProductManagerWorkRecord,
    Staff: { findByPk: async () => person, findAll: async () => [person] },
    StaffFillLink: { findOne: async () => legacy ? null : sfl }, FillLink: { findOne: async () => link },
    CollectionTask: { findByPk: async () => task, findOne: async () => task },
    MatchGroup: { findAll: async () => [], destroy: async () => {}, create: async () => {} } };
  const personService = { STAFF_RESIGNED_MESSAGE: '已离职', assertStaffCanWrite(p) { if (p.employment_status === 'resigned') { const e = new Error('已离职'); e.status = 403; throw e; } },
    buildCurrentStatusPayload: () => ({}), getPmStatusContextByName: async () => new Map(), isNonResigned: p => p.employment_status !== 'resigned',
    collectPmNamesFromRecords: () => [], filterPmNamesForRecord: async () => [], filterRecordsByStaffStatus: async rows => rows };
  const dependencies = {
    '../models': models, uuid: { v4: () => `new-${++nextId}` }, sequelize: { Op: { in: 'in' } },
    '../services/EffectiveHoursService': effective, '../services/MatchService': { matchRecords: () => [] },
    '../services/PersonStatusService': personService,
    '../services/DemandSourceService': { getDemandSourceDefinitions: async () => [], resolveDemandSources: async sources => ({ names: Array.isArray(sources) ? sources : [], ids: [] }) },
    '../services/WorkHoursCompletionService': { buildWorkHours, getWorkHours: async options => buildWorkHours({ ...options, snapshots: calendar }), loadWorkHoursContext: async options => options },
    '../utils/parseJson': { safeParseJsonArray: value => Array.isArray(value) ? value : [] }
  };
  function routeFile(file) {
    const routes = new Map(), router = Object.fromEntries(['get', 'put', 'post', 'delete'].map(method => [method, (url, fn) => routes.set(`${method} ${url}`, fn)]));
    loadModule(`../src/routes/${file}`, { ...dependencies, express: { Router: () => router } });
    return routes;
  }
  const fill = routeFile('fill.js'), crud = routeFile('records.js');
  async function invoke(routes, route, body, params = {}) {
    let result, error, status = 200;
    await routes.get(route)({ body, params: { token: 'fixture', ...params }, query: {} },
      { status(value) { status = value; return this; }, json(value) { result = value; } }, value => { error = value; });
    return { result, error, status };
  }
  await check('actual fill: new special row bypasses normal PM/progress requirements, cannot forge version, and hours stay manual', async () => {
    for (const title of effective.FULL_CREDIT_TITLES) {
      const response = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [{ requirement_title: title, hours: 3.5, version: 'v000000', delivery_progress: 0 }] });
      assert.ifError(response.error); assert.equal(response.status, 200);
      const saved = entries.engineering[0]; assert.equal(saved.hours, 3.5); assert.equal(saved.version, effective.dateVersion()); assert.equal(saved.delivery_progress, null);
    }
    const rejected = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [{ requirement_title: '培训', hours: '' }] });
    assert.match(rejected.error.message, /手动填写/); assert.equal(entries.engineering.length, 1);
  });
  await check('actual fill: original special version survives edits and historical ordinary null remains null', async () => {
    entries.engineering = [{ id: 'special', task_id: 'now', staff_id: 'a', requirement_title: '请假', hours: 8, version: 'v260901', created_at: '2026-09-01T02:00:00Z' },
      { id: 'historic', task_id: 'now', staff_id: 'a', requirement_title: '原需求', hours: 8, version: 'v1', delivery_progress: null, created_at: '2026-09-01T02:00:00Z' }];
    const response = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [
      { existing_record_id: 'special', requirement_title: '培训', hours: 4, version: 'v000000' },
      { existing_record_id: 'historic', requirement_title: '原需求', hours: 8, version: 'v1', product_managers: ['正常PM'], delivery_progress: null }
    ] });
    assert.ifError(response.error); assert.equal(response.status, 200);
    assert.equal(entries.engineering[0].version, 'v260901'); assert.equal(entries.engineering[0].created_at, '2026-09-01T02:00:00Z');
    assert.equal(entries.engineering[1].delivery_progress, null);
    const forged = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [{ existing_record_id: 'someone-else', requirement_title: '新需求', hours: 1, product_managers: ['PM'], delivery_progress: null }] });
    assert.equal(forged.status, 400);
  });
  await check('REQ069 actual fill accepts1 and10-step progress, rejecting out-of-set values in engineering and product flows', async () => {
    assert.deepEqual([...effective.VALID_PROGRESS], [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 1]);
    for (const role of ['ai_dev', 'ai_pm']) {
      person.role = role;
      for (const progress of [null, 0, -10, 2, 5, 99, 110, 1.5, true]) {
        const response = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [
          { requirement_title: '新普通需求', version: 'v1', hours: 8, product_managers: ['PM'], demand_sources: ['需求方'], delivery_progress: progress }
        ] });
        assert.equal(response.status, 400, `${role} rejects ${progress}`);
        assert.match(response.result.message, /1%或10%至100%/);
      }
      for (const progress of [100, 10, 1]) {
        const accepted = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [
          { requirement_title: '新普通需求', version: 'v1', hours: 8, product_managers: ['PM'], demand_sources: ['需求方'], delivery_progress: progress }
        ] });
        assert.ifError(accepted.error); assert.equal(accepted.status, 200);
        assert.equal(entries[role === 'ai_pm' ? 'product' : 'engineering'][0].delivery_progress, progress);
      }
    }
    person.role = 'ai_dev';
  });
  await check('actual fill cannot clear known progress to gain100; true historical null and omitted historical0 remain unchanged', async () => {
    entries.engineering = [{ id: 'half', task_id: 'now', staff_id: 'a', requirement_title: '旧需求', hours: 8, version: 'v1', delivery_progress: 50, product_managers: ['PM'] }];
    const rejected = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [
      { existing_record_id: 'half', requirement_title: '旧需求', hours: 8, version: 'v1', product_managers: ['PM'], delivery_progress: null, _allowMissingProgress: true }
    ] });
    assert.equal(rejected.status, 400); assert.equal(entries.engineering[0].delivery_progress, 50);
    entries.engineering[0].delivery_progress = 0;
    const explicitZero = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [
      { existing_record_id: 'half', requirement_title: '旧需求', hours: 8, version: 'v1', product_managers: ['PM'], delivery_progress: 0 }
    ] });
    assert.equal(explicitZero.status, 400); assert.equal(entries.engineering[0].delivery_progress, 0);
    const omitted = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [
      { existing_record_id: 'half', requirement_title: '旧需求', hours: 8, version: 'v1', product_managers: ['PM'] }
    ] });
    assert.ifError(omitted.error); assert.equal(omitted.status, 200); assert.equal(entries.engineering[0].delivery_progress, 0);
    entries.engineering[0].delivery_progress = 5;
    const oldNonOption = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [
      { existing_record_id: 'half', requirement_title: '旧需求', hours: 8, version: 'v1', product_managers: ['PM'] }
    ] });
    assert.ifError(oldNonOption.error); assert.equal(oldNonOption.status, 200); assert.equal(entries.engineering[0].delivery_progress, 5);
    const resubmittedNonOption = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [
      { existing_record_id: 'half', requirement_title: '旧需求', hours: 8, version: 'v1', product_managers: ['PM'], delivery_progress: 5 }
    ] });
    assert.equal(resubmittedNonOption.status, 400); assert.equal(entries.engineering[0].delivery_progress, 5);
  });
  await check('actual draft reuses server first version, ignores submitted date, and returns canonical rows', async () => {
    sfl.draft_task_id = 'now'; sfl.draft_data = [{ draft_row_id: 'd', requirement_title: '培训', version: 'v260901', hours: 2 }];
    const response = await invoke(fill, 'put /:token/draft', { task_id: 'now', draft_records: [
      { draft_row_id: 'd', requirement_title: '公司会议', version: 'v000000', automatic_version_date: '2000-01-01', hours: null, _ordinary_fields: { version: 'v2' } },
      { draft_row_id: 'ordinary-one', requirement_title: '普通1%草稿', version: 'v1', hours: 8, delivery_progress: 1 }
    ] });
    assert.ifError(response.error); assert.equal(response.result.data.draft_records[0].version, 'v260901');
    assert.equal(response.result.data.draft_records[0].hours, null); assert.equal(sfl.draft_data[0]._ordinary_fields.version, 'v2');
    assert.equal(response.result.data.draft_records[1].delivery_progress, 1); assert.equal(sfl.draft_data[1].delivery_progress, 1);
    const submitted = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [{ draft_row_id: 'd', requirement_title: '公司会议', version: 'v000000', hours: 4 }] });
    assert.ifError(submitted.error); assert.equal(entries.engineering[0].version, 'v260901');
  });
  await check('actual fill replacement rolls back failures; legacy/product saving follows the same five-category rules', async () => {
    const previous = plain(entries.engineering); failure = true;
    const response = await invoke(fill, 'post /:token/submit', { task_id: 'now', records: [{ requirement_title: '出差', hours: 3 }] });
    assert.match(response.error.message, /fixture/); assert.deepEqual(entries.engineering, previous); failure = false;
    legacy = true; person.role = 'ai_pm';
    const legacyResponse = await invoke(fill, 'post /:token/submit', { records: [{ requirement_title: '团建', hours: 2.5 }] });
    const legacyRow = entries.product.find(row => row.link_id === 'legacy');
    assert.ifError(legacyResponse.error); assert.equal(legacyRow.hours, 2.5); assert.deepEqual(Array.from(legacyRow.demand_sources), []);
    legacy = false; person.role = 'ai_dev';
  });
  await check('actual CRUD create/update/import enforce date versions, preserve null and rollback partially invalid imports', async () => {
    const created = await invoke(crud, 'post /', { task_id: 'now', staff_id: 'a', requirement_title: '培训', hours: 1.5, version: 'v000000' });
    assert.ifError(created.error); const id = created.result.data.id;
    const edited = await invoke(crud, 'put /:id', { version: 'v000000', hours: 2 }, { id });
    assert.ifError(edited.error); assert.equal(edited.result.data.version, effective.dateVersion()); assert.equal(edited.result.data.delivery_progress, null);
    const missingPm = await invoke(crud, 'put /:id', { requirement_title: '普通需求' }, { id });
    assert.match(missingPm.error.message, /请选择AI产品经理/);
    const ordinaryNull = await invoke(crud, 'put /:id', { requirement_title: '普通需求', product_managers: ['PM'], delivery_progress: null }, { id });
    assert.match(ordinaryNull.error.message, /1%或10%至100%/);
    const ordinary = await invoke(crud, 'put /:id', { requirement_title: '普通需求', product_managers: ['PM'], delivery_progress: 10 }, { id });
    assert.ifError(ordinary.error); assert.equal(ordinary.result.data.version, ''); assert.equal(ordinary.result.data.delivery_progress, 10);
    const previous = plain(entries.engineering);
    const imported = await invoke(crud, 'post /import', { task_id: 'now', rows: [
      { staff_name: '甲', requirement_title: '培训', hours: 2 }, { staff_name: '甲', requirement_title: '请假', hours: '' }
    ] });
    assert.match(imported.error.message, /手动填写/); assert.deepEqual(entries.engineering, previous);
  });
  await check('REQ069 CRUD/import accept1, reject out-of-set values and preserve original progress only when omitted', async () => {
    const input = { task_id: 'now', staff_id: 'a', requirement_title: '普通需求', version: 'v1', hours: 8, product_managers: ['PM'] };
    for (const progress of [null, 0, -10, 2, 5, 99, 110, 1.5, true]) {
      const response = await invoke(crud, 'post /', { ...input, delivery_progress: progress });
      assert.match(response.error.message, /1%或10%至100%/);
    }
    const onePercent = await invoke(crud, 'post /', { ...input, delivery_progress: 1 });
    assert.ifError(onePercent.error); assert.equal(onePercent.result.data.delivery_progress, 1);
    const saved = await invoke(crud, 'post /', { ...input, delivery_progress: 50 });
    assert.ifError(saved.error); const id = saved.result.data.id;
    const cleared = await invoke(crud, 'put /:id', { delivery_progress: null }, { id });
    assert.match(cleared.error.message, /1%或10%至100%/); assert.equal(entries.engineering.find(row => row.id === id).delivery_progress, 50);
    entries.engineering.find(row => row.id === id).delivery_progress = 0;
    const omitted = await invoke(crud, 'put /:id', { hours: 4 }, { id });
    assert.ifError(omitted.error); assert.equal(omitted.result.data.delivery_progress, 0);
    const explicit = await invoke(crud, 'put /:id', { delivery_progress: 0 }, { id });
    assert.match(explicit.error.message, /1%或10%至100%/);
    entries.engineering.find(row => row.id === id).delivery_progress = 99;
    const oldNonOption = await invoke(crud, 'put /:id', { hours: 6 }, { id });
    assert.ifError(oldNonOption.error); assert.equal(oldNonOption.result.data.delivery_progress, 99);
    const invalidUpdate = await invoke(crud, 'put /:id', { delivery_progress: 99 }, { id });
    assert.match(invalidUpdate.error.message, /1%或10%至100%/);
    const updated = await invoke(crud, 'put /:id', { delivery_progress: 1 }, { id });
    assert.ifError(updated.error); assert.equal(updated.result.data.delivery_progress, 1);
    const before = plain(entries.engineering);
    const imported = await invoke(crud, 'post /import', { task_id: 'now', rows: [
      { staff_name: '甲', requirement_title: '第一条', version: 'v1', hours: 8, product_managers: ['PM'], delivery_progress: 1 },
      { staff_name: '甲', requirement_title: '第二条', version: 'v2', hours: 8, product_managers: ['PM'], delivery_progress: 0 }
    ] });
    assert.match(imported.error.message, /1%或10%至100%/); assert.deepEqual(entries.engineering, before);
    const importedOne = await invoke(crud, 'post /import', { task_id: 'now', rows: [
      { staff_name: '甲', requirement_title: '导入1%', version: 'v1', hours: 8, product_managers: ['PM'], delivery_progress: 1 }
    ] });
    assert.ifError(importedOne.error); assert.equal(importedOne.result.data[0].delivery_progress, 1);
  });
  console.log(`Verified ${checked} REQ-064/065/069 backend scenarios without external data writes.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
