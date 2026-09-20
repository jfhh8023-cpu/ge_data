/* Focused integration: restored grouped table and department counters. Read-only local GETs. */
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const RUN = new Date().toISOString().replace(/[:.]/g, '-'), OUT = path.resolve(__dirname, '../../docs/@test/delivered_hours_20260916'), DIR = path.join(OUT, 'evidence', RUN);
fs.mkdirSync(DIR, { recursive: true });
const FILTER = process.argv.find(a => a.startsWith('--case='))?.slice(7).split(',');
const results = [], errors = [], writes = []; let page, fixtureOn = false;
const counts = () => page.getByTestId('stats-counts-card');
const grouped = () => page.getByTestId('stats-grouped-record-table');
const modal = () => page.locator('.dt-delivery-dialog');
const people = () => page.locator('.department-people-dialog');
const active = () => modal().locator('.el-tab-pane:visible');
const sum = rows => Math.round(rows.reduce((s, r) => s + Number(r), 0) * 100) / 100;
const snap = name => page.screenshot({ path: path.join(DIR, `counts-grouped-${name}.png`), animations: 'disabled' });
async function api(query = {}) { const j = await (await fetch('http://127.0.0.1:3001/api/stats?' + new URLSearchParams({ year: 2026, quarter: 'Q3', ...query }))).json(); return j.data || j; }
async function load() { await page.goto('http://localhost:5176/stats?admin=1', { waitUntil: 'networkidle' }); await grouped().waitFor(); }
async function close(root) { await root.locator('.el-dialog__headerbtn').click(); await root.waitFor({ state: 'hidden' }); }
async function countValues() { return counts().locator('.stats-count-item').evaluateAll(nodes => Object.fromEntries(nodes.map(n => [n.dataset.count, Number(n.querySelector('strong').innerText)]))); }
async function choose(label, value) { await page.locator('.el-select').filter({ has: page.getByRole('combobox', { name: label, exact: true }) }).click(); await page.getByRole('option', { name: value, exact: true }).click(); }
async function groupedData() { return grouped().evaluate(el => ({ records: [...el.querySelectorAll('[data-testid="real-row"]')].map(n => ({ id: n.dataset.recordId, source: n.dataset.source, hours: Number(n.dataset.hours), group: n.dataset.groupKey })), totals: [...el.querySelectorAll('[data-total-hours]')].map(n => ({ group: n.dataset.groupKey, hours: Number(n.dataset.totalHours) })), headers: [...el.querySelectorAll('thead th')].map(n => n.innerText.trim()), spans: [...el.querySelectorAll('tbody td[rowspan]')].filter(n => Number(n.getAttribute('rowspan')) > 1).map(n => ({ span: Number(n.getAttribute('rowspan')), text: n.innerText.trim() })), medals: el.querySelectorAll('.medal-badge').length })); }
async function check(id, fn) { if (FILTER && !FILTER.includes(id)) return; let result; try { result = { run: RUN, id, status: 'PASS', evidence: await fn() }; } catch (e) { result = { run: RUN, id, status: 'FAIL', message: e.message, stack: e.stack, body: (await page.locator('body').innerText()).slice(-5500) }; await snap(id + '-failure').catch(() => {}); } results.push(result); fs.appendFileSync(path.join(OUT, 'counts-grouped-table-results.jsonl'), JSON.stringify(result) + '\n'); console.log(`${id}: ${result.status}${result.message ? ' ' + result.message : ''}`); }
async function run() {
  const base = await api(), w29 = base.tasks.find(t => t.week_number === 29), w33 = base.tasks.find(t => t.week_number === 33), weeks = await Promise.all([api({ taskId: w29.id }), api({ taskId: w33.id })]);
  const fake = structuredClone(base); const engineering = fake.records.find(r => r.staff?.role !== 'ai_pm'); assert.ok(engineering); engineering.product_managers = ['QA归属甲', 'QA归属乙']; fake.records.push(structuredClone(engineering));
  fake.tasks.push({ id: 'QA-empty-task', title: 'QA无记录第39周', time_dimension: 'week', year: 2026, week_number: 39, start_date: '2026-09-21', end_date: '2026-09-27', status: 'active', created_at: '2026-09-17T10:00:00Z' });
  const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.route('**/api/**', async route => { const r = route.request(), u = new URL(r.url()); if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) { writes.push({ method: r.method(), url: r.url() }); return route.fulfill({ json: { code: 0, data: {} } }); } if (fixtureOn && u.pathname.endsWith('/api/stats')) return route.fulfill({ json: { code: 0, data: fake } }); return route.continue(); });
  page = await context.newPage(); page.setDefaultTimeout(6500); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await check('COUNTS-PEOPLE', async () => {
      fixtureOn = false; await load(); const expected = { records: 147, requirements: 142, tasks: 7, staff: 16 }; assert.deepEqual(await countValues(), expected);
      await choose('明细岗位范围', 'AI开发工程师'); assert.deepEqual(await countValues(), expected); await choose('明细人员范围', '刘君'); assert.deepEqual(await countValues(), expected);
      await counts().locator('[data-count="staff"]').click(); await people().waitFor(); const rows = {};
      for (const [key, n] of [['engineering', 11], ['product', 5]]) { const group = people().locator(`[data-people-group="${key}"]`); rows[key] = await group.locator('.el-table__body tbody tr').allInnerTexts(); assert.equal(rows[key].length, n); await group.locator('thead th').filter({ hasText: '姓名' }).locator('.sort-caret.ascending').click(); const names = await group.locator('.el-table__body tbody tr td:first-child').allInnerTexts(); assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))); }
      assert.ok(rows.engineering.some(r => r.includes('张希亮')) && rows.engineering.some(r => r.includes('邬涛'))); await snap('people-desktop'); await close(people());
      for (const [key, tabName, n] of [['records', '工时记录', 147], ['requirements', '需求', 142], ['tasks', '周期', 7]]) { await counts().locator(`[data-count="${key}"]`).click(); await modal().waitFor(); assert.equal(await modal().getByRole('tab', { name: tabName, exact: true }).getAttribute('aria-selected'), 'true'); assert.equal(Number((await active().locator('.el-pagination__total').innerText()).match(/\d+/)[0]), n); await close(modal()); }
      const periodResults = [];
      for (const [task, data, staff] of [[w29, weeks[0], 15], [w33, weeks[1], 16]]) { await page.locator('.dt-task-period-select').click(); await page.getByRole('option', { name: task.title, exact: true }).click(); await page.waitForFunction(n => Number(document.querySelector('[data-count="staff"] strong')?.innerText) === n, staff); const values = await countValues(); assert.equal(values.tasks, 1); assert.equal(values.staff, staff); assert.equal(values.records, data.records.length); await counts().locator('[data-count="staff"]').click(); await people().waitFor(); assert.equal(await people().locator('.el-table__body tbody tr').count(), staff); await close(people()); periodResults.push({ week: task.week_number, values }); }
      return { quarter: expected, people: rows, periodResults, countersUnaffectedByRoleAndPerson: true, fourCountLinks: true };
    });
    await check('GROUPED-LIVE', async () => {
      fixtureOn = false; await load(); const initial = await groupedData(); assert.deepEqual(initial.headers, ['序号', 'AI产品经理', '版本号', '需求名称', '人员', '角色', '工时/小时']); assert.equal(initial.records.length, 147); assert.equal(new Set(initial.records.map(r => `${r.source}:${r.id}`)).size, 147); assert.equal(sum(initial.records.map(r => r.hours)), 2504); assert.equal(sum(initial.totals.map(r => r.hours)), 2504); assert.ok(initial.spans.length && initial.medals > 0); assert.equal(await page.getByTestId('stats-main-records').locator('.el-pagination').count(), 0);
      await grouped().getByText('工时降序 ↓', { exact: true }).click(); const sorted = await groupedData(); for (const key of new Set(sorted.records.map(r => r.group))) { const values = sorted.records.filter(r => r.group === key).map(r => r.hours); assert.deepEqual(values, [...values].sort((a, b) => b - a)); } await grouped().getByText('按新增顺序', { exact: true }).click(); const restored = await groupedData(); assert.deepEqual(restored.records.map(r => r.id), initial.records.map(r => r.id));
      await grouped().scrollIntoViewIfNeeded(); await snap('main-table-desktop'); await choose('明细岗位范围', 'AI开发工程师'); const filtered = await groupedData(); assert.equal(filtered.records.length, 40); assert.equal(sum(filtered.records.map(r => r.hours)), 724); assert.equal(sum(filtered.totals.map(r => r.hours)), 724); assert.deepEqual(await countValues(), { records: 147, requirements: 142, tasks: 7, staff: 16 });
      return { count: initial.records.length, groups: initial.totals.length, sum: 2504, groupedTotals: initial.totals, mergedCells: initial.spans.length, medals: initial.medals, groupSortingAndRestore: true, roleFiltered: { records: filtered.records.length, hours: 724 } };
    });
    await check('COUNTS-EMPTY-FIXTURE', async () => {
      fixtureOn = true; await load(); assert.deepEqual(await countValues(), { records: 147, requirements: 142, tasks: 8, staff: 16 }); const state = await groupedData(); assert.equal(state.records.length, 147); assert.equal(sum(state.records.map(r => r.hours)), 2504); assert.equal(sum(state.totals.map(r => r.hours)), 2504); const duplicate = state.records.filter(r => r.id === engineering.id && r.group === 'engineering:QA归属甲'); assert.equal(duplicate.length, 1); assert.equal(state.records.filter(r => r.group === 'engineering:QA归属乙').length, 0);
      await counts().locator('[data-count="tasks"]').click(); await modal().waitFor(); assert.equal(await modal().getByRole('tab', { name: '周期', exact: true }).getAttribute('aria-selected'), 'true'); const rows = await active().locator('.el-table__body tbody tr').evaluateAll(nodes => nodes.map(n => [...n.querySelectorAll('td .cell')].map(c => c.innerText.trim()))); assert.equal(rows.length, 8); const zero = rows.find(r => r[0].includes('39周')); assert.ok(zero, JSON.stringify(rows)); assert.ok(zero.slice(1).every(v => Number(v.replace('%', '')) === 0), JSON.stringify(zero)); await snap('zero-task-fixture'); await close(modal()); fixtureOn = false;
      return { displayedRecords: state.records.length, submittedPayloadRecords: fake.records.length, total: 2504, firstManagerOnly: true, collectionTasks: 8, emptyTaskRow: zero };
    });
    await check('COUNTS-LAYOUT', async () => {
      fixtureOn = false; await load(); const observations = [];
      for (const size of [{ width: 1600, height: 900 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(size); await page.waitForTimeout(100); await page.evaluate(() => window.scrollTo(0, 0)); const boxes = await page.locator('.dt-summary-strip .dt-delivery-card, .dt-summary-strip .stats-counts-card').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { kind: n.className, x: r.x, y: r.y, width: r.width, height: r.height }; })); assert.equal(boxes.length, 7); assert.ok(Math.max(...boxes.map(b => b.height)) - Math.min(...boxes.map(b => b.height)) < 1, JSON.stringify({ size, boxes })); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), size.width); if ([1600, 390].includes(size.width)) await snap(`cards-${size.width}`);
        await counts().locator('[data-count="staff"]').click(); await people().waitFor(); const columns = await people().locator('.department-people-group').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })); if (size.width > 600) assert.ok(Math.abs(columns[0].y - columns[1].y) < 1 && columns[1].x > columns[0].x); else { assert.ok(columns[1].y > columns[0].y && Math.abs(columns[0].x - columns[1].x) < 1); await snap('people-mobile'); } await close(people()); observations.push({ size, boxes, columns });
      }
      assert.deepEqual(errors, []); return { observations, errors, writes };
    });
  } finally { fs.writeFileSync(path.join(DIR, 'counts-grouped-runtime.json'), JSON.stringify({ run: RUN, results, errors, writes }, null, 2)); await browser.close(); }
  console.log(JSON.stringify({ run: RUN, dir: DIR, errors, writes })); process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
}
run().catch(e => { console.error(e); process.exitCode = 1; });
