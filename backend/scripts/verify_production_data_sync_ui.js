/* Read-only local acceptance after the 2026-09-17 production snapshot restore. */
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const RUN = new Date().toISOString().replace(/[:.]/g, '-'), OUT = path.resolve(__dirname, '../../docs/@test/production_data_sync_20260917'), DIR = path.join(OUT, 'evidence', RUN);
fs.mkdirSync(DIR, { recursive: true });
const results = [], errors = [], writes = [], failed = []; let page;
const round = n => Math.round(n * 100) / 100, hours = r => round(r.reduce((s, x) => s + Number(x.hours), 0));
const sanitize = x => String(x).replace(/(\/pm\/view\/|\/fill\/)[^/?\s]+/g, '$1[redacted]').replace(/([?&]token=)[^&\s]+/g, '$1[redacted]');
async function get(p) { const r = await fetch('http://127.0.0.1:3001/api' + p); assert.equal(r.status, 200); const j = await r.json(); return j.data || j; }
async function screenshot(name) { await page.screenshot({ path: path.join(DIR, `${name}.png`), animations: 'disabled' }); }
async function check(id, fn) { let r; try { r = { run: RUN, id, status: 'PASS', evidence: await fn() }; } catch (e) { r = { run: RUN, id, status: 'FAIL', message: sanitize(e.message), stack: sanitize(e.stack) }; if (page) await screenshot(`${id}-failure`).catch(() => {}); } results.push(r); fs.appendFileSync(path.join(OUT, 'results.jsonl'), JSON.stringify(r) + '\n'); fs.writeFileSync(path.join(OUT, 'status.md'), `# 生产同步后只读验收\n\n批次：${RUN}\n\n${results.map(x => `- ${x.id}: ${x.status}`).join('\n')}\n`); console.log(`${id}: ${r.status}${r.message ? ' ' + r.message : ''}`); }
async function run() {
  const [all, q3, tasks, staff, pm] = await Promise.all([get('/stats/progress-details?scope=all'), get('/stats?year=2026&quarter=Q3'), get('/tasks'), get('/staff'), get('/pm')]);
  await check('SYNC-API', async () => { assert.equal(all.records.length, 880); assert.equal(hours(all.records), 11273.5); assert.equal(tasks.length, 34); assert.equal(staff.length, 13); assert.equal(pm.length, 14); assert.equal(tasks.reduce((s, t) => s + Number(t.record_count), 0), 880); assert.equal(q3.records.filter(r => r.is_product_manager_record).length, 0); return { history: { records: all.records.length, hours: hours(all.records), tasks: all.tasks.length }, entities: { tasks: tasks.length, staff: staff.length, productManagers: pm.length }, quarter: { records: q3.records.length, hours: hours(q3.records), tasks: q3.tasks.length, productRecords: 0 }, excelListAPI: 'not implemented; DB count/file integrity verified separately by parent' }; });
  const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.route('**/api/**', route => { const r = route.request(); if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) { writes.push({ method: r.method(), path: sanitize(new URL(r.url()).pathname) }); return route.fulfill({ json: { code: 0, data: {} } }); } return route.continue(); });
  page = await context.newPage(); page.setDefaultTimeout(7000); page.on('pageerror', e => errors.push(sanitize(e.message))); page.on('console', m => { if (m.type() === 'error') errors.push(sanitize(m.text())); }); page.on('response', r => { if (r.status() >= 400) failed.push({ status: r.status(), path: sanitize(new URL(r.url()).pathname) }); });
  try {
    await check('SYNC-STATS', async () => {
      await page.goto('http://localhost:5176/stats?admin=1', { waitUntil: 'networkidle' }); const main = page.getByTestId('stats-main-records'); await main.waitFor(); const tabs = page.getByTestId('main-record-tabs'); assert.equal(await tabs.getByRole('tab', { name: '研发及其他人员', exact: true }).getAttribute('aria-selected'), 'true');
      const rows = await main.locator('[data-testid="real-row"]').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.recordId, hours: Number(n.dataset.hours), source: n.dataset.source })));
      assert.deepEqual(rows.map(r => r.id).sort(), q3.records.map(r => r.id).sort()); assert.equal(hours(rows), hours(q3.records)); assert.ok(rows.every(r => r.source === 'engineering'));
      const groupTotal = await main.locator('[data-total-hours]').evaluateAll(nodes => nodes.reduce((s, n) => s + Number(n.dataset.totalHours), 0)); assert.equal(round(groupTotal), hours(q3.records));
      await screenshot('stats-q3-overview'); await main.scrollIntoViewIfNeeded(); await screenshot('stats-q3-engineering');
      assert.equal(await page.getByTestId('department-product-chart').getByTestId('product-total-point').count(), 0);
      const emptyChart = await page.getByTestId('department-product-chart').innerText(); await tabs.getByRole('tab', { name: 'AI产品经理', exact: true }).click(); assert.equal(await main.locator('[data-testid="real-row"]').count(), 0); const totals = await main.getByTestId('main-record-totals').innerText(); assert.ok(totals.includes('0 条记录') && totals.includes('0h')); await screenshot('stats-q3-product-empty'); assert.deepEqual(errors, []); return { records: rows.length, hours: hours(rows), groupTotal, productRecords: 0, emptyChart, productTotals: totals };
    });
    await check('SYNC-TASKS', async () => {
      await page.goto('http://localhost:5176/tasks?admin=1', { waitUntil: 'networkidle' }); await page.locator('.dt-quarter-tabs').waitFor(); const counts = {}; for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) counts[q] = tasks.filter(t => Number(t.year) === 2026 && Math.ceil(Number(String(t.end_date || t.start_date).slice(5, 7)) / 3) === Number(q.slice(1))).length;
      for (const [q, n] of Object.entries(counts)) assert.ok((await page.getByRole('tab', { name: new RegExp(`^${q}`) }).innerText()).includes(`${n} 个任务`));
      const expected = tasks.filter(t => Number(t.year) === 2026 && Math.ceil(Number(String(t.end_date || t.start_date).slice(5, 7)) / 3) === 3).map(t => t.title).sort(); const rows = await page.locator('.el-tab-pane:visible .el-table__body tbody tr').allInnerTexts(); assert.equal(rows.length, expected.length); assert.ok(expected.every(title => rows.some(row => row.includes(title)))); await screenshot('tasks-q3'); assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(failed, []); return { quarterCounts: counts, visibleQuarter: 'Q3', visibleTasks: rows.length, errors, writes, failedResponses: failed };
    });
  } finally { fs.writeFileSync(path.join(DIR, 'runtime.json'), JSON.stringify({ run: RUN, results, errors, writes, failedResponses: failed }, null, 2)); await browser.close(); }
  console.log(JSON.stringify({ run: RUN, dir: DIR })); process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
}
run().catch(e => { console.error(sanitize(e.stack)); process.exitCode = 1; });
