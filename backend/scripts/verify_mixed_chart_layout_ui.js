/* Focused real-data read-only visual checks. Sorting/fixture coverage is in verify_scope_sort_zoom_ui.js. */
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const DIR = path.resolve(__dirname, '../../docs/@test/delivered_hours_20260916/evidence', RUN);
fs.mkdirSync(DIR, { recursive: true });
const selectedWidth = Number(process.argv.find(v => v.startsWith('--width='))?.slice(8));
const sizes = [{ width: 1600, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }].filter(s => !selectedWidth || s.width === selectedWidth);
const results = [], errors = [], writes = [];
const num = t => Number(t.replaceAll(',', '').match(/-?\d+(?:\.\d+)?/)?.[0]);
const round = n => Math.round(n * 100) / 100;
async function api(params) { const j = await (await fetch('http://127.0.0.1:3001/api/stats/progress-details?' + new URLSearchParams(params))).json(); return j.data || j; }
function expected(data) {
  const map = new Map();
  for (const u of data.workHours.units) { if (!map.has(u.staffId)) map.set(u.staffId, { id: u.staffId, name: u.staffName, days: new Set(), tasks: new Set(), delivered: 0 }); const p = map.get(u.staffId); u.workDates.forEach(d => p.days.add(d)); p.tasks.add(u.taskId); }
  for (const r of data.records) { const p = map.get(r.staff_id || r.staff?.id), v = String(r.version || '').trim(); if (p && p.tasks.has(r.task_id) && v && v !== '-') p.delivered += Number(r.hours || 0); }
  return [...map.values()].map(p => ({ id: p.id, name: p.name, standard: p.days.size * 8, delivered: round(p.delivered), rate: round(p.delivered / (p.days.size * 8) * 100) }));
}
async function run() {
  const [dev, product, allDev] = await Promise.all([api({ year: 2026, quarter: 'Q3', role: 'ai_dev' }), api({ year: 2026, quarter: 'Q3', role: 'ai_pm' }), api({ scope: 'all', role: 'ai_dev' })]);
  const devRows = expected(dev), productRows = expected(product), allDevRows = expected(allDev);
  assert.equal(devRows.length, 6); assert.equal(devRows.filter(r => r.delivered === 0).length, 2); assert.equal(productRows.length, 5);
  const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: sizes[0] });
  await context.route('**/api/**', route => { if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { writes.push({ method: route.request().method(), url: route.request().url() }); return route.fulfill({ json: { code: 0, data: {} } }); } return route.continue(); });
  const page = await context.newPage(); page.setDefaultTimeout(6500); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const modal = () => page.locator('.dt-delivery-dialog'), active = () => modal().locator('.el-tab-pane:visible').first();
  const card = label => page.locator('.dt-delivery-card').filter({ has: page.locator('.dt-delivery-card-title', { hasText: label }) });
  const screen = name => page.screenshot({ path: path.join(DIR, name + '.png'), animations: 'disabled' });
  const close = async () => { await modal().locator('.el-dialog__headerbtn').click(); await modal().waitFor({ state: 'hidden' }); };
  async function readPeople(root, expect) {
    const rows = await root.locator('.staff-delivery-table tbody tr').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.staffId, cells: [...n.children].map(c => c.innerText.trim()) })));
    assert.equal(rows.length, expect.length);
    for (const p of expect) { const r = rows.find(r => r.id === p.id); assert.ok(r, p.name); assert.ok(r.cells[0].includes(p.name)); assert.deepEqual(r.cells.slice(1).map(num), [p.standard, p.delivered, p.rate], p.name); }
    return rows;
  }
  async function checkModal(expect) {
    const people = await readPeople(modal().getByTestId('analysis-people'), expect);
    const lowerRows = await active().locator('.el-table__body > tbody > tr').evaluateAll(nodes => nodes.map(n => [...n.querySelectorAll('td .cell')].map(c => c.innerText.trim())));
    assert.equal(lowerRows.length, expect.length); for (const p of expect) { const row = lowerRows.find(r => r[0].startsWith(p.name)); assert.ok(row, p.name); assert.deepEqual(row.slice(1, 4).map(num), [p.standard, p.delivered, p.rate]); }
    assert.equal(await modal().getByRole('tab').count(), 13); return { people, lowerRows };
  }
  async function geometry() { return modal().evaluate(el => { const rect = s => { const n = s === 'self' ? el : el.querySelector(s); if (!n) throw new Error('Missing geometry element ' + s); const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, clientHeight: n.clientHeight, scrollHeight: n.scrollHeight }; }; return { dialog: rect('self'), body: rect('.el-dialog__body'), spotlight: rect('[data-testid="analysis-spotlight"]'), people: rect('[data-testid="analysis-people"]'), details: rect('.dt-analysis-details'), firstRow: rect('.el-tab-pane:not([style*="display: none"]) .el-table__body tbody tr'), pagination: rect('.el-tab-pane:not([style*="display: none"]) .el-pagination') }; }); }
  try {
    await page.goto('http://localhost:5176/stats?admin=1', { waitUntil: 'networkidle' }); await page.getByTestId('stats-main-records').waitFor();
    if (process.argv.includes('--targeted')) {
      const list = card('AI开发工程师').locator('.staff-delivery-viewport');
      await list.scrollIntoViewIfNeeded(); await list.hover(); const before = await list.evaluate(el => el.scrollTop); await page.mouse.wheel(0, 250); await page.waitForTimeout(120); const after = await list.evaluate(el => el.scrollTop); assert.ok(after > before); assert.equal(await modal().isVisible().catch(() => false), false);
      await card('AI开发工程师').click(); await modal().waitFor(); await close();
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(120);
      const embedded = card('嵌入式工程师');
      const digits = await embedded.evaluate(el => [...el.querySelectorAll('.delivery-metric strong,.staff-delivery-table tbody td')].map(n => { const box = n.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(n); const text = range.getBoundingClientRect(); return { value: n.innerText, box: { left: box.left, right: box.right, width: box.width }, text: { left: text.left, right: text.right, width: text.width }, client: n.clientWidth, scroll: n.scrollWidth }; }));
      await embedded.screenshot({ path: path.join(DIR, 'mixed-mobile-14286-after.png'), animations: 'disabled' });
      assert.equal(digits.filter(d => d.value === '142.86%').length, 2); assert.ok(digits.every(d => d.text.right <= d.box.right + 1 && d.text.left >= d.box.left - 1), JSON.stringify(digits));
      const otherCards = [];
      for (const [label, values] of [['部门', [4352, 1673, 38.44]], ['AI开发工程师', [1552, 708, 45.62]]]) {
        const numbers = await card(label).locator('.delivery-metric strong').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(), t = document.createRange(); t.selectNodeContents(n); const b = t.getBoundingClientRect(); return { value: n.innerText, left: r.left, right: r.right, textLeft: b.left, textRight: b.right }; }));
        assert.deepEqual(numbers.map(n => num(n.value)), values); assert.ok(numbers.every(n => n.textRight <= n.right + 1 && n.textLeft >= n.left - 1), JSON.stringify({ label, numbers })); otherCards.push({ label, numbers });
      }
      const cardBoxes = await page.locator('.dt-delivery-card').evaluateAll(nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })); assert.equal(new Set(cardBoxes.map(b => b.x)).size, 2);
      await card('AI开发工程师').locator('.stats-hours-heading').click(); await modal().waitFor();
      await modal().getByRole('tab', { name: '需求进度', exact: true }).click(); assert.equal(await modal().getByRole('tab', { name: '需求进度', exact: true }).getAttribute('aria-selected'), 'true'); assert.ok(await active().locator('.el-table__body tbody tr').count() > 0);
      await modal().getByRole('tab', { name: '工时记录', exact: true }).click(); await active().locator('thead th').filter({ hasText: '工时/h' }).locator('.sort-caret.descending').click(); await page.waitForTimeout(120);
      const hours = await active().locator('.el-table__body tbody tr').evaluateAll(rows => rows.map(r => Number(r.querySelectorAll('td .cell')[9].innerText))); assert.deepEqual(hours, [...hours].sort((a, b) => b - a));
      const pagination = await active().locator('.el-pagination').boundingBox(), dialog = await modal().boundingBox(); assert.ok(pagination.y + pagination.height <= dialog.y + dialog.height - 8); await screen('mixed-mobile-record-sort');
      results.push({ case: 'targeted', wheel: { before, after }, centerOpens: true, digits, otherCards, cardBoxes, lastTabUsable: true, recordSortHours: hours, pagination, dialog }); console.log(JSON.stringify({ run: RUN, dir: DIR, status: 'PASS', results, errors, writes })); return;
    }
    for (const size of sizes) {
      await page.setViewportSize(size); await page.waitForTimeout(180); await page.evaluate(() => window.scrollTo(0, 0));
      const charts = [];
      for (const [id, sum, count] of [['department-engineering-chart', 2103, 9], ['department-product-chart', 401, 5]]) {
        const chart = page.getByTestId(id); const state = await chart.evaluate(el => ({ points: [...el.querySelectorAll('[data-testid="product-total-point"]')].map(n => Number(n.dataset.value)), groups: el.querySelectorAll('.dt-product-manager-group').length, totalBars: el.querySelectorAll('.dt-product-manager-bar[data-series="total"]').length, widths: [...el.querySelectorAll('.dt-product-manager-bar')].map(n => n.getBoundingClientRect().width), overflow: [...el.querySelectorAll('.dt-product-manager-chart-content,.dt-product-manager-chart-groups')].map(n => ({ client: n.clientWidth, scroll: n.scrollWidth })), lineColors: [...el.querySelectorAll('polyline')].map(n => n.getAttribute('stroke')) }));
        assert.equal(state.points.reduce((s, n) => s + n, 0), sum); assert.equal(state.groups, count); assert.equal(state.totalBars, 0); assert.ok(state.widths.every(w => Math.abs(w - 18) < .2)); assert.ok(state.overflow.every(v => v.scroll <= v.client + 1)); assert.ok(state.lineColors.every(c => c === '#F53F3F')); charts.push({ id, ...state });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), size.width);
      const devCard = await readPeople(card('AI开发工程师'), devRows), productCard = await readPeople(card('AI产品经理'), productRows);
      if (size.width === 1600) { await screen('mixed-main-1600'); await page.getByTestId('department-engineering-chart').locator('..').screenshot({ path: path.join(DIR, 'mixed-charts-1600.png'), animations: 'disabled' }); }
      await card('AI开发工程师').locator('.stats-hours-heading').click(); await modal().waitFor(); await page.waitForTimeout(180);
      const current = await checkModal(devRows), bounds = await geometry(), ratio = bounds.spotlight.height / bounds.body.height;
      const evidence = { size, charts, devCard, productCard, current, geometry: bounds, spotlightRatio: ratio }; results.push(evidence); await screen(`mixed-dev-dialog-${size.width}`);
      assert.ok(ratio >= .24 && ratio <= .45, JSON.stringify({ size, ratio })); assert.ok(bounds.firstRow.bottom < bounds.dialog.bottom); assert.ok(bounds.pagination.bottom <= bounds.dialog.bottom - 8, JSON.stringify({ size, bounds })); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), size.width);
      if (size.width === 1600) {
        await modal().locator('.dt-delivery-toolbar .el-select').click(); await page.getByRole('option', { name: '全部周期', exact: true }).click(); await page.waitForFunction(v => Number(document.querySelector('.dt-delivery-dialog [data-testid="expected-hours"]')?.innerText.replaceAll(',', '').match(/\d+(?:\.\d+)?/)?.[0]) === v, allDev.workHours.standardHours); await checkModal(allDevRows); results.push({ case: 'allScope', people: allDevRows, capacity: allDev.workHours.standardHours, delivered: allDev.deliverySummary.deliveredHours }); await modal().locator('.dt-delivery-toolbar .el-select').click(); await page.getByRole('option', { name: '当前周期', exact: true }).click(); await checkModal(devRows);
      }
      await close();
      if (size.width === 1600) { await card('AI产品经理').locator('.stats-hours-heading').click(); await modal().waitFor(); await page.waitForTimeout(150); await checkModal(productRows); await screen('mixed-product-dialog-1600'); await close(); }
    }
    assert.deepEqual(errors, []); console.log(JSON.stringify({ run: RUN, dir: DIR, status: 'PASS', results: results.map(r => ({ size: r.size, case: r.case, spotlightRatio: r.spotlightRatio, geometry: r.geometry })), errors, writes }));
  } catch (e) { results.push({ status: 'FAIL', message: e.message, stack: e.stack, body: (await page.locator('body').innerText()).slice(-4500) }); await screen('mixed-failure').catch(() => {}); console.log(JSON.stringify({ run: RUN, dir: DIR, status: 'FAIL', message: e.message })); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(DIR, 'mixed-layout-results.json'), JSON.stringify({ run: RUN, results, errors, writes }, null, 2)); await browser.close(); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
