/* REQ-064 regression cases with REQ-067 actual progress display; API writes intercepted. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const ROOT = path.resolve(__dirname, '../..');
const outputArgument = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
const OUT = path.resolve(ROOT, outputArgument || 'docs/@test/actual_progress_display_20260917/reused_effective_hours');
const APP = process.env.APP_URL || 'http://localhost:5176';
const API = process.env.API_URL || 'http://127.0.0.1:3001/api';
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const DIR = path.join(OUT, 'evidence', RUN);
const cases = process.argv.find(arg => arg.startsWith('--case='))?.slice(7).split(',');
const results = [], writes = [], errors = [], requests = [];
let page, delivery, workHours;
fs.mkdirSync(DIR, { recursive: true });
const number = text => Number(text.replaceAll(',', '').match(/-?\d+(?:\.\d+)?/)?.[0]);
const briefSummary = value => { const { units = [], ...summary } = value; return { ...summary, capacityUnitCount: units.length, personCount: new Set(units.map(unit => unit.staffId)).size }; };
const snapshot = name => page.screenshot({ path: path.join(DIR, `${name}.png`), animations: 'disabled' });
async function check(id, fn) {
  if (cases && !cases.includes(id)) return;
  let row;
  try { row = { run: RUN, id, status: 'PASS', evidence: await fn() }; }
  catch (e) { row = { run: RUN, id, status: 'FAIL', message: e.message, stack: e.stack }; if (page && !page.isClosed()) { row.body = (await page.locator('body').innerText()).slice(-6500); await snapshot(`${id}-failure`).catch(() => {}); } }
  results.push(row); fs.appendFileSync(path.join(OUT, 'results.jsonl'), JSON.stringify(row) + '\n');
  console.log(`${id}: ${row.status}${row.message ? ' ' + row.message : ''}`);
}
async function get(suffix) {
  const response = await fetch(API + suffix); assert.ok(response.ok, `${suffix} HTTP ${response.status}`);
  const json = await response.json(); return json.data || json;
}
function fixture({ missing = false } = {}) {
  const staff = { id: 'REQ064-person', name: 'REQ064测试甲', role: 'ai_dev', employment_status: 'active', is_active: true };
  const pm = { id: 'REQ064-pm', name: 'REQ064归属产品', employment_status: 'active', is_active: true };
  const task = { id: 'REQ064-week', title: 'REQ064第38周', time_dimension: 'week', start_date: '2026-09-14', end_date: '2026-09-20', year: 2026, quarter: 'Q3', week_number: 38, status: 'active', is_preferred: true, record_count: 5 };
  const unit = { staffId: staff.id, staffName: staff.name, role: staff.role, taskId: task.id, workDates: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'], calendarStatus: 'official' };
  const row = (id, title, version, hours, progress) => ({ id, task_id: task.id, staff_id: staff.id, staff, task, version, requirement_title: title, hours, delivery_progress: progress, product_managers: [pm.name], is_product_manager_record: false, source_type: 'engineering', created_at: '2026-09-17T03:00:00.000Z', updated_at: '2026-09-17T03:00:00.000Z' });
  const records = [row('REQ064-1', '普通需求甲', 'v4.1.0', 16, missing ? null : 50), row('REQ064-2', '普通需求乙', 'v4.2.0', 8, 100), row('REQ064-3', '普通需求丙', 'v4.3.0', 8, 50), row('REQ064-4', '培训', 'v260917', 8, null), row('REQ064-5', '日常支持', '', 8, null)];
  const capacity = workHours.summarizeWorkHours(records, [unit]);
  const summary = delivery.summarizeDelivery(records, capacity);
  task.workHours = capacity;
  const stats = { tasks: [task], records, matchGroups: [], staff: [staff], currentStaff: [staff], productManagerRecords: [], productDemandDistribution: [], demandSources: [], summary: { totalHours: 48, recordCount: 5, staffCount: 1, taskCount: 1 }, roleSummary: { ai_dev: 48, ai_quality: 0, voip: 0, embedded: 0, ai_pm: 0 }, pmDistribution: [{ ...pm, total: 48, ai_dev: 48, records: records.map(record => ({ ...record, staffName: staff.name, role: staff.role })) }], workHours: capacity, deliverySummary: summary };
  return { staff, pm, task, unit, records, capacity, summary, stats };
}
async function main() {
  delivery = await import(pathToFileURL(path.join(ROOT, 'frontend/src/utils/deliverySummary.js')).href);
  workHours = await import(pathToFileURL(path.join(ROOT, 'frontend/src/utils/workHours.js')).href);
  await check('R4-E-002-MATH', () => {
    const f = fixture();
    assert.equal(f.summary.recordedHours, 48); assert.equal(f.summary.deliveredHours, 40); assert.equal(f.summary.deliveryRate, 100);
    assert.equal(f.summary.weightedDeliveryRate, 70); assert.equal(f.summary.requirementProgress, 62.5); assert.equal(f.summary.progressCoverage, 100);
    const missingFixture = fixture({ missing: true }), unknown = missingFixture.summary;
    assert.equal(unknown.weightedDeliveryRate, 90); assert.equal(unknown.missingProgressHours, 16); assert.equal(unknown.deliveryRate, 100);
    assert.equal(unknown.progressCoverage, 50); assert.equal(missingFixture.records[0].delivery_progress, null);
    return { known: f.summary, unknown };
  });
  await check('R4-P-001-MATH', () => {
    const f = fixture();
    const earlier = { ...f.unit, taskId: 'REQ064-week37', startDate: '2026-09-07', endDate: '2026-09-13', workDates: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'] };
    const later = { ...f.unit, startDate: '2026-09-14', endDate: '2026-09-20' };
    const noRecord = { ...later, staffId: 'REQ064-empty', staffName: '无记录人员' };
    const old = { ...f.records[0], task_id: earlier.taskId, hours: 8, delivery_progress: 50, updated_at: '2026-09-17T10:00:00Z' };
    const recent = { ...f.records[0], id: 'REQ064-later', hours: 8, delivery_progress: 100, updated_at: '2026-09-15T10:00:00Z' };
    const records = [old, recent]; const capacity = workHours.summarizeWorkHours(records, [earlier, later, noRecord]);
    const people = delivery.summarizeStaffDelivery(records, capacity);
    assert.equal(people.length, 1); assert.equal(people[0].standardHours, 80); assert.equal(people[0].requirementProgress, 100); assert.equal(people[0].weightedDeliveryRate, 20);
    const unknown = delivery.summarizeStaffDelivery([old, { ...recent, delivery_progress: null }], capacity)[0];
    assert.equal(unknown.weightedDeliveryRate, 20); assert.equal(unknown.missingProgressHours, 16); assert.equal(unknown.progressCoverage, 0);
    const resigned = records.map(row => ({ ...row, staff: { ...row.staff, employment_status: 'resigned' } }));
    assert.equal(delivery.summarizeStaffDelivery(resigned, capacity).length, 0);
    const restored = resigned.map(row => ({ ...row, staff: { ...row.staff, employment_status: 'long_leave' } }));
    assert.equal(delivery.summarizeStaffDelivery(restored, capacity).length, 1);
    return { people, latestUnknown: unknown, noRecordAndResignedExcluded: true, restoredLongLeave: true };
  });
  await check('R4-E-002-API', async () => {
    const stats = await get('/stats?year=2026&quarter=Q3');
    const detail = await get('/stats/progress-details?year=2026&quarter=Q3&scope=current');
    for (const [name, data] of [['stats', stats], ['details', detail]]) {
      assert.ok(data.deliverySummary && data.workHours, `${name} metrics missing`);
      assert.ok(data.records.every(record => record.staff?.employment_status !== 'resigned'), `${name} contains currently resigned records`);
      const actualPeople = new Set(data.records.map(record => String(record.staff_id || record.staff?.id)));
      assert.ok(data.workHours.units.every(unit => actualPeople.has(String(unit.staffId))), `${name} zero-record capacity person`);
      const computed = delivery.summarizeDelivery(data.records, data.workHours);
      for (const key of ['recordedHours', 'deliveredHours', 'deliveryRate', 'weightedDeliveryRate', 'requirementProgress', 'progressCoverage']) assert.equal(data.deliverySummary[key], computed[key], `${name}.${key}`);
    }
    const response = await fetch(`${API}/stats/export.xlsx?year=2026&quarter=Q3&scope=current`); assert.ok(response.ok);
    const buffer = Buffer.from(await response.arrayBuffer()); fs.writeFileSync(path.join(DIR, 'live-effective-hours.xlsx'), buffer);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const rows = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }));
    assert.ok(rows.some(row => row.some(cell => String(cell).includes('有效已交付'))), 'export effective label missing');
    assert.ok(rows.some(row => row.some(cell => String(cell).includes('加权交付率'))), 'export weighted label missing');
    return { stats: briefSummary(stats.deliverySummary), detail: briefSummary(detail.deliverySummary), counts: { stats: stats.records.length, detail: detail.records.length }, sheets: workbook.SheetNames };
  });
  await check('R4-P-001-API-EMPTY', async () => {
    const current = await get('/stats?year=2026&quarter=Q3');
    const staffId = current.records[0]?.staff_id || current.records[0]?.staff?.id;
    const pmId = current.pmDistribution.find(pm => pm.id && pm.records?.length)?.id;
    assert.ok(staffId && pmId, 'live fixture lacks current staff or PM');
    const empty = await get('/stats?year=2027&quarter=Q1'); assert.equal(empty.records.length, 0); assert.equal(empty.workHours.units.length, 0);
    const person = await get(`/stats/personal/${encodeURIComponent(staffId)}?year=2027&quarter=Q1`);
    const pm = await get(`/stats/pm/${encodeURIComponent(pmId)}?year=2027&quarter=Q1`);
    assert.equal(person.staff, null); assert.equal(person.recordCount, 0); assert.equal(person.workHours.units.length, 0);
    assert.equal(pm.pm, null); assert.equal(pm.recordCount, 0); assert.equal(pm.workHours.units.length, 0);
    return { scope: '2027 Q1', departmentRecords: 0, departmentCapacityPeople: 0, personalIdentity: null, pmIdentity: null };
  });
  if (!cases || cases.some(id => /UI|FILL/.test(id))) await browserChecks();
  const latest = new Map();
  for (const line of fs.readFileSync(path.join(OUT, 'results.jsonl'), 'utf8').trim().split('\n').filter(Boolean)) { const row = JSON.parse(line); latest.set(row.id, row); }
  fs.writeFileSync(path.join(OUT, 'execution.md'), `# REQ-064 复用回归（REQ-066 周期口径）\n\n最新批次：${RUN}。复现：\`node backend/scripts/verify_effective_hours_ui.js --out=${JSON.stringify(path.relative(ROOT, OUT).replaceAll('\\', '/'))}${cases ? ' --case=' + cases.join(',') : ''}\`。\n\n## 每个用例最近结果（完整历史保留）\n\n| 用例 | 最近结果 | 证据批次 | 说明 |\n| --- | --- | --- | --- |\n${[...latest.values()].sort((a, b) => a.id.localeCompare(b.id)).map(row => `| ${row.id} | ${row.status} | [${row.run}](evidence/${row.run}/) | ${(row.message || '见 results.jsonl').replace(/\|/g, '/')} |`).join('\n')}\n\n证据：evidence/；本目录完整历史追加保留在 results.jsonl，旧 REQ-064 归档不修改。浏览器请求中所有非 GET API 均被拦截，不写业务、不发通知。未执行用例不据此标记通过。\n`, 'utf8');
  console.log(JSON.stringify({ run: RUN, evidence: DIR, results: results.map(({ id, status }) => ({ id, status })) }));
  process.exitCode = results.some(row => row.status === 'FAIL') ? 1 : 0;
}
async function browserChecks() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  let f = fixture(), useLive = false;
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), suffix = url.pathname.replace(/^.*\/api/, '');
    requests.push({ method: req.method(), path: suffix });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { let body; try { body = req.postDataJSON(); } catch { body = { nonJsonPayload: 'intercepted without reading file content' }; } writes.push({ path: suffix, method: req.method(), body, intercepted: true }); return route.fulfill({ status: 200, json: { code: 0, success: true, data: {} } }); }
    if (useLive) return route.continue();
    let data;
    if (suffix === '/tasks') data = [f.task];
    else if (suffix === '/pm') data = [f.pm];
    else if (suffix === '/stats') data = f.stats;
    else if (suffix === '/stats/progress-details') data = { records: f.records, tasks: [f.task], workHours: f.capacity, deliverySummary: f.summary, scopeMeta: { taskCount: 1 }, demandSources: [] };
    else if (suffix === '/fill/REQ064-fixture') data = { staff: f.staff, task: f.task, records: f.fillRecords || f.records.slice(0, 4), draft_records: [], demandSources: [] };
    else if (suffix === '/fill/REQ064-fixture/history') data = { tasks: [] };
    if (data !== undefined) return route.fulfill({ status: 200, json: { code: 0, success: true, data } });
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const card = () => page.locator('.dt-delivery-card').first();
  const dialog = () => page.locator('.dt-delivery-dialog');
  async function loadStats(options) { f = fixture(options); await page.goto(`${APP}/stats?admin=1`, { waitUntil: 'networkidle' }); await card().waitFor(); }
  try {
    await check('R4-E-002-UI', async () => {
      await loadStats();
      const text = await card().innerText(); for (const label of ['有效已交付', '有效交付率', '加权交付率']) assert.ok(text.includes(label), `card missing ${label}`);
      assert.equal(number(await card().getByTestId('expected-hours').innerText()), 40);
      assert.equal(number(await card().getByTestId('delivered-hours').innerText()), 40);
      assert.equal(number(await card().getByTestId('delivery-rate').innerText()), 100);
      assert.equal(number(await card().getByTestId('weighted-delivery-rate').innerText()), 70);
      assert.equal(number(await card().getByTestId('requirement-progress').innerText()), 62.5);
      assert.equal(number(await card().getByTestId('progress-coverage').innerText()), 100);
      const tips = {};
      for (const id of ['expected-hours', 'delivered-hours', 'delivery-rate', 'weighted-delivery-rate', 'requirement-progress', 'progress-coverage']) {
        tips[id] = await card().getByTestId(id).evaluate(el => el.closest('[title]')?.getAttribute('title') || '');
        assert.ok(tips[id].includes('＝'), `${id} has no individual formula`);
      }
      for (const title of ['请假', '培训', '公司会议', '出差', '团建']) assert.ok(tips['delivered-hours'].includes(title));
      assert.equal(await card().locator('tbody tr').count(), 0, 'outer card has person rows');
      const chart = await page.getByTestId('department-engineering-chart').boundingBox(); assert.ok(chart.y + 100 < 900, 'chart pushed below first viewport');
      await snapshot('stats-desktop');
      await card().locator('.stats-hours-heading').click(); await dialog().waitFor();
      assert.equal(number(await dialog().getByTestId('weighted-delivery-rate').first().innerText()), 70);
      assert.equal(number(await dialog().getByTestId('requirement-progress').first().innerText()), 62.5);
      assert.equal(await dialog().getByRole('tab').first().innerText(), '总览');
      const people = dialog().getByTestId('analysis-people'); assert.match(await people.innerText(), /REQ064测试甲/);
      assert.match(await people.innerText(), /加权交付率/);
      const spotlight = await dialog().getByTestId('analysis-spotlight').boundingBox();
      const dialogBox = await dialog().boundingBox(); assert.ok(spotlight.height < dialogBox.height * .42, 'desktop summary consumes too much dialog');
      await snapshot('stats-dialog-desktop');
      await dialog().locator('.el-dialog__headerbtn').click();
      await loadStats({ missing: true }); assert.equal(number(await card().getByTestId('weighted-delivery-rate').innerText()), 90);
      assert.equal(await card().getByTestId('historical-progress-note').count(), 0);
      assert.equal(number(await card().getByTestId('requirement-progress').innerText()), 75);
      assert.equal(number(await card().getByTestId('progress-coverage').innerText()), 50);
      return { text, chart, tips, spotlight, dialogBox, unknown: await card().innerText() };
    });
    await check('R4-E-001-FILL', async () => {
      f = fixture(); await page.goto(`${APP}/fill/REQ064-fixture`, { waitUntil: 'networkidle' });
      const summary = page.locator('.fill-hours-summary'); await summary.waitFor();
      const text = await summary.innerText(); assert.match(text, /预估工时完成度/); assert.match(text, /预估加权工时完成度/); assert.match(text, /100%/); assert.match(text, /70%/);
      const row = page.locator('.el-table__body tbody tr').first();
      const title = row.locator('input[placeholder="输入需求名称"]');
      const version = row.locator('td').nth(2).locator('input');
      const hours = row.locator('.el-input-number input');
      await hours.fill('3.5'); await hours.press('Tab');
      const originalVersion = await version.inputValue();
      const transitions = [];
      for (const category of ['培训', '公司会议', '出差', '团建', '请假']) {
        await title.fill(category); await title.press('Tab');
        assert.equal(number(await hours.inputValue()), 3.5, category + ' changed manual hours');
        assert.match(await version.inputValue(), /^v\d{6}$/);
        assert.ok(await version.evaluate(el => el.readOnly || el.disabled), 'special version is editable');
        assert.match(await row.innerText(), /不适用/);
        transitions.push({ category, hours: await hours.inputValue(), version: await version.inputValue() });
      }
      await title.fill('普通需求甲'); await title.press('Tab'); assert.equal(await version.inputValue(), originalVersion); assert.equal(number(await hours.inputValue()), 3.5);
      const summaryBox = await summary.boundingBox(); assert.ok(summaryBox.height <= 110, `summary exceeds compact height ${summaryBox.height}`);
      await snapshot('fill-manual-hours-desktop');
      return { initialSummary: text, transitions, restoredVersion: originalVersion, summaryBox };
    });
    await check('R4-I-001-UI-EXPORT', async () => {
      await page.setViewportSize({ width: 1600, height: 900 }); await loadStats();
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: '📤 导出Excel', exact: true }).click();
      const target = path.join(DIR, 'fixture-effective-hours.xlsx'); await (await downloaded).saveAs(target);
      const workbook = XLSX.readFile(target); assert.ok(workbook.SheetNames.includes('交付汇总'));
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets['交付汇总'], { header: 1 });
      const summary = Object.fromEntries(rows[0].map((key, index) => [key, rows[1][index]]));
      assert.equal(summary['有效已交付/h'], 40); assert.equal(summary['应交付工时/h（工作日×8）'], 40);
      assert.equal(number(String(summary['有效交付率'])), 100); assert.equal(number(String(summary['加权交付率'])), 70);
      assert.equal(number(String(summary['需求填报进度'])), 62.5); assert.equal(number(String(summary['进度覆盖'])), 100);
      const allCells = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 })).flat().map(String);
      assert.ok(allCells.includes('培训')); assert.ok(allCells.includes('日常支持'));
      return { sheets: workbook.SheetNames, summary, includesSpecialAndUnversioned: true };
    });
    await check('R4-E-001-FILL-SAVE', async () => {
      const evidence = [];
      for (const role of ['ai_dev', 'ai_pm']) {
        f = fixture(); f.staff.role = role;
        f.fillRecords = [{ ...f.records[3], id: undefined, requirement_title: '  公司会议  ', hours: 3.5, version: '', product_managers: [], demand_sources: [] }];
        await page.goto(`${APP}/fill/REQ064-fixture`, { waitUntil: 'networkidle' });
        const tableRow = page.locator('.el-table__body tbody tr').first();
        assert.match(await tableRow.innerText(), /不适用/);
        const submitted = page.waitForRequest(req => req.url().endsWith('/fill/REQ064-fixture/submit') && req.method() === 'POST');
        await page.getByRole('button', { name: '🚀 提交', exact: true }).click();
        const body = (await submitted).postDataJSON();
        assert.equal(body.records.length, 1); assert.equal(body.records[0].requirement_title, '公司会议');
        assert.equal(body.records[0].hours, 3.5); assert.equal(body.records[0].delivery_progress, null);
        assert.match(body.records[0].version, /^v\d{6}$/); assert.deepEqual(body.records[0].product_managers, []); assert.deepEqual(body.records[0].demand_sources, []);
        evidence.push({ role, submitted: body.records[0], intercepted: true });
      }
      f = fixture({ missing: true }); f.fillRecords = [f.records[0]];
      await page.goto(`${APP}/fill/REQ064-fixture`, { waitUntil: 'networkidle' });
      assert.equal(await page.getByTestId('fill-preview-weighted').innerText(), '40%');
      assert.match(await page.locator('.fill-hours-summary').innerText(), /加权\s*16h/);
      assert.doesNotMatch(await page.locator('.fill-hours-summary').innerText(), /待补进度/);
      assert.doesNotMatch(await page.locator('.fill-hours-summary').innerText(), /加权\s*0h/);
      const saved = page.waitForRequest(req => req.url().endsWith('/fill/REQ064-fixture/submit') && req.method() === 'POST');
      await page.getByRole('button', { name: '🚀 提交', exact: true }).click();
      const legacy = (await saved).postDataJSON(); assert.equal(legacy.records[0].delivery_progress, null);
      f = fixture(); f.fillRecords = [{ ...f.records[0], delivery_progress: 0 }];
      await page.goto(`${APP}/fill/REQ064-fixture`, { waitUntil: 'networkidle' });
      assert.equal(await page.getByTestId('fill-preview-weighted').innerText(), '0%');
      const submissionsBefore = writes.filter(write => write.path.endsWith('/submit')).length;
      await page.getByRole('button', { name: '🚀 提交', exact: true }).click();
      await page.locator('.el-message__content').filter({ hasText: '不能为0%' }).waitFor();
      assert.equal(writes.filter(write => write.path.endsWith('/submit')).length, submissionsBefore);
      await snapshot('fill-zero-progress');
      return { specialSaves: evidence, legacyProgressPreserved: legacy.records[0].delivery_progress, explicitZeroReadAsZero: true, explicitZeroSubmitRejected: true };
    });
    await check('R4-E-003-UI', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); const evidence = [];
      for (const [name, route] of [['fill', '/fill/REQ064-fixture'], ['stats', '/stats?admin=1']]) {
        f = fixture(); await page.goto(APP + route, { waitUntil: 'networkidle' });
        const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert.ok(dimensions.width <= dimensions.viewport, `${name} overflow ${JSON.stringify(dimensions)}`);
        await snapshot(`${name}-mobile`); evidence.push({ name, dimensions });
      }
      await card().locator('.stats-hours-heading').click(); await dialog().waitFor();
      const box = await dialog().boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 391);
      const peopleViewport = dialog().getByTestId('analysis-people').locator('.staff-delivery-viewport');
      const peopleVisibility = await peopleViewport.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
      assert.ok(peopleVisibility.height >= 52, `mobile person table squeezed away ${JSON.stringify(peopleVisibility)}`);
      const spotlight = dialog().getByTestId('analysis-spotlight');
      await spotlight.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const visiblePerson = await peopleViewport.locator('tbody tr').first().boundingBox();
      const spotlightBox = await spotlight.boundingBox();
      assert.ok(visiblePerson.y >= spotlightBox.y && visiblePerson.y + visiblePerson.height <= spotlightBox.y + spotlightBox.height, 'mobile person row cannot be reached by scrolling');
      await snapshot('stats-dialog-mobile-people');
      await dialog().getByRole('tab', { name: '工时记录', exact: true }).click();
      const table = dialog().locator('.el-tab-pane:visible .el-table').first(); await table.waitFor();
      const firstRow = await table.locator('.el-table__body tbody tr').first().boundingBox(); assert.ok(firstRow.y + firstRow.height < 844, 'dialog table hidden below viewport');
      await snapshot('stats-dialog-mobile'); assert.deepEqual(errors, [], 'browser page errors');
      return { evidence, box, firstRow, peopleVisibility, visiblePerson, spotlightBox, errors, interceptedWrites: writes.map(({ path, method }) => ({ path, method })) };
    });
    await check('R4-E-003-UI-1280', async () => {
      await page.setViewportSize({ width: 1280, height: 900 }); await loadStats();
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert.equal(dimensions.width, dimensions.viewport);
      const chart = await page.getByTestId('department-engineering-chart').boundingBox(); assert.ok(chart.y + 200 < 900, '1280 chart has less than 200px visible');
      await snapshot('stats-1280'); await card().locator('.stats-hours-heading').click(); await dialog().waitFor();
      await dialog().getByRole('tab', { name: '工时记录', exact: true }).click();
      const firstRow = await dialog().locator('.el-tab-pane:visible .el-table__body tbody tr').first().boundingBox(); assert.ok(firstRow.y + firstRow.height < 900);
      const tabs = await dialog().getByRole('tab').allInnerTexts(); assert.equal(tabs[0], '总览'); assert.ok(tabs.includes('需求进度'));
      await snapshot('stats-dialog-1280'); await dialog().locator('.el-dialog__headerbtn').click();
      const mainTabs = await page.getByTestId('stats-main-records').getByRole('tab').allInnerTexts(); assert.deepEqual(mainTabs, ['研发及其他人员', 'AI产品经理']);
      return { dimensions, chart, firstRow, tabs, mainTabs };
    });
    await check('R4-E-003-UI-LIVE', async () => {
      useLive = true; await page.setViewportSize({ width: 1600, height: 900 });
      const data = await get('/stats?year=2026&quarter=Q3');
      await loadStats();
      assert.equal(number(await card().getByTestId('delivered-hours').innerText()), data.deliverySummary.deliveredHours);
      assert.equal(number(await card().getByTestId('expected-hours').innerText()), data.deliverySummary.standardHours);
      assert.equal(number(await card().getByTestId('delivery-rate').innerText()), data.deliverySummary.deliveryRate);
      assert.equal((await card().getByTestId('weighted-delivery-rate').innerText()).trim(), delivery.weightedRateText(data.deliverySummary));
      await snapshot('live-stats-desktop');
      await card().locator('.stats-hours-heading').click(); await dialog().waitFor();
      assert.equal(number(await dialog().getByTestId('delivered-hours').first().innerText()), data.deliverySummary.deliveredHours);
      const visiblePeople = await dialog().getByTestId('analysis-people').locator('tbody tr').count();
      const peopleCount = new Set(data.records.map(record => record.staff_id || record.staff?.id)).size; assert.equal(visiblePeople, peopleCount);
      await snapshot('live-stats-dialog');
      await dialog().locator('.el-dialog__headerbtn').click();
      await page.getByRole('tab', { name: '产品经理聚焦', exact: true }).click();
      const candidates = await page.locator('.el-tab-pane:visible .dt-pm-chip').count();
      assert.ok(candidates <= data.pmDistribution.filter(pm => pm.records?.length).length, 'PM focus contains candidates without current-scope data');
      assert.deepEqual(errors, [], 'browser page errors');
      return { aggregate: briefSummary(data.deliverySummary), records: data.records.length, visiblePeople, candidates, source: 'real local GET only' };
    });
  } finally { fs.writeFileSync(path.join(DIR, 'runtime.json'), JSON.stringify({ errors, writes, requests }, null, 2)); await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
