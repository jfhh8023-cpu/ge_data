/* REQ-066: period-capacity weighted rates; live GET + isolated browser fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/@test/period_weighted_delivery_20260917');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const DIR = path.join(OUT, 'evidence', RUN);
const APP = 'http://localhost:5176', API = 'http://127.0.0.1:3001/api';
const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7).split(',');
const results = [], errors = [], writes = [];
let page, delivery, workHours;
fs.mkdirSync(DIR, { recursive: true });
const num = text => Number(String(text).replaceAll(',', '').match(/-?\d+(?:\.\d+)?/)?.[0]);
async function check(id, fn) {
  if (selected && !selected.includes(id)) return;
  let row;
  try { row = { run: RUN, id, status: 'PASS', evidence: await fn() }; }
  catch (error) { row = { run: RUN, id, status: 'FAIL', message: error.message, stack: error.stack }; if (page && !page.isClosed()) await shot(`${id}-failure`).catch(() => {}); }
  results.push(row); fs.appendFileSync(path.join(OUT, 'results.jsonl'), JSON.stringify(row) + '\n');
  console.log(`${id}: ${row.status}${row.message ? ' ' + row.message : ''}`);
}
async function get(suffix) { const res = await fetch(API + suffix); assert.ok(res.ok); const json = await res.json(); return json.data || json; }
const shot = name => page.screenshot({ path: path.join(DIR, `${name}.png`), animations: 'disabled' });
function fixture(progress = [100, 50]) {
  const staff = ['甲', '乙'].map((name, i) => ({ id: `WR65-${i}`, name: `测试${name}`, role: 'ai_dev', employment_status: 'active', is_active: true }));
  const pm = { id: 'WR65-pm', name: '归属产品', employment_status: 'active', is_active: true };
  const task = { id: 'WR65-week', title: '第38周', time_dimension: 'week', start_date: '2026-09-14', end_date: '2026-09-20', year: 2026, quarter: 'Q3', week_number: 38, status: 'active', is_preferred: true, record_count: 2 };
  const units = staff.map(person => ({ staffId: person.id, staffName: person.name, role: person.role, taskId: task.id, startDate: task.start_date, endDate: task.end_date, workDates: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'], calendarStatus: 'official' }));
  const records = staff.map((person, i) => ({ id: `WR65-record-${i}`, staff_id: person.id, staff: person, task_id: task.id, task: { ...task }, requirement_title: `需求${i}`, version: `v4.${i}`, hours: [8, 32][i], delivery_progress: progress[i], product_managers: [pm.name], created_at: '2026-09-17T03:00:00Z', updated_at: '2026-09-17T03:00:00Z', source_type: 'engineering', is_product_manager_record: false }));
  const capacity = workHours.summarizeWorkHours(records, units), summary = delivery.summarizeDelivery(records, capacity);
  const stats = { tasks: [task], records, matchGroups: [], staff, currentStaff: staff, productManagerRecords: [], productDemandDistribution: [], demandSources: [], summary: { totalHours: 40, recordCount: 2, staffCount: 2, taskCount: 1 }, roleSummary: { ai_dev: 40, ai_quality: 0, voip: 0, embedded: 0, ai_pm: 0 }, pmDistribution: [{ ...pm, total: 40, ai_dev: 40, records: records.map(row => ({ ...row, staffName: row.staff.name, role: row.staff.role })) }], workHours: capacity, deliverySummary: summary };
  const fillTask = { ...task, workHours: workHours.summarizeWorkHours([records[0]], [units[0]]) };
  return { staff, pm, task, fillTask, units, records, capacity, summary, stats };
}
async function sameRow(scope) {
  const ids = ['expected-hours', 'delivered-hours', 'delivery-rate', 'weighted-delivery-rate'];
  const boxes = await Promise.all(ids.map(id => scope.getByTestId(id).boundingBox()));
  assert.ok(boxes.every(Boolean), 'four values must be visible');
  assert.ok(Math.max(...boxes.map(b => b.y)) - Math.min(...boxes.map(b => b.y)) < 2, `metrics wrap: ${JSON.stringify(boxes)}`);
  for (let i = 0; i < boxes.length - 1; i++) assert.ok(boxes[i].x + boxes[i].width <= boxes[i + 1].x + 1, 'metric values overlap');
  const bounds = await scope.locator('.delivery-metric').evaluateAll(nodes => nodes.map(el => ({ content: el.scrollWidth, available: el.clientWidth, text: el.innerText })));
  assert.ok(bounds.every(b => b.content <= b.available + 1), `metric content overflow ${JSON.stringify(bounds)}`);
  return boxes;
}
async function main() {
  delivery = await import(pathToFileURL(path.join(ROOT, 'frontend/src/utils/deliverySummary.js')).href);
  workHours = await import(pathToFileURL(path.join(ROOT, 'frontend/src/utils/workHours.js')).href);
  await check('WR4-E-003-API', async () => {
    const stats = await get('/stats?year=2026&quarter=Q3');
    const detail = await get('/stats/progress-details?year=2026&quarter=Q3&scope=current');
    for (const data of [stats, detail]) {
      const computed = delivery.summarizeDelivery(data.records, data.workHours);
      for (const key of ['recordedHours', 'deliveredHours', 'deliveryRate', 'weightedDeliveryRate', 'weightedDeliveredHours', 'progressCoverage']) assert.equal(data.deliverySummary[key], computed[key], `API.${key}`);
      assert.equal(computed.weightedDeliveryRate, Number((computed.weightedDeliveredHours / computed.standardHours * 100).toFixed(2)));
    }
    const pm = stats.records.filter(row => row.staff?.role === 'ai_pm');
    const pmCapacity = workHours.summarizeWorkHours(pm, stats.workHours.units.filter(unit => pm.some(row => row.staff_id === unit.staffId)));
    const pmSummary = delivery.summarizeDelivery(pm, pmCapacity);
    assert.equal(pmSummary.deliveredHours, 39); assert.equal(pmSummary.weightedDeliveryRate, 7.59);
    const roleRates = {};
    for (const [role, expected] of Object.entries({ ai_dev: 87.78, voip: 3.3, ai_quality: 68.48, embedded: 11.36 })) {
      const records = stats.records.filter(row => row.staff?.role === role);
      const capacity = workHours.summarizeWorkHours(records, stats.workHours.units.filter(unit => unit.role === role));
      const summary = delivery.summarizeDelivery(records, capacity);
      assert.equal(summary.weightedDeliveryRate, expected, role);
      assert.equal(summary.progressCoverage, 0); assert.equal(summary.requirementProgress, null);
      roleRates[role] = summary.weightedDeliveryRate;
    }
    const response = await fetch(`${API}/stats/export.xlsx?year=2026&quarter=Q3&scope=current`); assert.ok(response.ok);
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()));
    const rows = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }));
    const weighted = rows.find(row => row[0] === '加权交付率'); assert.ok(weighted); assert.equal(num(weighted[1]), stats.deliverySummary.weightedDeliveryRate);
    assert.ok(!rows.flat().includes('待补进度'), 'export still hides historical-null weighted rates');
    return { departmentWeighted: stats.deliverySummary.weightedDeliveryRate, productWeighted: pmSummary.weightedDeliveryRate, roleRates, effective: stats.deliverySummary.deliveredHours, rawNullCount: stats.records.filter(r => r.delivery_progress == null).length, sheets: workbook.SheetNames };
  });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  let f = fixture(), live = false, fillRow;
  await context.route('**/api/**', async route => {
    const req = route.request(), suffix = new URL(req.url()).pathname.replace(/^.*\/api/, '');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      const body = req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : { multipart: 'intercepted without reading file content' };
      writes.push({ path: suffix, method: req.method(), body });
      return route.fulfill({ status: 200, json: { code: 0, data: {} } });
    }
    if (live) return route.continue();
    let data;
    if (suffix === '/tasks') data = [f.task];
    else if (suffix === '/pm') data = [f.pm];
    else if (suffix === '/stats') data = f.stats;
    else if (suffix === '/stats/progress-details') data = { records: f.records, tasks: [f.task], workHours: f.capacity, deliverySummary: f.summary, scopeMeta: { taskCount: 1 } };
    else if (suffix === '/fill/WR65-fixture') data = { staff: f.staff[0], task: f.fillTask, records: [fillRow || f.records[0]], draft_records: [], demandSources: [] };
    else if (suffix === '/fill/WR65-fixture/history') data = { tasks: [] };
    if (data !== undefined) return route.fulfill({ status: 200, json: { code: 0, data } });
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  const card = () => page.locator('.dt-delivery-card').first();
  const dialog = () => page.locator('.dt-delivery-dialog');
  const openStats = async () => { await page.goto(`${APP}/stats?admin=1`, { waitUntil: 'networkidle' }); await card().waitFor(); };
  try {
    await check('WR4-E-003-GROUP', async () => {
      await openStats(); assert.equal(num(await card().getByTestId('delivery-rate').innerText()), 50); assert.equal(num(await card().getByTestId('weighted-delivery-rate').innerText()), 30);
      await sameRow(card());
      const tip = await card().getByTestId('weighted-delivery-rate').evaluate(el => el.parentElement.title);
      for (const text of ['应交付工时', '100%', '0%', '不平均个人百分比']) assert.ok(tip.includes(text), `weighted tip missing ${text}`);
      await card().locator('button').click(); await dialog().waitFor();
      await sameRow(dialog().locator('.dt-delivery-dialog-summary'));
      assert.equal(num(await dialog().getByTestId('weighted-delivery-rate').innerText()), 30);
      const people = dialog().locator('.staff-delivery-table tbody tr');
      assert.equal(await people.count(), 2);
      assert.equal(num(await people.nth(0).locator('td').nth(3).innerText()), 20);
      assert.equal(num(await people.nth(1).locator('td').nth(3).innerText()), 40);
      assert.equal(await dialog().getByRole('tab').first().innerText(), '总览');
      await shot('group-dialog');
      await dialog().locator('.el-dialog__headerbtn').click();
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: '📤 导出Excel', exact: true }).click();
      const target = path.join(DIR, 'fixture-export.xlsx'); await (await download).saveAs(target);
      const book = XLSX.readFile(target), rows = XLSX.utils.sheet_to_json(book.Sheets['交付汇总'], { header: 1 });
      assert.equal(num(rows[1][rows[0].indexOf('加权交付率')]), 30);
      f = fixture([null, 0]); await openStats(); assert.equal(num(await card().getByTestId('weighted-delivery-rate').innerText()), 10);
      assert.equal(await card().getByTestId('historical-progress-note').innerText(), '历史未填进度按100%计');
      assert.equal(await card().getByTestId('requirement-progress').count(), 0);
      assert.equal(await card().getByTestId('progress-coverage').count(), 0);
      assert.match(await card().getByTestId('historical-progress-note').getAttribute('title'), /覆盖/);
      await shot('historical-null-and-zero');
      f = fixture([100, 100]); await openStats(); assert.equal(num(await card().getByTestId('weighted-delivery-rate').innerText()), 50);
      assert.equal(num(await card().getByTestId('delivery-rate').innerText()), 50);
      assert.equal(await card().getByTestId('historical-progress-note').count(), 0);
      assert.equal(num(await card().getByTestId('requirement-progress').innerText()), 100);
      f.units = f.units.flatMap(unit => [unit, { ...unit, taskId: 'WR66-empty-week', startDate: '2026-09-21', endDate: '2026-09-27', workDates: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'] }]);
      f.capacity = workHours.summarizeWorkHours(f.records, f.units);
      f.summary = delivery.summarizeDelivery(f.records, f.capacity);
      f.stats = { ...f.stats, workHours: f.capacity, deliverySummary: f.summary, tasks: [f.task, { ...f.task, id: 'WR66-empty-week', title: '第39周', start_date: '2026-09-21', end_date: '2026-09-27', week_number: 39, record_count: 0 }] };
      await openStats(); assert.equal(num(await card().getByTestId('expected-hours').innerText()), 160);
      assert.equal(num(await card().getByTestId('weighted-delivery-rate').innerText()), 25);
      await shot('unfilled-week-keeps-capacity');
      f = fixture(); f.records = f.records.map(row => ({ ...row, version: '' }));
      f.summary = delivery.summarizeDelivery(f.records, f.capacity);
      f.stats = { ...f.stats, records: f.records, deliverySummary: f.summary };
      await openStats(); assert.equal(await card().getByTestId('weighted-delivery-rate').innerText(), '0%');
      assert.equal(await card().locator('.delivery-progress-foot').count(), 0);
      await shot('no-effective-hours-zero-rate');
      return { unequalPersonHoursRate: 30, personRates: [20, 40], historicalNullAndZero: 10, allProgressCompleteButHalfCapacity: 50, afterAddingUnfilledWeek: 25, noEffectiveHours: 0, effectiveRateUnchanged: 50, exportWeighted: 30, tip };
    });
    await check('WR4-E-003-LAYOUT', async () => {
      live = true; const evidence = [];
      for (const width of [1920, 1600, 1280, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 }); await openStats();
        for (const c of await page.locator('.dt-delivery-card').all()) await sameRow(c);
        assert.equal(await card().getByTestId('historical-progress-note').innerText(), '历史未填进度按100%计');
        assert.equal(await page.getByTestId('progress-coverage').count(), 0);
        const cardBox = await card().boundingBox(), countBox = await page.getByTestId('stats-counts-card').boundingBox();
        assert.ok(Math.abs(cardBox.height - countBox.height) < 2, 'counts card height differs');
        const dims = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert.ok(dims.width <= dims.viewport, 'page overflow');
        const chart = await page.getByTestId('department-engineering-chart').boundingBox(); if (width >= 1280) assert.ok(chart.y < 650, 'charts pushed away');
        assert.ok(await page.getByTestId('main-record-tabs').isVisible());
        await shot(`live-cards-${width}`);
        await card().locator('button').click(); await dialog().waitFor();
        await sameRow(dialog().locator('.dt-delivery-dialog-summary'));
        assert.equal(await dialog().getByTestId('historical-progress-note').innerText(), '历史未填进度按100%计');
        const spotlight = await dialog().getByTestId('analysis-spotlight').boundingBox(), box = await dialog().boundingBox();
        assert.ok(spotlight.height < box.height * .45, 'spotlight takes too much room');
        assert.ok(await dialog().getByRole('tab', { name: '总览', exact: true }).isVisible());
        await shot(`live-dialog-${width}`); evidence.push({ width, cardBox, chart, spotlight, dialogBox: box, dims });
      }
      return evidence;
    });
    await check('WR4-E-002-FILL', async () => {
      live = false; f = fixture(); await page.setViewportSize({ width: 1600, height: 900 });
      const openFill = async row => { fillRow = row; await page.goto(`${APP}/fill/WR65-fixture`, { waitUntil: 'networkidle' }); await page.getByTestId('fill-preview-weighted').waitFor(); };
      await openFill({ ...f.records[0], delivery_progress: null });
      assert.equal(num(await page.getByTestId('fill-preview-weighted').innerText()), 20);
      const save = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/fill/WR65-fixture/submit'));
      await page.getByRole('button', { name: '🚀 提交', exact: true }).click(); assert.equal((await save).postDataJSON().records[0].delivery_progress, null);
      await shot('fill-historical-null');
      await openFill({ ...f.records[0], delivery_progress: 0 }); assert.equal(num(await page.getByTestId('fill-preview-weighted').innerText()), 0);
      const count = writes.filter(w => w.path.endsWith('/submit')).length;
      await page.getByRole('button', { name: '🚀 提交', exact: true }).click();
      await page.locator('.el-message').filter({ hasText: /进度/ }).waitFor(); assert.equal(writes.filter(w => w.path.endsWith('/submit')).length, count);
      const progressSelect = page.locator('.el-table__body tbody tr').first().locator('.el-select').last(); await progressSelect.click();
      const options = page.locator('.el-select-dropdown:visible .el-select-dropdown__item');
      await options.filter({ hasText: /^100%$/ }).waitFor({ state: 'visible' });
      const available = await options.evaluateAll(els => els.filter(el => !el.classList.contains('is-disabled')).map(el => el.textContent.trim()));
      assert.ok(!available.includes('0%')); assert.ok(available.includes('10%') && available.includes('100%'));
      await options.filter({ hasText: /^100%$/ }).click();
      assert.equal(num(await page.getByTestId('fill-preview-weighted').innerText()), 20);
      await shot('fill-positive-only');
      await openFill({ ...f.records[0], id: undefined, delivery_progress: null });
      assert.match(await page.getByTestId('fill-preview-weighted').innerText(), /待补|待填/);
      return { historicalNullCapacityEstimate: 20, historicalRawNullPreserved: true, historicalZeroReads: 0, submitZeroBlocked: true, available, newBlankRemainsPending: true };
    });
    assert.deepEqual(errors, [], 'browser runtime errors');
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(DIR, 'browser-errors.json'), JSON.stringify(errors, null, 2));
  console.log(JSON.stringify({ run: RUN, evidence: DIR, results: results.map(({ id, status }) => ({ id, status })), interceptedWriteCount: writes.length }));
  process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
