/* Bounded read-only regression for the two submitter-source record tabs. */
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve(__dirname, '../../docs/@test/delivered_hours_20260916'), DIR = path.join(OUT, 'evidence', RUN);
fs.mkdirSync(DIR, { recursive: true });
const results = [], errors = [], writes = []; let page;
const main = () => page.getByTestId('stats-main-records'), tabs = () => page.getByTestId('main-record-tabs');
const grouped = () => main().getByTestId('stats-grouped-record-table'), modal = () => page.locator('.dt-delivery-dialog');
const round = n => Math.round(n * 100) / 100, sum = rows => round(rows.reduce((s, r) => s + Number(r.hours), 0));
const snap = name => page.screenshot({ path: path.join(DIR, `main-record-tabs-${name}.png`), animations: 'disabled' });
async function api(endpoint = '', params = {}) { const r = await fetch('http://127.0.0.1:3001/api/stats' + endpoint + '?' + new URLSearchParams({ year: '2026', quarter: 'Q3', ...params })); assert.equal(r.status, 200); return (await r.json()).data; }
async function load() { await page.goto('http://localhost:5176/stats?admin=1', { waitUntil: 'networkidle' }); await grouped().waitFor(); }
async function choose(label, name) { await page.locator('.el-select').filter({ has: page.getByRole('combobox', { name: label, exact: true }) }).click(); await page.getByRole('option', { name, exact: true }).click(); }
async function tab(source) { await tabs().getByRole('tab', { name: source === 'engineering' ? '研发及其他人员' : 'AI产品经理', exact: true }).click(); await main().locator(`[data-record-source="${source}"]`).waitFor(); }
async function close() { await modal().locator('.el-dialog__headerbtn').click(); await modal().waitFor({ state: 'hidden' }); }
async function state() { return grouped().evaluate(el => ({ records: [...el.querySelectorAll('[data-testid="real-row"]')].map(n => ({ id: n.dataset.recordId, source: n.dataset.source, hours: Number(n.dataset.hours), group: n.dataset.groupKey })), totals: [...el.querySelectorAll('[data-total-hours]')].map(n => ({ group: n.dataset.groupKey, hours: Number(n.dataset.totalHours) })), spans: [...el.querySelectorAll('tbody td[rowspan]')].filter(n => Number(n.getAttribute('rowspan')) > 1).length, medals: el.querySelectorAll('.medal-badge').length })); }
async function rowsMatch(expected) { const actual = await state(); assert.deepEqual(actual.records.map(r => r.id).sort(), expected.map(r => r.id).sort()); assert.equal(sum(actual.records), sum(expected)); assert.equal(sum(actual.totals), sum(expected)); return actual; }
async function analysisMatches(params, open = true) {
  const data = await api('/progress-details', { scope: 'current', ...params });
  if (open) await main().getByRole('button', { name: '查看当前范围分析', exact: true }).click();
  await modal().waitFor();
  const summary = modal().locator('.dt-delivery-dialog-summary');
  const values = await Promise.all(['expected-hours', 'delivered-hours', 'delivery-rate'].map(id => summary.getByTestId(id).innerText()));
  const nums = values.map(v => Number(v.replace(/[h%,\s]/g, ''))), m = data.deliverySummary;
  assert.deepEqual(nums, [m.standardHours, m.deliveredHours, m.deliveryRate]);
  await modal().getByRole('tab', { name: '工时记录', exact: true }).click();
  const total = Number((await modal().locator('.el-tab-pane:visible .el-pagination__total').innerText()).match(/\d+/)[0]); assert.equal(total, data.records.length);
  const evidence = { params, records: total, standardHours: m.standardHours, deliveredHours: m.deliveredHours, rate: m.deliveryRate }; await close(); return evidence;
}
async function check(id, fn) {
  let result; try { result = { run: RUN, id, status: 'PASS', evidence: await fn() }; } catch (e) { result = { run: RUN, id, status: 'FAIL', message: e.message, stack: e.stack, body: (await page.locator('body').innerText()).slice(-3000) }; await snap(id + '-failure').catch(() => {}); }
  results.push(result); fs.appendFileSync(path.join(OUT, 'main-record-tabs-results.jsonl'), JSON.stringify(result) + '\n'); fs.writeFileSync(path.join(OUT, 'main-record-tabs-status.md'), `# 主表身份页签验收\n\n批次：${RUN}\n\n${results.map(r => `- ${r.id}: ${r.status}`).join('\n')}\n`); console.log(id + ': ' + result.status + (result.message ? ' ' + result.message : ''));
}
async function tabGeometry() {
  await page.waitForTimeout(250);
  const geometry = await tabs().evaluate(el => { const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, y: r.y }; }; return { tabs: [...el.querySelectorAll(':scope > .el-tabs__header [role="tab"]')].map(n => ({ text: n.innerText, selected: n.getAttribute('aria-selected'), ...rect(n) })), bar: rect(el.querySelector(':scope > .el-tabs__header .el-tabs__active-bar')) }; });
  assert.ok(geometry.tabs[0].x < geometry.tabs[1].x); const selected = geometry.tabs.find(t => t.selected === 'true'); assert.ok(geometry.bar.x >= selected.x - 1 && geometry.bar.right <= selected.right + 1 && geometry.bar.width > 0, JSON.stringify(geometry)); return geometry;
}
async function run() {
  const base = await api(), bySource = { engineering: base.records.filter(r => r.staff?.role !== 'ai_pm'), product_manager: base.records.filter(r => r.staff?.role === 'ai_pm') };
  const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.route('**/api/**', route => { if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { writes.push({ method: route.request().method(), url: route.request().url() }); return route.fulfill({ json: { code: 0, data: {} } }); } return route.continue(); });
  page = await context.newPage(); page.setDefaultTimeout(7000); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await check('TABS-DATA', async () => {
      await load(); assert.equal(await tabs().getByRole('tab', { name: '研发及其他人员', exact: true }).getAttribute('aria-selected'), 'true');
      const data = {}, analysis = [];
      for (const source of ['engineering', 'product_manager']) {
        await tab(source); const initial = await rowsMatch(bySource[source]); assert.ok(initial.spans > 0 && initial.medals > 0); assert.ok(initial.records.every(r => r.source === source));
        await grouped().getByText('工时降序 ↓', { exact: true }).click(); const sorted = await state(); for (const group of new Set(sorted.records.map(r => r.group))) { const hours = sorted.records.filter(r => r.group === group).map(r => r.hours); assert.deepEqual(hours, [...hours].sort((a, b) => b - a)); }
        await grouped().getByText('按新增顺序', { exact: true }).click(); assert.deepEqual((await state()).records.map(r => r.id), initial.records.map(r => r.id));
        data[source] = { records: initial.records.length, hours: sum(initial.records), groups: initial.totals.length, mergedCells: initial.spans, medals: initial.medals, ids: initial.records.map(r => r.id), geometry: await tabGeometry() };
        await main().scrollIntoViewIfNeeded(); await snap(source + '-desktop'); analysis.push(await analysisMatches({ sourceType: source }));
      }
      assert.equal(data.engineering.ids.filter(id => data.product_manager.ids.includes(id)).length, 0); assert.equal(data.engineering.records + data.product_manager.records, base.records.length); assert.equal(data.engineering.hours + data.product_manager.hours, sum(base.records)); return { data, analysis, partitionCount: base.records.length, partitionHours: sum(base.records), overlap: 0 };
    });
    await check('TABS-LINKS', async () => {
      await load(); const observations = [];
      await page.locator('.dt-delivery-card').filter({ hasText: 'AI开发工程师' }).click(); await modal().waitFor(); await close(); assert.equal(await tabs().getByRole('tab', { name: '研发及其他人员', exact: true }).getAttribute('aria-selected'), 'true'); await rowsMatch(base.records.filter(r => r.staff?.role === 'ai_dev')); await choose('明细人员范围', '刘君');
      await tab('product_manager'); await rowsMatch(bySource.product_manager); assert.equal(await main().getByRole('combobox', { name: '明细岗位范围' }).count(), 0);
      await choose('明细人员范围', '张三'); const pm = base.records.find(r => r.staff?.name === '张三').staff; await rowsMatch(bySource.product_manager.filter(r => r.staff_id === pm.id)); observations.push(await analysisMatches({ sourceType: 'product_manager', staffId: pm.id }));
      await tab('engineering'); await rowsMatch(bySource.engineering); assert.ok((await main().locator('.dt-main-records-toolbar').innerText()).includes('全部非产品经理'));
      await page.getByTestId('department-product-chart').getByRole('button', { name: '查看张三的工时记录', exact: true }).click(); assert.equal(await tabs().getByRole('tab', { name: 'AI产品经理', exact: true }).getAttribute('aria-selected'), 'true'); await rowsMatch(bySource.product_manager.filter(r => r.staff_id === pm.id));
      await page.locator('.dt-delivery-card').filter({ hasText: 'AI产品经理' }).click(); await modal().waitFor(); await close(); await rowsMatch(bySource.product_manager); assert.equal(await tabs().getByRole('tab', { name: 'AI产品经理', exact: true }).getAttribute('aria-selected'), 'true');
      await page.locator('.dt-delivery-card').filter({ hasText: '· 部门' }).click(); observations.push(await analysisMatches({}, false));
      await page.getByTestId('stats-counts-card').locator('[data-count="records"]').click(); observations.push(await analysisMatches({}, false));
      return { observations, roleCard: 'ai_dev→engineering; ai_pm→product_manager', chart: '张三→product_manager + staffId', crossTabFiltersCleared: true };
    });
    await check('TABS-MOBILE', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await load(); const observations = [];
      for (const source of ['engineering', 'product_manager']) { await tab(source); await rowsMatch(bySource[source]); await tabs().locator('.el-tabs__header').scrollIntoViewIfNeeded(); const geometry = await tabGeometry(); assert.equal(geometry.tabs.length, 2); assert.ok(geometry.tabs.every(b => b.x >= 0 && b.right <= 390)); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390); await snap(source + '-mobile'); observations.push({ source, geometry }); }
      assert.deepEqual(errors, []); assert.deepEqual(writes, []); return { observations, errors, writes };
    });
  } finally { fs.writeFileSync(path.join(DIR, 'main-record-tabs-runtime.json'), JSON.stringify({ run: RUN, results, errors, writes }, null, 2)); await browser.close(); }
  console.log(JSON.stringify({ run: RUN, dir: DIR, errors, writes })); process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
}
run().catch(e => { console.error(e); process.exitCode = 1; });
