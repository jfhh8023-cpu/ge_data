/* Focused read-only popup regression. Never persist legacy access tokens. */
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const RUN = new Date().toISOString().replace(/[:.]/g, '-'), OUT = path.resolve(__dirname, '../../docs/@test/delivered_hours_20260916'), DIR = path.join(OUT, 'evidence', RUN);
fs.mkdirSync(DIR, { recursive: true });
const CASES = process.argv.find(a => a.startsWith('--case='))?.slice(7).split(',');
const results = [], errors = [], writes = [], requests = []; let page, current, context;
const clean = value => String(value).replace(/(\/pm\/view\/)[^/?\s"']+/g, '$1[redacted]').replace(/([?&]token=)[^&\s"']+/g, '$1[redacted]');
const number = v => Number(v.replace(/[^\d.-]/g, ''));
async function get(pathname, query = {}) { const res = await fetch('http://127.0.0.1:3001/api' + pathname + '?' + new URLSearchParams({ year: '2026', quarter: 'Q3', ...query })); assert.equal(res.status, 200); const j = await res.json(); return j.data || j; }
const shot = (p, label) => p.screenshot({ path: path.join(DIR, `product-personal-window-${label}.png`), animations: 'disabled' });
async function sourceState() { return page.getByTestId('stats-main-records').evaluate(el => ({ selected: el.querySelector('[role="tab"][aria-selected="true"]')?.innerText, text: el.querySelector('[data-testid="main-record-totals"]')?.innerText, records: [...el.querySelectorAll('[data-testid="real-row"]')].map(n => [n.dataset.source, n.dataset.recordId]), filters: [...el.querySelectorAll('.el-select__selected-item')].map(n => n.innerText) })); }
async function load() { current = page; await page.goto('http://localhost:5176/stats?admin=1', { waitUntil: 'networkidle' }); await page.getByTestId('stats-grouped-record-table').waitFor(); }
async function popupFrom(chart, name) { const ready = context.waitForEvent('page'); await page.getByTestId(chart).getByRole('button', { name: `查看${name}的工时记录`, exact: true }).click(); const child = await ready; current = child; await child.waitForLoadState('networkidle'); await child.locator('.pm-header').waitFor(); return child; }
async function checkPersonal(child, staff, query) {
  const data = await get(`/stats/personal/${staff.id}`, query), records = data.tasks.flatMap(t => t.records || []);
  assert.ok(records.every(r => r.staff_id === staff.id));
  const headerHours = number(await child.locator('.pm-stat-item').filter({ has: child.locator('.pm-stat-label', { hasText: /^总工时$/ }) }).locator('.pm-stat-val').innerText());
  const uiHours = await child.locator('.pm-task-card .hours-val').allInnerTexts(); assert.equal(headerHours, data.totalHours); assert.equal(uiHours.length, records.length); assert.equal(uiHours.reduce((s, v) => s + number(v), 0), Number(data.totalHours));
  assert.ok((await child.locator('.pm-name').innerText()).includes(staff.name));
  const titles = await child.locator('.pm-task-title').allInnerTexts(); assert.deepEqual([...titles].sort(), data.tasks.filter(t => t.records?.length).map(t => t.title).sort());
  return { staffId: staff.id, staffName: staff.name, query, records: records.length, totalHours: data.totalHours, visiblePeriods: titles.length, availablePeriods: data.tasks.length };
}
async function chooseFilter(child, index, name) { await child.locator('.pm-filter .el-select').nth(index).click(); await child.getByRole('option', { name, exact: true }).click(); }
async function check(id, fn) {
  if (CASES && !CASES.includes(id)) return;
  let result; try { result = { run: RUN, id, status: 'PASS', evidence: await fn() }; } catch (e) { result = { run: RUN, id, status: 'FAIL', message: clean(e.message), stack: clean(e.stack), body: clean((await current.locator('body').innerText()).slice(-3000)) }; await shot(current, id + '-failure').catch(() => {}); }
  results.push(result); fs.appendFileSync(path.join(OUT, 'product-personal-window-results.jsonl'), JSON.stringify(result) + '\n'); fs.writeFileSync(path.join(OUT, 'product-personal-window-status.md'), `# 产品本人新页验收\n\n批次：${RUN}\n\n${results.map(r => `- ${r.id}: ${r.status}`).join('\n')}\n`); console.log(`${id}: ${result.status}${result.message ? ' ' + result.message : ''}`);
}
async function run() {
  const base = await get('/stats'), staff = base.records.find(r => r.staff?.name === '张三' && r.staff.role === 'ai_pm').staff, week = base.tasks.find(t => t.week_number === 33);
  const browser = await chromium.launch({ headless: true }); context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.route('**/api/**', route => { if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { writes.push({ method: route.request().method(), path: clean(new URL(route.request().url()).pathname) }); return route.fulfill({ json: { code: 0, data: {} } }); } return route.continue(); });
  context.on('page', p => { p.setDefaultTimeout(7000); p.on('pageerror', e => errors.push(clean(e.message))); p.on('console', m => { if (m.type() === 'error') errors.push(clean(m.text())); }); });
  context.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/stats/personal/')) requests.push({ path: u.pathname, params: Object.fromEntries(['year', 'quarter', 'month', 'taskId'].filter(k => u.searchParams.has(k)).map(k => [k, u.searchParams.get(k)])) }); });
  page = await context.newPage();
  try {
    await check('PERSONAL-WINDOW', async () => {
      await load(); const before = await sourceState(); assert.equal(await page.getByText('点击产品经理姓名查看工时；需求方按保存权重分摊，总计按原始工时计算。', { exact: true }).count(), 0);
      const child = await popupFrom('department-product-chart', staff.name), url = new URL(child.url()); assert.equal(url.pathname, `/stats/product-manager/${staff.id}`); assert.equal(url.searchParams.get('year'), '2026'); assert.ok(['Q3', '3'].includes(url.searchParams.get('quarter'))); assert.equal(url.searchParams.get('admin'), '1'); assert.deepEqual(await sourceState(), before);
      const evidence = await checkPersonal(child, staff, {}); const chartTotal = await page.getByTestId('department-product-chart').locator(`[data-testid="product-total-point"][data-staff-id="${staff.id}"]`).getAttribute('data-value'); assert.equal(Number(chartTotal), evidence.totalHours); await shot(child, 'quarter-desktop'); await child.close();
      const legacy = await popupFrom('department-engineering-chart', '钟冠'); assert.ok(new URL(legacy.url()).pathname.startsWith('/pm/view/')); assert.ok((await legacy.locator('.pm-name').innerText()).includes('钟冠')); assert.ok(await legacy.locator('.pm-task-card').count() > 0); await legacy.close(); current = page;
      return { ...evidence, routePattern: '/stats/product-manager/:staffId', adminQueryPreserved: true, sourceUnchanged: true, chartTotal: Number(chartTotal), removedHint: true, legacyLeftEntry: 'PASS /pm/view/:token (token not persisted)' };
    });
    await check('PERSONAL-PERIOD', async () => {
      await load(); await page.locator('.dt-task-period-select').click(); await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/stats' && new URL(r.url()).searchParams.get('taskId') === week.id), page.getByRole('option', { name: week.title, exact: true }).click()]);
      const child = await popupFrom('department-product-chart', staff.name), url = new URL(child.url()); assert.equal(url.searchParams.get('taskId'), week.id); const weekly = await checkPersonal(child, staff, { taskId: week.id }); assert.equal(weekly.visiblePeriods, 1); await shot(child, 'week-desktop');
      await child.close(); await load(); const full = await popupFrom('department-product-chart', staff.name);
      // This staff has only one saved period; use an isolated second-period record to exercise ordering.
      const fixture = await get(`/stats/personal/${staff.id}`), withRecords = fixture.tasks.find(t => t.records.length), extra = fixture.tasks.find(t => !t.records.length); assert.ok(extra); extra.records = [{ ...withRecords.records[0], id: 'QA-personal-sort-only', task_id: extra.id, requirement_title: 'QA隔离周期排序', hours: 1 }]; fixture.totalHours += 1;
      await full.route('**/api/stats/personal/**', route => route.fulfill({ json: { code: 0, data: fixture } })); await full.reload({ waitUntil: 'networkidle' }); await full.locator('.pm-header').waitFor();
      const dates = async () => (await full.locator('.pm-task-dates').allInnerTexts()).map(s => s.trim()); const descending = await dates(); assert.equal(descending.length, 2); assert.deepEqual(descending, [...descending].sort().reverse()); await full.getByText('最早优先', { exact: true }).click(); assert.deepEqual(await dates(), [...descending].sort()); await full.getByText('最新优先', { exact: true }).click(); assert.deepEqual(await dates(), descending); await full.unroute('**/api/stats/personal/**');
      await chooseFilter(full, 0, '2027年'); await chooseFilter(full, 1, 'Q1'); await full.getByRole('button', { name: /搜索/ }).click(); await full.locator('.pm-empty').waitFor(); const empty = await checkPersonal(full, staff, { year: '2027', quarter: 'Q1' }); assert.equal(empty.records, 0); assert.equal(empty.totalHours, 0); await shot(full, 'empty'); await full.close(); current = page;
      return { weekly, sorting: { descending, reversedAndRestored: true }, empty };
    });
    await check('PERSONAL-LAYOUT', async () => {
      await load(); const child = await popupFrom('department-product-chart', staff.name); const desktop = await child.locator('.pm-header').boundingBox(); assert.ok(desktop.height > 0); await child.setViewportSize({ width: 390, height: 844 }); await child.waitForTimeout(150); assert.equal(await child.evaluate(() => document.documentElement.scrollWidth), 390); assert.ok(await child.locator('.pm-filter').isVisible()); await shot(child, 'mobile'); const mobile = await child.locator('.pm-header').boundingBox(); await child.close(); current = page; assert.deepEqual(errors, []); assert.deepEqual(writes, []); return { desktop, mobile, errors, writes };
    });
  } finally { fs.writeFileSync(path.join(DIR, 'product-personal-window-runtime.json'), JSON.stringify({ run: RUN, results, requests, errors, writes }, null, 2)); await browser.close(); }
  console.log(JSON.stringify({ run: RUN, dir: DIR })); process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
}
run().catch(e => { console.error(clean(e.stack)); process.exitCode = 1; });
