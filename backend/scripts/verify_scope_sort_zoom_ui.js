/* Bounded scope/sort/zoom regression. Browser fixtures and read-only local GETs only. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/@test/delivered_hours_20260916');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const DIR = path.join(OUT, 'evidence', RUN);
const FILTER = process.argv.find(arg => arg.startsWith('--case='))?.slice(7).split(',');
fs.mkdirSync(DIR, { recursive: true });
const results = [], errors = [], failures = [], writes = [], requests = [], exportsSeen = [];
let page, live = true;
const round = value => Math.round(value * 100) / 100;
const versioned = r => Boolean(String(r.version || '').trim() && String(r.version).trim() !== '-');
const roles = [['ai_dev', 'AI开发工程师', 'AI开发', '#165DFF'], ['voip', 'VOIP工程师', 'VOIP', '#00B42A'], ['ai_quality', 'AI质量工程师', 'AI质量', '#FF7D00'], ['embedded', '嵌入式工程师', '嵌入式', '#14B8A6'], ['ai_pm', 'AI产品经理', 'AI产品', '#722ED1']].map(([key, name, short_name, color], i) => ({ key, name, short_name, color, sort_order: i * 10, is_active: true }));
function fixture() {
  const people = [['a', '范围研发甲', 'ai_dev'], ['b', '范围研发乙', 'ai_dev'], ['q', '范围质量丙', 'ai_quality'], ['p', '范围产品丁', 'ai_pm'], ['p2', '范围产品戊', 'ai_pm'], ['empty', '范围未填己', 'ai_dev']].map(([id, name, role]) => ({ id: `SSZ-${id}`, name, role, is_active: true, employment_status: 'active' }));
  const tasks = [['w1', 38, '2026-09-14', '2026-09-20'], ['w2', 37, '2026-09-07', '2026-09-13'], ['old', 2, '2025-01-06', '2025-01-12']].map(([id, week_number, start_date, end_date]) => ({ id: `SSZ-${id}`, title: `SSZ${id}验证周`, year: Number(start_date.slice(0, 4)), week_number, time_dimension: 'week', start_date, end_date, status: 'active' }));
  const pms = [{ id: 'SSZ-pm1', name: '归属经理甲', is_active: true }, { id: 'SSZ-pm2', name: '归属经理乙', is_active: true }];
  const sources = ['来源甲', '来源乙', '来源丙', '来源丁'].map((name, i) => ({ id: `SSZ-source-${i}`, name, color: ['#165dff', '#722ed1', '#00b42a', '#ff7d00'][i], sort_order: i }));
  const rec = (id, hours, person, task, version, created_at, progress = 0) => ({ id, hours, staff: person, staff_id: person.id, task_id: task.id, role: person.role, requirement_title: id, version, created_at, delivery_progress: progress, product_managers: pms.map(pm => pm.name), source_type: person.role === 'ai_pm' ? 'product_manager' : 'engineering', is_product_manager_record: person.role === 'ai_pm', ...(person.role === 'ai_pm' ? { demand_sources: sources.slice(0, 2).map(s => s.name), demand_source_weights: { '来源甲': 70, '来源乙': 30 } } : {}) });
  const records = Array.from({ length: 43 }, (_, i) => rec(`SSZ需求${(i * 19) % 43 + 1}监控`, i === 39 ? 99 : i === 23 ? 0 : i === 4 ? null : i === 5 ? '2' : (i * 17) % 43 + 1, people[1], tasks[i % 2], `v${i % 3 + 1}`, i === 41 ? 'bad-date' : i === 42 ? null : new Date(Date.UTC(2026, 8, 16, 8, 59 - i)).toISOString()));
  records.push(rec('SSZ交付32', 32, people[0], tasks[0], 'v1', '2026-09-16T12:00:00Z'));
  records.push(rec('SSZ交付48', 48, people[2], tasks[0], 'v2', '2026-09-16T11:00:00Z'));
  records.push(rec('SSZ无版本16', 16, people[3], tasks[0], '', '2026-09-16T13:00:00Z', 100));
  records.push(rec('SSZ产品20', 20, people[4], tasks[1], 'v3', '2026-09-16T10:00:00Z'));
  const old = rec('SSZ历史40', 40, people[0], tasks[2], 'old', '2025-01-07T10:00:00Z');
  const units = tasks.flatMap(task => people.map(person => ({ staffId: person.id, staffName: person.name, role: person.role, taskId: task.id, calendarStatus: 'official', standardHours: 40, workDates: Array.from({ length: 5 }, (_, i) => { const d = new Date(task.start_date); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); }) })));
  const capacity = units => { const days = new Set(units.flatMap(u => u.workDates.map(d => `${u.staffId}|${d}`))); return { units, standardHours: days.size * 8, workingDays: days.size, calendarStatus: 'official' }; };
  const summary = (rows, cap) => { const recordedHours = round(rows.reduce((s, r) => s + Number(r.hours || 0), 0)), deliveredHours = round(rows.filter(versioned).reduce((s, r) => s + Number(r.hours || 0), 0)); return { ...cap, recordedHours, deliveredHours, unversionedHours: round(recordedHours - deliveredHours), deliveryRate: cap.standardHours ? round(deliveredHours / cap.standardHours * 100) : null }; };
  function data(params = {}) {
    const selectedTasks = params.scope === 'all' ? tasks : tasks.filter(t => t.year === 2026 && (!params.taskId || params.taskId === 'all' || t.id === params.taskId));
    const taskIds = new Set(selectedTasks.map(t => t.id));
    const accept = r => (!params.role || r.role === params.role) && (!params.sourceType || (params.sourceType === 'product_manager' ? r.role === 'ai_pm' : r.role !== 'ai_pm')) && (!params.staffId || r.staff_id === params.staffId);
    const rows = [...records, old].filter(r => taskIds.has(r.task_id) && accept(r));
    const selectedUnits = units.filter(u => taskIds.has(u.taskId) && accept({ role: u.role, staff_id: u.staffId }));
    const workHours = capacity(selectedUnits), deliverySummary = summary(rows, workHours);
    return { tasks: params.scope === 'all' ? tasks : tasks.slice(0, 2), records: rows, workHours, deliverySummary, staff: people, currentStaff: people, roleDefinitions: roles, demandSources: sources, summary: { totalHours: deliverySummary.recordedHours, recordCount: rows.length, staffCount: new Set(selectedUnits.map(u => u.staffId)).size, taskCount: new Set(rows.map(r => r.task_id)).size }, roleSummary: Object.fromEntries(roles.map(role => [role.key, rows.filter(r => r.role === role.key).reduce((s, r) => s + Number(r.hours || 0), 0)])), productManagerRecords: rows.filter(r => r.role === 'ai_pm'), pmDistribution: pms.map(pm => { const records = rows.filter(r => r.role !== 'ai_pm'); return { ...pm, records, total: records.reduce((s, r) => s + Number(r.hours || 0), 0), ai_dev: records.filter(r => r.role === 'ai_dev').reduce((s, r) => s + Number(r.hours || 0), 0), ai_quality: records.filter(r => r.role === 'ai_quality').reduce((s, r) => s + Number(r.hours || 0), 0) }; }), productDemandDistribution: [], matchGroups: [] };
  }
  return { people, tasks, pms, sources, records, old, data };
}
const f = fixture();
const main = () => page.getByTestId('stats-main-records');
const modal = () => page.locator('.dt-delivery-dialog');
const active = () => modal().locator('.el-tab-pane:visible').first();
const screen = name => page.screenshot({ path: path.join(DIR, `scope-sort-zoom-${name}.png`), animations: 'disabled' });
async function load() { await page.goto('http://localhost:5176/stats?admin=1', { waitUntil: 'networkidle' }); await main().waitFor(); }
async function close() { if (await modal().isVisible().catch(() => false)) { await modal().locator('.el-dialog__headerbtn').click(); await modal().waitFor({ state: 'hidden' }); } }
async function option(locator, text) { const input = await locator.evaluate(el => el.tagName === 'INPUT'); await (input ? locator.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," el-select ")][1]') : locator).click(); await page.getByRole('option', { name: text, exact: true }).click(); await page.waitForTimeout(80); }
async function tab(name) { await modal().getByRole('tab', { name, exact: true }).click(); await page.waitForTimeout(50); }
async function rows(root) { return root.locator('.el-table__body > tbody > tr').evaluateAll(nodes => nodes.map(node => Array.from(node.querySelectorAll('td .cell')).map(td => td.innerText.trim()))); }
async function allRows(root) { const found = []; for (let i = 0; i < 30; i++) { found.push(...await rows(root)); const next = root.locator('.el-pagination .btn-next'); if (!await next.count() || await next.isDisabled()) break; await next.click(); await page.waitForTimeout(50); } return found; }
async function sort(root, label, direction) { const cell = root.locator('thead th').filter({ has: page.locator('.cell', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }); await cell.locator(`.sort-caret.${direction}`).click(); await page.waitForTimeout(70); }
function createdOrder(input) { return input.map((r, i) => ({ r, i, n: r.created_at && Number.isFinite(Date.parse(r.created_at)) ? Date.parse(r.created_at) : null })).sort((a, b) => a.n == null ? b.n == null ? a.i - b.i : 1 : b.n == null ? -1 : b.n - a.n || a.i - b.i).map(x => x.r); }
function expectedOrder(input, key, descending) { const list = createdOrder(input); return list.map((r, i) => ({ r, i, v: key === 'date' ? r.created_at && Number.isFinite(Date.parse(r.created_at)) ? Date.parse(r.created_at) : null : key === 'hours' ? Number(r.hours || 0) : r.requirement_title })).sort((a, b) => a.v == null ? b.v == null ? a.i - b.i : 1 : b.v == null ? -1 : ((typeof a.v === 'number' ? a.v - b.v : a.v.localeCompare(b.v, 'zh-CN', { numeric: true })) * (descending ? -1 : 1)) || a.i - b.i).map(x => x.r.requirement_title); }
async function mainTotals(expected) { const text = await page.getByTestId('main-record-totals').innerText(); const values = text.match(/\d+(?:\.\d+)?/g).map(Number); assert.deepEqual(values, [expected.records.length, expected.deliverySummary.recordedHours, expected.deliverySummary.deliveredHours, expected.deliverySummary.unversionedHours]); return text; }
const metricNumber = text => Number(text.replaceAll(',', '').match(/-?\d+(?:\.\d+)?/)?.[0]);
async function modalTotals(data) { assert.equal(metricNumber(await modal().getByTestId('expected-hours').innerText()), data.workHours.standardHours); assert.equal(metricNumber(await modal().getByTestId('delivered-hours').innerText()), data.deliverySummary.deliveredHours); assert.equal(metricNumber(await modal().getByTestId('delivery-rate').innerText()), data.deliverySummary.deliveryRate); }
async function countOpen(key, expectedTab) { await page.getByTestId('stats-counts-card').locator(`[data-count="${key}"]`).click(); await modal().waitFor(); assert.equal(await modal().getByRole('tab', { name: expectedTab, exact: true }).getAttribute('aria-selected'), 'true'); }
async function check(id, fn) { if (FILTER && !FILTER.includes(id)) return; fs.writeFileSync(path.join(OUT, 'scope-sort-zoom-status.md'), `# 范围/排序/缩放验证\n\n批次 ${RUN}\n运行 ${id}\n`); let result; try { result = { run: RUN, id, status: 'PASS', evidence: await fn() }; } catch (e) { result = { run: RUN, id, status: 'FAIL', message: e.message, stack: e.stack, url: page.url(), body: (await page.locator('body').innerText()).slice(-8500) }; await screen(`${id}-failure`).catch(() => {}); } results.push(result); fs.appendFileSync(path.join(OUT, 'scope-sort-zoom-results.jsonl'), JSON.stringify(result) + '\n'); console.log(`${id}: ${result.status}${result.message ? ` ${result.message}` : ''}`); }
async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), suffix = url.pathname.replace(/^.*\/api/, ''), params = Object.fromEntries(url.searchParams);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes.push({ method: req.method(), suffix }); return route.fulfill({ json: { code: 0, data: {} } }); }
    requests.push({ suffix, params, live });
    if (suffix === '/stats/export.xlsx' && !live) { exportsSeen.push(params); return route.fulfill({ status: 200, body: 'isolated request parameter verification', headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename=qa.txt' } }); }
    if (live) return route.continue();
    const data = suffix === '/roles' ? roles : suffix === '/tasks' ? f.tasks.slice(0, 2) : suffix === '/pm' ? f.pms : suffix === '/stats' || suffix === '/stats/progress-details' ? f.data(params) : undefined;
    if (data !== undefined) return route.fulfill({ json: { code: 0, data } });
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(6500);
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('response', r => { if (r.status() >= 400) failures.push({ url: r.url(), status: r.status() }); });
  try {
    await check('SSZ-SCOPE', async () => {
      live = true; await load(); const data = await (await fetch('http://127.0.0.1:3001/api/stats?year=2026&quarter=Q3')).json(); const d = data.data || data;
      const overview = await mainTotals(d); await countOpen('records', '工时记录'); await modalTotals(d); assert.equal(await active().locator('.el-radio-button.is-active').innerText(), '全部记录'); assert.match(await active().locator('.el-pagination__total').innerText(), new RegExp(String(d.records.length))); await close();
      const current = { records: d.records.length, ...d.deliverySummary };
      const task = d.tasks.find(t => d.records.some(r => r.task_id === t.id));
      await option(page.locator('.dt-task-period-select'), task.title); const weekRes = await fetch(`http://127.0.0.1:3001/api/stats?year=2026&quarter=Q3&taskId=${encodeURIComponent(task.id)}`); const weekJson = await weekRes.json(); const week = weekJson.data || weekJson; await mainTotals(week); await countOpen('staff', '人员'); await modalTotals(week);
      const allJ = await (await fetch(`http://127.0.0.1:3001/api/stats/progress-details?scope=all&year=2026&quarter=Q3&taskId=${task.id}`)).json(); const all = allJ.data || allJ;
      await option(modal().locator('.dt-delivery-toolbar .el-select'), '全部周期'); await page.waitForFunction(standard => Number(document.querySelector('.dt-delivery-dialog [data-testid="expected-hours"]')?.innerText.replaceAll(',', '').match(/\d+(?:\.\d+)?/)?.[0]) === standard, all.workHours.standardHours); await modalTotals(all);
      await option(modal().locator('.dt-delivery-toolbar .el-select'), '当前周期'); await modalTotals(week); await close(); await load(); await page.evaluate(() => window.scrollTo(0, 0)); await screen('live-desktop');
      return { overview, current: { records: current.records, total: current.recordedHours, delivered: current.deliveredHours, capacity: current.standardHours }, week: { id: task.id, records: week.records.length, total: week.deliverySummary.recordedHours }, all: { records: all.records.length, total: all.deliverySummary.recordedHours, capacity: all.workHours.standardHours } };
    });
    await check('SSZ-FILTER', async () => {
      live = false; await load(); const observations = [];
      for (const [label, params] of [['AI开发工程师', { role: 'ai_dev' }], ['AI产品经理', { role: 'ai_pm', sourceType: 'product_manager' }]]) { await page.locator('.dt-delivery-card').filter({ hasText: label }).click(); const expected = f.data(params); await modalTotals(expected); await close(); await mainTotals(expected); observations.push({ label, count: expected.records.length }); }
      await option(page.getByRole('combobox', { name: '明细人员范围' }), '范围产品丁'); const selected = f.data({ role: 'ai_pm', sourceType: 'product_manager', staffId: 'SSZ-p' }); await mainTotals(selected); await countOpen('staff', '人员'); await modalTotals(selected); assert.equal((await rows(active())).length, 1);
      await option(modal().locator('.dt-delivery-toolbar .el-select'), '全部周期'); const all = f.data({ scope: 'all', role: 'ai_pm', sourceType: 'product_manager', staffId: 'SSZ-p' }); await modalTotals(all); assert.ok(requests.some(r => r.suffix === '/stats/progress-details' && r.params.scope === 'all' && r.params.staffId === 'SSZ-p' && r.params.role === 'ai_pm'));
      const count = exportsSeen.length; await modal().getByRole('button', { name: '导出 Excel', exact: true }).click(); await page.waitForFunction(() => true); for (let i = 0; i < 30 && exportsSeen.length === count; i++) await page.waitForTimeout(50); assert.equal(exportsSeen.at(-1).staffId, 'SSZ-p'); assert.equal(exportsSeen.at(-1).scope, 'all'); await close();
      await option(page.getByRole('combobox', { name: '明细岗位范围' }), 'AI产品独立工时'); await mainTotals(f.data({ sourceType: 'product_manager' }));
      for (const [key, tabName] of [['requirements', '需求'], ['tasks', '周期']]) { await countOpen(key, tabName); await modalTotals(f.data({ sourceType: 'product_manager' })); await close(); }
      await option(page.getByRole('combobox', { name: '明细岗位范围' }), 'AI研发'); await mainTotals(f.data({ sourceType: 'engineering' }));
      await option(page.getByRole('combobox', { name: '明细人员范围' }), '范围未填己'); await mainTotals(f.data({ sourceType: 'engineering', staffId: 'SSZ-empty' })); await countOpen('staff', '人员'); assert.equal((await rows(active())).length, 1); assert.match(await active().innerText(), /0%/); await close();
      return { observations, selectedPerson: selected.deliverySummary, allSelectedCapacity: all.workHours.standardHours, export: exportsSeen.at(-1), emptyStaffPreserved: true };
    });
    await check('SSZ-DEDUP', async () => {
      live = false; await load(); const expected = f.data(); const totals = await mainTotals(expected); const mainRows = await allRows(main()); assert.equal(mainRows.length, 47); assert.equal(new Set(mainRows.map(r => r[6])).size, 47); assert.equal(mainRows.filter(r => r[6] === 'SSZ交付32').length, 1); assert.match(mainRows.find(r => r[6] === 'SSZ交付32')[8], /归属经理甲、归属经理乙/);
      await countOpen('records', '工时记录'); const dialogRows = await allRows(active()); assert.deepEqual([...dialogRows.map(r => r[6])].sort(), [...mainRows.map(r => r[6])].sort()); await tab('总览'); assert.match(await active().innerText(), /47 条记录/); await modalTotals(expected); await close();
      return { totals, uniqueRecordCount: mainRows.length, doubledPmDistributionTotal: expected.pmDistribution.reduce((s, p) => s + p.total, 0), rawTotal: expected.deliverySummary.recordedHours };
    });
    await check('SSZ-SORT', async () => {
      live = false; await load(); const observations = [];
      for (const [label, key, direction] of [['工时/h', 'hours', 'descending'], ['工时/h', 'hours', 'ascending'], ['需求', 'name', 'ascending'], ['创建时间', 'date', 'ascending'], ['创建时间', 'date', 'descending']]) { await sort(main(), label, direction); const values = (await allRows(main())).map(r => r[6]); assert.deepEqual(values, expectedOrder(f.records, key, direction === 'descending')); observations.push({ label, direction, first: values.slice(0, 3), last: values.slice(-3) }); }
      await countOpen('records', '工时记录'); await sort(active(), '工时/h', 'descending'); assert.deepEqual((await allRows(active())).map(r => r[6]), expectedOrder(f.records, 'hours', true));
      await tab('需求'); await sort(active(), '工时/h', 'descending'); const grouped = await allRows(active()); const vals = grouped.map(r => Number(r[1])); assert.equal(vals.length, 47); assert.deepEqual(vals, [...vals].sort((a, b) => b - a));
      const tableHeaders = [];
      for (const name of ['人员', '工时记录', '普通版本（有版本号）', '无版本号版本', 'AI产品经理', '周期', '版本', '需求', '关键词', '数据质量', '需求进度']) { await tab(name); const headers = await active().locator('thead th').evaluateAll(nodes => nodes.map(n => ({ name: n.innerText.trim(), sortable: n.classList.contains('is-sortable') }))); assert.ok(headers.filter(h => h.name && h.name !== '#').every(h => h.sortable), `${name} has unsortable business column`); tableHeaders.push({ name, headers }); }
      await close(); return { observations, groupedRows: grouped.length, tableHeaders, nullHoursDisplay: '0 (record normalization)', nullDatesLast: true };
    });
    await check('SSZ-PAGING', async () => {
      live = false; await load(); await countOpen('records', '工时记录'); await active().locator('.btn-next').click(); assert.equal(await active().locator('.el-pager .is-active').innerText(), '2'); await sort(active(), '工时/h', 'descending'); assert.equal(await active().locator('.el-pager .is-active').innerText(), '1'); assert.equal((await rows(active()))[0][6], expectedOrder(f.records, 'hours', true)[0]);
      await active().locator('.btn-next').click(); const second = await rows(active()); await tab('普通版本（有版本号）'); assert.equal(await active().locator('.el-pager .is-active').innerText(), '1'); await tab('工时记录'); assert.equal(await active().locator('.el-pager .is-active').innerText(), '2'); assert.deepEqual(await rows(active()), second);
      await option(active().locator('.el-pagination__sizes .el-select'), '10条/页'); assert.equal((await rows(active())).length, 10); assert.equal(await active().locator('.el-pager .is-active').innerText(), '1'); await tab('普通版本（有版本号）'); assert.equal((await rows(active())).length, 20); await tab('工时记录'); await sort(active(), '创建时间', 'descending'); assert.deepEqual((await rows(active())).map(r => r[6]), expectedOrder(f.records, 'date', true).slice(0, 10)); await close(); return { sortResetsPage: true, independentPages: true, independentPageSizes: [10, 20], restoredNewestFirst: true };
    });
    await check('SSZ-DELIVERY', async () => {
      live = false; await load(); await countOpen('records', '工时记录'); const base = active().locator('.el-table__body > tbody > tr'); const r32 = base.filter({ hasText: 'SSZ交付32' }), r48 = base.filter({ hasText: 'SSZ交付48' }); assert.match(await r32.innerText(), /80%/); assert.match(await r48.innerText(), /120%/); assert.equal(await r48.locator('.is-complete').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(232, 247, 238)');
      await active().locator('.el-radio-button').filter({ hasText: '无版本号（仅记录）' }).click(); assert.equal((await rows(active())).length, 1); assert.match(await active().innerText(), /SSZ无版本16/); assert.doesNotMatch(await active().innerText(), /\d+(?:\.\d+)?%/); assert.equal(await modal().getByTestId('delivery-rate').count(), 0); await tab('无版本号版本'); assert.doesNotMatch(await active().innerText(), /\d+(?:\.\d+)?%/); await close(); return { versioned32: '80%', versioned48: '120%', legacy100Unversioned16: 'record only' };
    });
    await check('SSZ-ZOOM', async () => {
      live = false; await load(); const left = page.getByTestId('department-engineering-chart'), right = page.getByTestId('department-product-chart'); const before = { left: await left.locator('.dt-product-manager-label').allInnerTexts(), right: await right.locator('.dt-product-manager-label').allInnerTexts() };
      await left.getByTestId('product-chart-expand').click(); await page.getByTestId('product-chart-expanded').waitFor(); assert.equal(await right.getByTestId('product-chart-expand').getAttribute('aria-expanded'), 'false'); assert.deepEqual(await page.getByTestId('product-chart-expanded').locator('.dt-product-manager-label').allInnerTexts(), before.left); const leftBox = await page.getByTestId('product-chart-expanded').boundingBox(); await screen('left-expanded'); await page.keyboard.press('Escape'); await page.getByTestId('product-chart-expanded').waitFor({ state: 'hidden' });
      await right.getByTestId('product-chart-expand').click(); assert.equal(await left.getByTestId('product-chart-expand').getAttribute('aria-expanded'), 'false'); const expanded = page.getByTestId('product-chart-expanded'); assert.deepEqual(await expanded.locator('.dt-product-manager-label').allInnerTexts(), before.right); await expanded.getByRole('button', { name: '查看范围产品丁的工时记录' }).click(); await page.getByTestId('product-chart-shrink').click(); await expanded.waitFor({ state: 'hidden' }); await mainTotals(f.data({ role: 'ai_pm', sourceType: 'product_manager', staffId: 'SSZ-p' }));
      assert.deepEqual(await left.locator('.dt-product-manager-label').allInnerTexts(), before.left); assert.deepEqual(await right.locator('.dt-product-manager-label').allInnerTexts(), before.right); return { independentExpansion: true, escapeRestore: true, shrinkRestore: true, filterFromExpanded: true, before, leftBox };
    });
    await check('SSZ-LAYOUT', async () => {
      live = false; await load(); assert.equal(await page.getByRole('tab', { name: 'AI产品展示', exact: true }).count(), 0); assert.equal(await page.getByRole('tab', { name: 'AI研发展示', exact: true }).count(), 0);
      for (const name of ['研发聚焦', '产品经理聚焦', '部门展示']) { await page.getByRole('tab', { name, exact: true }).click(); assert.equal(await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected'), 'true'); }
      await countOpen('staff', '人员'); const firstRow = await active().locator('.el-table__body tbody tr').first().boundingBox(); assert.ok(firstRow.y + firstRow.height < 900); await close();
      await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0)); const yearSelect = page.locator('.el-select').filter({ has: page.getByRole('combobox', { name: '统计年份' }) }), quarterSelect = page.locator('.el-select').filter({ has: page.getByRole('combobox', { name: '统计季度' }) }); assert.match(await yearSelect.innerText(), /2026年/); assert.match(await quarterSelect.innerText(), /Q3/); const filterBounds = { year: await yearSelect.boundingBox(), quarter: await quarterSelect.boundingBox() }; assert.ok(filterBounds.year.width >= 119 && filterBounds.quarter.width >= 99); await screen('mobile'); const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth })); assert.equal(dimensions.width, 390);
      await page.getByTestId('department-product-chart').getByTestId('product-chart-expand').click(); const box = await page.getByTestId('product-chart-expanded').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390.5); await screen('mobile-expanded'); await page.getByTestId('product-chart-shrink').click(); await page.getByTestId('product-chart-expanded').waitFor({ state: 'hidden' }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390); assert.deepEqual(errors, []); assert.deepEqual(failures, []); await page.setViewportSize({ width: 1600, height: 900 }); return { removedTabs: true, focusTabsRetained: true, dimensions, filterBounds, expandedBox: box, desktopFirstRow: firstRow, errors, failures, writes };
    });
  } finally { fs.writeFileSync(path.join(DIR, 'scope-sort-zoom-runtime.json'), JSON.stringify({ run: RUN, results, errors, failures, writes, requests, exportsSeen }, null, 2)); await browser.close(); }
  const latest = new Map(); for (const line of fs.readFileSync(path.join(OUT, 'scope-sort-zoom-results.jsonl'), 'utf8').trim().split('\n')) { const r = JSON.parse(line); latest.set(r.id, r); }
  fs.writeFileSync(path.join(OUT, 'scope-sort-zoom-status.md'), `# 范围/排序/缩放验证\n\n最新批次 ${RUN}\n\n${[...latest.values()].map(r => `${r.id}: ${r.status} (${r.run})`).join('\n')}\n`);
  console.log(JSON.stringify({ run: RUN, evidence: DIR, errors, failures, writes })); process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
}
run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
