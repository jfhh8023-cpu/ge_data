/* Period dialog regression: local GET only, delayed GET response for race coverage. */
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve(__dirname, '../../docs/@test/delivered_hours_20260916');
const DIR = path.join(OUT, 'evidence', RUN); fs.mkdirSync(DIR, { recursive: true });
const filter = process.argv.find(a => a.startsWith('--case='))?.slice(7).split(',');
const results = [], requests = [], exportsSeen = [], errors = [], writes = [], completions = [];
let page, delayQ2 = false;
async function api(params) { const j = await (await fetch('http://127.0.0.1:3001/api/stats/progress-details?' + new URLSearchParams({ scope: 'current', year: 2026, quarter: 'Q3', taskId: 'all', ...params }))).json(); return j.data || j; }
const number = text => Number(text.replaceAll(',', '').match(/\d+(?:\.\d+)?/)?.[0]);
const brief = d => ({ records: d.records.length, standard: d.workHours.standardHours, delivered: d.deliverySummary.deliveredHours, total: d.deliverySummary.recordedHours, rate: d.deliverySummary.deliveryRate });
const modal = () => page.locator('.dt-delivery-dialog');
const active = () => modal().locator('.el-tab-pane:visible').first();
const select = (label, root = modal()) => root.locator('.el-select').filter({ has: page.getByRole('combobox', { name: label, exact: true }) });
async function choose(label, value, root) { await select(label, root).click(); await page.getByRole('option', { name: value, exact: true }).click(); }
async function tab(name) { await modal().getByRole('tab', { name, exact: true }).click(); }
async function checkData(data) {
  await page.waitForFunction(value => Number(document.querySelector('.dt-delivery-dialog [data-testid="delivered-hours"]')?.innerText.replaceAll(',', '').match(/\d+(?:\.\d+)?/)?.[0]) === value, data.deliverySummary.deliveredHours);
  await page.waitForFunction(() => [...document.querySelectorAll('.dt-delivery-dialog .el-loading-mask')].every(n => getComputedStyle(n).display === 'none' || !n.getClientRects().length));
  assert.equal(number(await modal().getByTestId('expected-hours').innerText()), data.workHours.standardHours);
  const rate = await modal().getByTestId('delivery-rate').innerText(); if (data.deliverySummary.deliveryRate == null) assert.match(rate, /—/); else assert.equal(number(rate), data.deliverySummary.deliveryRate);
  await tab('工时记录'); assert.equal(await active().locator('.el-radio-button.is-active').innerText(), '全部记录'); assert.equal(number(await active().locator('.el-pagination__total').innerText()), data.records.length);
  await tab('人员'); assert.equal(await active().locator('.el-table__body > tbody > tr').count(), new Set(data.workHours.units.map(u => u.staffId)).size);
}
async function open() { await page.locator('.dt-delivery-card').first().locator('.stats-hours-heading').click(); await modal().waitFor(); }
async function close() { await modal().locator('.el-dialog__headerbtn').click(); await modal().waitFor({ state: 'hidden' }); }
async function load() { await page.goto('http://localhost:5176/stats?admin=1', { waitUntil: 'networkidle' }); await page.getByTestId('stats-main-records').waitFor(); }
async function capture(name) { await page.screenshot({ path: path.join(DIR, `period-scope-${name}.png`), animations: 'disabled' }); }
async function exportParams(expected) { const before = exportsSeen.length; await modal().getByRole('button', { name: '导出 Excel', exact: true }).click(); for (let i = 0; i < 60 && exportsSeen.length === before; i++) await page.waitForTimeout(50); assert.ok(exportsSeen.length > before); const params = exportsSeen.at(-1); for (const [key, value] of Object.entries(expected)) assert.equal(params[key], String(value), key); return params; }
async function check(id, fn) { if (filter && !filter.includes(id)) return; let row; try { row = { run: RUN, id, status: 'PASS', evidence: await fn() }; } catch (e) { row = { run: RUN, id, status: 'FAIL', message: e.message, stack: e.stack, body: (await page.locator('body').innerText()).slice(-6500) }; await capture(id + '-failure').catch(() => {}); } results.push(row); fs.appendFileSync(path.join(OUT, 'period-scope-results.jsonl'), JSON.stringify(row) + '\n'); console.log(`${id}: ${row.status}${row.message ? ' ' + row.message : ''}`); }
async function run() {
  const [q3, q2, annual, all, q1, empty] = await Promise.all([api({}), api({ quarter: 'Q2' }), api({ quarter: 'all' }), api({ scope: 'all' }), api({ quarter: 'Q1' }), api({ year: 2027, quarter: 'Q1' })]);
  const q3Week = q3.tasks.find(t => q3.records.some(r => r.task_id === t.id)), q2Week = q2.tasks.find(t => q2.records.some(r => r.task_id === t.id));
  const [one3, one2] = await Promise.all([api({ taskId: q3Week.id }), api({ quarter: 'Q2', taskId: q2Week.id })]);
  const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), params = Object.fromEntries(url.searchParams), suffix = url.pathname.replace(/^.*\/api/, '');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes.push({ method: req.method(), suffix }); return route.fulfill({ json: { code: 0, data: {} } }); }
    requests.push({ suffix, params });
    if (suffix === '/stats/export.xlsx') { exportsSeen.push(params); return route.fulfill({ headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename=qa.txt' }, body: 'Only export request parameters are verified.' }); }
    if (suffix === '/stats/progress-details' && delayQ2 && params.quarter === 'Q2') { const response = await route.fetch(); await new Promise(r => setTimeout(r, 1100)); await route.fulfill({ response }); completions.push({ quarter: 'Q2', delayed: true }); return; }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(6500); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await check('PERIOD-CURRENT', async () => {
      await load(); await open(); await checkData(q3); assert.match(await select('记录周期范围').innerText(), /当前周期/); const before = requests.filter(r => r.suffix === '/stats/progress-details').length;
      await tab('全部追踪和进度'); assert.equal(number(await active().locator('.el-pagination__total').innerText()), q3.records.length); assert.equal(requests.filter(r => r.suffix === '/stats/progress-details').length, before); assert.match(await select('记录周期范围').innerText(), /当前周期/); await close();
      await page.locator('.dt-task-period-select').click(); await page.getByRole('option', { name: q3Week.title, exact: true }).click(); await open(); await checkData(one3); await tab('全部追踪和进度'); assert.equal(number(await active().locator('.el-pagination__total').innerText()), one3.records.length); const weekExport = await exportParams({ scope: 'current', year: 2026, quarter: 'Q3', taskId: q3Week.id });
      await choose('记录周期范围', '全部周期'); await checkData(all); assert.match(await modal().locator('.el-dialog__title').innerText(), /全部可见历史/); assert.notEqual(all.records.length, one3.records.length); await close(); await open(); await checkData(one3); assert.match(await select('记录周期范围').innerText(), /当前周期/); await close();
      return { quarter: brief(q3), week: { id: q3Week.id, ...brief(one3) }, trackingDoesNotBroaden: true, all: brief(all), reopenedUsesPage: true, weekExport };
    });
    await check('PERIOD-CUSTOM', async () => {
      await load(); const pageTitle = await page.locator('.dt-page-title').innerText(); await open(); await choose('记录周期范围', '其他周期'); await checkData(q3); await choose('弹窗统计季度', 'Q2'); await checkData(q2); assert.match(await modal().locator('.el-dialog__title').innerText(), /2026年 Q2/);
      await choose('弹窗具体周期', q2Week.title); await checkData(one2); assert.match(await modal().locator('.el-dialog__title').innerText(), new RegExp(String(q2Week.week_number))); const weekExport = await exportParams({ scope: 'current', year: 2026, quarter: 'Q2', taskId: q2Week.id }); await capture('custom-week-desktop');
      await choose('弹窗统计季度', '全年'); await checkData(annual); assert.match(await modal().locator('.el-dialog__title').innerText(), /全年/); const yearExport = await exportParams({ scope: 'current', year: 2026, quarter: 'all', taskId: 'all' }); assert.equal(await page.locator('.dt-page-title').innerText(), pageTitle); assert.match(await page.locator('.dt-task-period-select').innerText(), /全部周期/);
      await choose('记录周期范围', '全部周期'); await checkData(all); const allExport = await exportParams({ scope: 'all', year: 2026, quarter: 'Q3', taskId: 'all' }); await choose('记录周期范围', '当前周期'); await checkData(q3); await close(); await open(); await checkData(q3); await close();
      return { quarter: brief(q2), customWeek: { id: q2Week.id, ...brief(one2) }, annual: brief(annual), weekExport, yearExport, allExport, outsidePageUnchanged: true };
    });
    await check('PERIOD-RACE-EMPTY', async () => {
      await load(); await open(); await choose('记录周期范围', '其他周期'); await checkData(q3); delayQ2 = true; await choose('弹窗统计季度', 'Q2'); await modal().getByTestId('analysis-spotlight').locator('.el-loading-mask').waitFor({ state: 'visible' }); assert.ok(await modal().locator('.dt-restored-analysis-tabs > .el-loading-mask:visible').count());
      await choose('弹窗统计季度', 'Q1'); await checkData(q1); await page.waitForTimeout(1200); await checkData(q1); assert.ok(completions.some(c => c.delayed)); delayQ2 = false;
      await choose('弹窗统计年份', '2027年'); await checkData(empty); assert.equal(empty.records.length, 0); assert.equal(await modal().getByTestId('analysis-people').locator('tbody tr').count(), 0); assert.match(await modal().locator('.el-dialog__title').innerText(), /2027年 Q1/); await tab('全部追踪和进度'); assert.equal(number(await active().locator('.el-pagination__total').innerText()), 0); await capture('empty'); await choose('记录周期范围', '当前周期'); await checkData(q3); await close();
      return { delayedResponse: completions, latestQ1: brief(q1), empty: brief(empty), loadingMasks: 'summary and tabs', currentRestored: true };
    });
    await check('PERIOD-VISUAL', async () => {
      await load(); await page.mouse.move(0, 0); const cards = page.locator('.dt-delivery-card'), normal = await cards.evaluateAll(nodes => nodes.map(n => getComputedStyle(n).backgroundColor)); assert.equal(normal[0], 'rgb(239, 250, 250)'); assert.ok(normal.slice(1).every(c => c === 'rgb(255, 255, 255)')); await cards.first().hover(); assert.equal(await cards.first().evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(227, 246, 246)'); await page.mouse.move(0, 0); await capture('card-color-desktop');
      await page.setViewportSize({ width: 390, height: 844 }); await open(); await choose('记录周期范围', '其他周期'); await choose('弹窗统计季度', 'Q2'); await choose('弹窗具体周期', q2Week.title); await checkData(one2);
      const bodyBounds = await modal().locator('.el-dialog__body').boundingBox(), pagination = await active().locator('.el-pagination').boundingBox(), jumper = await active().locator('.el-pagination__jump').boundingBox();
      assert.ok(pagination.y + pagination.height <= bodyBounds.y + bodyBounds.height + 1, JSON.stringify({ bodyBounds, pagination })); assert.ok(jumper.y + jumper.height <= bodyBounds.y + bodyBounds.height + 1);
      const peopleViewport = modal().getByTestId('analysis-people').locator('.staff-delivery-viewport'); await peopleViewport.hover(); await page.mouse.wheel(0, 180); await page.waitForTimeout(100); const peopleScroll = await peopleViewport.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, content: el.scrollHeight })); assert.ok(peopleScroll.top > 0); await capture('custom-week-mobile');
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert.equal(dimensions.width, 390); const bounds = await modal().boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390.5); const selectors = await modal().locator('.dt-delivery-toolbar .el-select').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { text: n.innerText, x: r.x, right: r.right, width: r.width }; })); assert.ok(selectors.every(r => r.x >= 0 && r.right <= 390)); await choose('记录周期范围', '当前周期'); await checkData(q3); await close(); assert.deepEqual(errors, []); return { colors: normal, departmentHover: 'rgb(227, 246, 246)', dimensions, bounds, selectors, bodyBounds, pagination, jumper, peopleScroll, errors, writes };
    });
  } finally { fs.writeFileSync(path.join(DIR, 'period-scope-runtime.json'), JSON.stringify({ run: RUN, results, requests, exportsSeen, completions, errors, writes }, null, 2)); await browser.close(); }
  console.log(JSON.stringify({ run: RUN, dir: DIR, errors, writes })); process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
}
run().catch(e => { console.error(e); process.exitCode = 1; });
