/* Pure regression verification: no database, network, scheduler or notifications. */
const assert = require('node:assert/strict');
const { buildWorkHours, taskDateRange } = require('../src/services/WorkHoursCompletionService');
const official2026 = require('../src/data/holidays/2026.json');
const snapshots = new Map([[2026, official2026]]);
const staff = [{ id: 's1', name: '测试甲', role: 'ai_dev', employment_status: 'active' }];
const task = { id: 't1', title: '普通周', time_dimension: 'week', start_date: '2026-09-07', end_date: '2026-09-13' };
const record = (hours, extra = {}) => ({ id: 'r1', staff_id: 's1', task_id: 't1', hours, ...extra });
const calculate = (hours, options = {}) => buildWorkHours({ tasks: [task], staff, snapshots, records: [record(hours)], ...options });
let checked = 0;
function check(name, fn) { fn(); checked += 1; console.log(`PASS ${name}`); }

check('32/40=80%, 40/40=100%, 48/40=120% and excess 20%', () => {
  for (const [hours, expected] of [[32, 80], [40, 100], [48, 120]]) {
    const result = calculate(hours);
    assert.equal(result.standardHours, 40);
    assert.equal(result.completionRate, expected);
    assert.equal(result.excessRate, Math.max(0, expected - 100));
  }
});
check('different workday counts weight by expected capacity, not record hours or simple average', () => {
  const holidayTask = { ...task, id: 't2', start_date: '2026-10-05', end_date: '2026-10-11' };
  const result = calculate(32, { tasks: [task, holidayTask], records: [record(32), record(16, { id: 'r2', task_id: 't2' })] });
  assert.equal(result.units.find(unit => unit.taskId === 't2').standardHours, 24);
  assert.equal(result.standardHours, 64);
  assert.equal(result.completionRate, 75);
});
check('multiple requirements do not duplicate person-week capacity', () => {
  const result = calculate(0, { records: [record(20), record(12, { id: 'r2' })] });
  assert.equal(result.actualHours, 32);
  assert.equal(result.standardHours, 40);
  assert.equal(result.completionRate, 80);
});
check('identical JOIN record is not added twice', () => {
  assert.equal(calculate(0, { records: [record(32), record(32)] }).actualHours, 32);
});
check('overlapping collection tasks share the same capacity', () => {
  const result = calculate(0, { tasks: [task, task, { ...task, id: 'duplicate-week' }],
    records: [record(32), record(8, { id: 'r2', task_id: 'duplicate-week' })] });
  assert.equal(result.units.length, 2);
  assert.equal(result.standardHours, 40);
  assert.equal(result.completionRate, 100);
});
check('people need a scoped record but their unfilled selected weeks remain in denominator', () => {
  const result = calculate(32, { staff: [...staff, { ...staff[0], id: 's2' }],
    tasks: [task, { ...task, id: 't2', start_date: '2026-08-31', end_date: '2026-09-06' }] });
  assert.equal(result.standardHours, 80);
  assert.equal(result.completionRate, 40);
  assert.equal(result.units.filter(unit => unit.actualHours === 0).length, 1);
});
check('zero-workday holiday week returns null rates and preserves recorded hours', () => {
  const result = calculate(8, { tasks: [{ ...task, start_date: '2026-02-16', end_date: '2026-02-22' }] });
  assert.equal(result.standardHours, 0);
  assert.equal(result.actualHours, 8);
  assert.equal(result.completionRate, null);
  assert.equal(result.excessRate, null);
});
check('missing holiday calendar explicitly reports weekday estimate', () => {
  const result = calculate(32, { snapshots: new Map() });
  assert.equal(result.calendarStatus, 'weekday_fallback');
  assert.equal(result.standardHours, 40);
  assert.match(result.calendarNote, /估算/);
});
check('weekly ranges normalize to Monday-Sunday and include weekend makeup days', () => {
  const shortTask = { ...task, start_date: '2026-02-09', end_date: '2026-02-13' };
  assert.deepEqual(taskDateRange(shortTask), { start: '2026-02-09', end: '2026-02-15' });
  const result = calculate(48, { tasks: [shortTask] });
  assert.equal(result.standardHours, 48);
  assert.equal(result.completionRate, 100);
  assert.ok(result.units[0].workDates.includes('2026-02-14'));
});
check('legacy Sunday-Saturday week 9 belongs to February 23 rather than the Spring Festival week', () => {
  const legacy = { ...task, start_date: '2026-02-22', end_date: '2026-02-28', year: 2026, week_number: 9 };
  assert.deepEqual(taskDateRange(legacy), { start: '2026-02-23', end: '2026-03-01' });
  assert.equal(calculate(32, { tasks: [legacy] }).standardHours, 40);
});
check('legacy Sunday-Saturday week 15 includes the Qingming holiday in the correct week', () => {
  const legacy = { ...task, start_date: '2026-04-05', end_date: '2026-04-11', year: 2026, week_number: 15 };
  assert.deepEqual(taskDateRange(legacy), { start: '2026-04-06', end: '2026-04-12' });
  assert.equal(calculate(32, { tasks: [legacy] }).standardHours, 32);
});
check('legacy cross-year week follows end-date ISO week, not calendar start year', () => {
  const { getIsoWeekInfo } = require('../src/utils/beijingTime');
  const legacy = { ...task, start_date: '2025-12-28', end_date: '2026-01-03', year: 2026, week_number: 1 };
  const range = taskDateRange(legacy);
  assert.deepEqual(range, { start: '2025-12-29', end: '2026-01-04' });
  assert.deepEqual(getIsoWeekInfo(range.start), { year: legacy.year, week: legacy.week_number });
});
check('role and source filters constrain people, partial record filters retain capacity', () => {
  const people = [...staff, { id: 'pm', name: '产品', role: 'ai_pm' }];
  const records = [record(30), record(10, { id: 'rp', staff_id: 'pm', source_type: 'product_manager' })];
  assert.equal(calculate(0, { staff: people, records, query: { sourceType: 'product_manager' } }).standardHours, 40);
  assert.equal(calculate(0, { staff: people, records, query: { role: 'frontend' } }).actualHours, 30);
  const partial = calculate(30, { query: { demandSourceId: 'd1' } });
  assert.equal(partial.standardHours, 40);
  assert.match(partial.scopeNote, /不缩减/);
});
check('current resigned status excludes historical records even if historical status was active', () => {
  const historyMap = new Map([['s1', [{ status: 'active', started_at: '2020-01-01', ended_at: '2026-10-01' },
    { status: 'resigned', started_at: '2026-10-01', ended_at: null }]]]);
  assert.equal(calculate(32, { staff: [{ ...staff[0], employment_status: 'resigned' }], historyMap }).completionRate, null);
  assert.equal(calculate(32, { staff: [{ ...staff[0], employment_status: 'resigned' }] }).standardHours, 0);
});
check('delivery progress cannot force work-hour completion to 100%', () => {
  const result = calculate(0, { records: [record(32, { delivery_progress: 100, historical_progress_override: true })] });
  assert.equal(result.completionRate, 80);
});
check('empty scope and invalid dates do not produce Infinity', () => {
  assert.equal(buildWorkHours().completionRate, null);
  const result = calculate(32, { tasks: [{ ...task, start_date: 'invalid' }] });
  assert.equal(result.calendarStatus, 'invalid_period');
  assert.equal(result.completionRate, null);
});
check('mixed valid and invalid periods preserve hours without claiming a complete denominator', () => {
  const result = calculate(32, { tasks: [task, { ...task, id: 'invalid', start_date: 'invalid' }],
    records: [record(32), record(8, { id: 'r2', task_id: 'invalid' })] });
  assert.equal(result.standardHours, 40);
  assert.equal(result.actualHours, 40);
  assert.equal(result.completionRate, null);
  assert.equal(result.excessRate, null);
  assert.match(result.calendarNote, /基准不完整/);
});

async function verifyReadRoutes() {
  // Exercise the actual route handlers with in-memory repositories. Unknown dependencies fail closed.
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const XLSX = require('xlsx');
  const routes = new Map();
  const people = [...staff, { id: 'pm', name: '产品', role: 'ai_pm', employment_status: 'active' }];
  const tasks = [task, { ...task, id: 't2', start_date: '2026-08-31', end_date: '2026-09-06' }]
    .map(value => ({ ...value, year: 2026, toJSON() { const { toJSON, ...row } = this; return row; } }));
  const sources = [{ id: 'd1', name: '需求甲' }, { id: 'd2', name: '需求乙' }];
  class EngineeringRow {
    constructor(value) { Object.assign(this, value); }
    toJSON() { return { ...this }; }
    static async findAll({ where }) { return engineering.filter(row => where.task_id.in.includes(row.task_id)); }
  }
  class ProductRow extends EngineeringRow {
    static async findAll({ where }) { return product.filter(row => where.task_id.in.includes(row.task_id)); }
  }
  const engineering = [new EngineeringRow({ ...record(32), staff: people[0], version: 'v1', delivery_progress: 50 })];
  const product = [new ProductRow({ ...record(40, { id: 'rp', staff_id: 'pm' }), staff: people[1], version: 'v1',
    delivery_progress: 50, demand_sources: ['需求甲', '需求乙'], demand_source_ids: ['d1', 'd2'],
    demand_source_weights: { 需求甲: 75, 需求乙: 25 } })];
  const context = options => ({ ...options, staff: options.staff || people, snapshots });
  const dependencies = {
    express: { Router: () => ({ get: (route, handler) => routes.set(route, handler) }) }, xlsx: XLSX,
    sequelize: { Op: { in: 'in', between: 'between', ne: 'ne' }, fn() {}, col() {} },
    '../models': { CollectionTask: { findAll: async ({ where }) => tasks.filter(row => (!where.year || row.year === where.year)
      && (!where.end_date || (row.end_date >= where.end_date.between[0] && row.end_date <= where.end_date.between[1]))) },
      WorkRecord: EngineeringRow, ProductManagerWorkRecord: ProductRow,
      Staff: { findAll: async () => people.map(person => ({ ...person, toJSON: () => ({ ...person }) })),
        findByPk: async id => people.find(person => person.id === id) },
      ProductManager: { findAll: async () => [], findByPk: async id => ({ id, name: '不在上述', employment_status: 'active' }) },
      MatchGroup: { findAll: async () => [] } },
    '../utils/parseJson': { safeParseJsonArray: value => Array.isArray(value) ? value : value ? JSON.parse(value) : [] },
    '../services/PersonStatusService': { filterRecordsByStaffStatus: async rows => rows,
      filterMatchGroupsByStaffStatus: async rows => rows,
      RESIGNED_STATUS: 'resigned', buildCurrentStatusPayload: () => ({}), collectPmNamesFromRecords: () => [],
      getPmStatusContextByName: async () => new Map(), filterPmNamesForRecord: async record => record.product_managers || [],
      filterRecordsForPm: async rows => rows, isNonResigned: person => person.employment_status !== 'resigned' },
    '../services/RoleService': { normalizeStaffRole: role => ({ frontend: 'ai_dev', backend: 'ai_dev', test: 'ai_quality' })[role] || role,
      createRoleSummary: () => ({}), withRoleAliases: row => row, getRoleDefinitions: () => [],
      addRoleHours: (row, role, hours) => { row[role] = (row[role] || 0) + hours; } },
    '../services/DemandSourceService': { getDemandSourceDefinitions: async () => sources },
    '../services/DeliverySummaryService': require('../src/services/DeliverySummaryService'),
    '../services/EffectiveHoursService': require('../src/services/EffectiveHoursService'),
    '../services/WorkHoursCompletionService': { buildWorkHours, loadWorkHoursContext: async options => context(options),
      getWorkHours: async options => buildWorkHours(context(options)) }
  };
  const filename = path.join(__dirname, '../src/routes/stats.js');
  const moduleStub = { exports: {} };
  const routeRequire = name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected route dependency: ${name}`);
    return dependencies[name];
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: routeRequire, module: moduleStub, exports: moduleStub.exports, Date, Map, Set, console }, { filename });
  async function invoke(route, query, params = {}) {
    let payload;
    await routes.get(route)({ query, params }, { json: result => { payload = result; }, send: result => { payload = result; }, setHeader() {} }, error => { throw error; });
    return payload;
  }
  const current = await invoke('/progress-details', { year: '2026', taskId: 't1', sourceType: 'product_manager', role: 'ai_pm', demandSourceId: 'd1' });
  check('actual stats handler allocates 40h by 75/25 source weights and preserves person-week capacity', () => {
    assert.equal(current.data.records.length, 1);
    assert.equal(current.data.records[0].hours, 30);
    assert.equal(current.data.records[0].originalHours, 40);
    assert.equal(current.data.workHours.standardHours, 40);
    assert.equal(current.data.workHours.completionRate, 75);
    assert.equal(current.data.scopeMeta.taskCount, 1);
  });
  const all = await invoke('/progress-details', { scope: 'all', year: '1900', quarter: 'Q1', taskId: 't1', role: 'ai_dev' });
  check('actual stats handler ALL scope ignores time/task filters and retains role plus unfilled weeks', () => {
    assert.equal(all.data.tasks.length, 2);
    assert.equal(all.data.records.length, 1);
    assert.equal(all.data.workHours.actualHours, 32);
    assert.equal(all.data.workHours.standardHours, 80);
    assert.equal(all.data.workHours.completionRate, 40);
  });
  const buffer = await invoke('/export.xlsx', { year: '2026', taskId: 't1', sourceType: 'product_manager', demandSourceId: 'd1' });
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  check('actual export contains delivery hours/rate and matching allocated hours/capacity without old percentage or status', () => {
    const meta = XLSX.utils.sheet_to_json(workbook.Sheets['导出说明'], { header: 1 });
    assert.equal(meta.find(row => row[0] === '有效交付率')[1], '75%');
    assert.equal(meta.find(row => row[0] === '有效已交付')[1], 30);
    assert.ok(!meta.some(row => ['工时完成度', '工时加权交付进度'].includes(row[0])));
    const details = XLSX.utils.sheet_to_json(workbook.Sheets['进度明细']);
    assert.equal(details[0].工时, 30);
    assert.equal(details[0].有效已交付, 30);
    assert.ok(!Object.hasOwn(details[0], '交付进度'));
    assert.ok(!Object.hasOwn(details[0], '状态'));
    const capacity = XLSX.utils.sheet_to_json(workbook.Sheets['人员周期容量']);
    assert.equal(capacity.reduce((total, row) => total + row.计入汇总应填工时, 0), 40);
  });
  sources[0].name = '需求甲新名称';
  const renamedStats = await invoke('/', { year: '2026', taskId: 't1' });
  const renamedDetail = await invoke('/progress-details', { year: '2026', taskId: 't1', sourceType: 'product_manager', demandSourceId: 'd1' });
  const renamedBuffer = await invoke('/export.xlsx', { year: '2026', taskId: 't1', sourceType: 'product_manager', demandSourceId: 'd1' });
  check('demand-source rename preserves 75/25 weights consistently in main stats, detail, distribution and export', () => {
    const row = renamedStats.data.records.find(item => item.id === 'rp');
    assert.equal(row.demand_sources[0], '需求甲新名称');
    assert.equal(row.demand_source_weights['需求甲新名称'], 75);
    assert.equal(renamedStats.data.productManagerRecords[0].demand_source_weights['需求甲新名称'], 75);
    assert.equal(renamedStats.data.productDemandDistribution.find(source => source.id === 'd1').total, 30);
    assert.equal(renamedDetail.data.workHours.actualHours, 30);
    assert.equal(renamedDetail.data.records[0].hours, 30);
    const renamedWorkbook = XLSX.read(renamedBuffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(renamedWorkbook.Sheets['进度明细']);
    assert.equal(rows[0].工时, 30);
    assert.match(rows[0].需求方, /需求甲新名称/);
  });
  const engineeringFixture = (id, hours, created_at, requirement_title = id) => new EngineeringRow({
    ...record(hours, { id, created_at, requirement_title }), staff: people[0], version: 'v1', delivery_progress: 100,
    updated_at: '2030-01-01T00:00:00Z'
  });
  engineering.splice(0, engineering.length,
    engineeringFixture('e-old', 12, '2026-09-07T01:00:00Z', 'AAA 最早记录'),
    engineeringFixture('e-tie', 6, '2026-09-12T01:00:00Z'),
    engineeringFixture('e-new', 8, '2026-09-12T01:00:00Z', 'ZZZ 最新研发记录'),
    engineeringFixture('e-missing', 2, null));
  const productFixture = (id, hours, created_at) => new ProductRow({
    ...record(hours, { id, staff_id: 'pm', created_at, requirement_title: id }), staff: people[1], version: 'v1',
    delivery_progress: 100, demand_sources: ['需求甲', '需求乙'], demand_source_ids: ['d1', 'd2'],
    demand_source_weights: { 需求甲: 75, 需求乙: 25 }
  });
  product.splice(0, product.length,
    productFixture('p-middle', 7, '2026-09-10T01:00:00Z'),
    productFixture('p-new', 9, '2026-09-13T01:00:00Z'));
  const sortQuery = { year: '2026', taskId: 't1' };
  const sortedStats = await invoke('/', sortQuery);
  const sortedDetails = await invoke('/progress-details', sortQuery);
  const ids = records => Array.from(records, row => row.id);
  const expectedOrder = ['p-new', 'e-new', 'e-tie', 'p-middle', 'e-old', 'e-missing'];
  check('main and progress records globally interleave both tables by creation time, with stable ties and missing dates last', () => {
    assert.deepEqual(ids(sortedStats.data.records), expectedOrder);
    assert.deepEqual(ids(sortedDetails.data.records), expectedOrder);
    assert.deepEqual(ids(sortedStats.data.productManagerRecords), ['p-new', 'p-middle']);
    assert.equal(sortedStats.data.workHours.actualHours, 44);
    assert.equal(sortedDetails.data.workHours.actualHours, 44);
  });
  check('PM and demand-source cards preserve creation timestamps, newest-first order and latest record metadata', () => {
    const pmCard = sortedStats.data.pmDistribution.find(group => group.name === '不在上述');
    assert.deepEqual(ids(pmCard.records), ['e-new', 'e-tie', 'e-old', 'e-missing']);
    assert.equal(pmCard.latest_created_at, '2026-09-12T01:00:00Z');
    assert.equal(pmCard.records[0].created_at, pmCard.latest_created_at);
    const demandCard = sortedStats.data.productDemandDistribution.find(group => group.id === 'd1');
    assert.deepEqual(ids(demandCard.records), ['p-new', 'p-middle']);
    assert.equal(demandCard.latest_created_at, '2026-09-13T01:00:00Z');
    assert.equal(demandCard.records[0].created_at, demandCard.latest_created_at);
  });
  const explicitlySorted = await invoke('/', { ...sortQuery, pmSort: 'desc' });
  check('explicit PM hours sorting remains available without changing default record chronology', () => {
    assert.deepEqual(ids(explicitlySorted.data.pmDistribution[0].records), ['e-old', 'e-new', 'e-tie', 'e-missing']);
    assert.equal(explicitlySorted.data.pmDistribution[0].latest_created_at, '2026-09-12T01:00:00Z');
    assert.deepEqual(ids(explicitlySorted.data.records), expectedOrder);
  });
  const personal = await invoke('/personal/:staffId', sortQuery, { staffId: 's1' });
  const focus = await invoke('/pm/:pmId', sortQuery, { pmId: 'pm-owner' });
  check('personal and PM focus projections keep created_at and newest-first records without changing period dates', () => {
    for (const result of [personal, focus]) {
      const period = result.data.tasks.find(row => row.id === 't1');
      assert.deepEqual(ids(period.records), ['e-new', 'e-tie', 'e-old', 'e-missing']);
      assert.equal(period.records[0].created_at, '2026-09-12T01:00:00Z');
      assert.equal(period.start_date, task.start_date);
      assert.equal(period.end_date, task.end_date);
    }
  });
  const sortedExport = XLSX.read(await invoke('/export.xlsx', sortQuery), { type: 'buffer' });
  check('progress spreadsheet follows the same creation-time order as the visible detail rows', () => {
    const exported = XLSX.utils.sheet_to_json(sortedExport.Sheets['进度明细']);
    assert.deepEqual(exported.map(row => row.需求名称), Array.from(sortedDetails.data.records, row => row.requirement_title));
  });
  engineering.splice(0, engineering.length,
    new EngineeringRow({ ...record(32, { id: 'delivered', version: ' v1 ', delivery_progress: 0 }), staff: people[0] }),
    new EngineeringRow({ ...record(16, { id: 'unversioned', version: ' - ', delivery_progress: 100 }), staff: people[0] }));
  product.splice(0, product.length);
  const newStats = await invoke('/', sortQuery);
  const newDetails = await invoke('/progress-details', { ...sortQuery, role: 'ai_dev' });
  const newPersonal = await invoke('/personal/:staffId', sortQuery, { staffId: 's1' });
  const newFocus = await invoke('/pm/:pmId', sortQuery, { pmId: 'pm-owner' });
  check('all stats endpoints expose saved versioned hours rather than manual or historical completion', () => {
    for (const result of [newDetails, newPersonal, newFocus]) {
      assert.equal(result.data.deliverySummary.deliveredHours, 32);
      assert.equal(result.data.deliverySummary.recordedHours, 48);
      assert.equal(result.data.deliverySummary.unversionedHours, 16);
      assert.equal(result.data.deliverySummary.standardHours, 40);
      assert.equal(result.data.deliverySummary.deliveryRate, 80);
    }
    assert.equal(newStats.data.deliverySummary.deliveredHours, 32);
    assert.equal(newStats.data.deliverySummary.standardHours, 40);
    assert.equal(newStats.data.deliverySummary.deliveryRate, 80);
    assert.equal(newDetails.data.records.find(row => row.id === 'delivered').delivery_progress, 0);
    assert.ok(newDetails.data.records.every(row => !row.historical_progress_override));
    assert.equal(newPersonal.data.tasks[0].deliverySummary.deliveryRate, 80);
    assert.equal(newFocus.data.tasks[0].deliverySummary.deliveryRate, 80);
  });
  const unversionedOnly = await invoke('/progress-details', { ...sortQuery, role: 'ai_dev', versionType: 'no_version' });
  check('unversioned detail preserves hours and staffing capacity while contributing zero delivery', () => {
    assert.equal(unversionedOnly.data.records.length, 1);
    assert.equal(unversionedOnly.data.records[0].hours, 16);
    assert.equal(unversionedOnly.data.deliverySummary.deliveredHours, 0);
    assert.equal(unversionedOnly.data.deliverySummary.unversionedHours, 16);
    assert.equal(unversionedOnly.data.deliverySummary.standardHours, 40);
  });
  const newExport = XLSX.read(await invoke('/export.xlsx', { ...sortQuery, role: 'ai_dev' }), { type: 'buffer' });
  check('delivery export clearly separates versioned and unversioned hours with 32h/40h=80%', () => {
    const meta = XLSX.utils.sheet_to_json(newExport.Sheets['导出说明'], { header: 1 });
    const rows = XLSX.utils.sheet_to_json(newExport.Sheets['进度明细']);
    assert.equal(meta.find(row => row[0] === '有效已交付')[1], 32);
    assert.equal(meta.find(row => row[0] === '有效交付率')[1], '80%');
    assert.equal(rows.reduce((total, row) => total + row.有效已交付, 0), 32);
    assert.equal(rows.find(row => row.版本号 === '无版本号').工时, 16);
    assert.equal(rows.find(row => row.版本号 === '无版本号').有效已交付, 0);
  });
  const unversionedExport = XLSX.read(await invoke('/export.xlsx', { ...sortQuery, role: 'ai_dev', versionType: 'no_version' }), { type: 'buffer' });
  check('unversioned-only export labels the rate as records-only instead of displaying 0%', () => {
    const meta = XLSX.utils.sheet_to_json(unversionedExport.Sheets['导出说明'], { header: 1 });
    const rows = XLSX.utils.sheet_to_json(unversionedExport.Sheets['进度明细']);
    assert.equal(meta.find(row => row[0] === '有效交付率')[1], '仅记录，不计交付率');
    assert.equal(meta.find(row => row[0] === '无版本记录工时（不计交付）')[1], 16);
    assert.equal(meta.find(row => row[0] === '应填工时（人员工作日去重）')[1], 40);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].工时, 16);
    assert.equal(rows[0].有效已交付, 0);
  });
  const emptyPersonal = await invoke('/personal/:staffId', { year: '1900' }, { staffId: 's1' });
  const emptyPm = await invoke('/pm/:pmId', { year: '1900' }, { pmId: 'pm-owner' });
  check('empty filter ranges return no person or PM identity and no capacity', () => {
    assert.equal(emptyPersonal.data.staff, null);
    assert.equal(emptyPm.data.pm, null);
    assert.equal(emptyPersonal.data.workHours.standardHours, 0);
    assert.equal(emptyPm.data.workHours.standardHours, 0);
  });
  console.log(`Verified ${checked} work-hours completion scenarios.`);
}
verifyReadRoutes().catch(error => { console.error(error); process.exitCode = 1; });
