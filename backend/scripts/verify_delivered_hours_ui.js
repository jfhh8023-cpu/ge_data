/* Local read-only delivered-hours verification. API fixtures never persist business data. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/@test/delivered_hours_20260916');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = path.join(OUT, 'evidence', RUN);
const CASES = process.argv.find(arg => arg.startsWith('--case='))?.slice(7).split(',');
const APP = 'http://localhost:5176';
const API = 'http://127.0.0.1:3001/api';
const results = [];
let page;
fs.mkdirSync(EVIDENCE, { recursive: true });
function status(current = 'completed') {
  fs.writeFileSync(path.join(OUT, 'status.md'), `# 已交付工时验证状态\n\n运行：${RUN}\n当前：${current}\n\n${results.map(row => `${row.id}: ${row.status}`).join('\n')}\n`, 'utf8');
}
async function check(id, callback) {
  if (CASES && !CASES.includes(id)) return;
  status(id); let row;
  try { row = { run: RUN, id, status: 'PASS', evidence: await callback() }; }
  catch (error) {
    row = { run: RUN, id, status: 'FAIL', message: error.message, stack: error.stack };
    if (page && !page.isClosed()) {
      row.url = page.url(); row.body = (await page.locator('body').innerText().catch(() => '')).slice(0, 7000);
      await page.screenshot({ path: path.join(EVIDENCE, `${id}-failure.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
    }
  }
  results.push(row); fs.appendFileSync(path.join(OUT, 'results.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
  console.log(`${id}: ${row.status}${row.message ? ` ${row.message}` : ''}`); status();
}
const versioned = record => Boolean(String(record.version || '').trim() && String(record.version || '').trim() !== '-');
const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
function independentSummary(records, units) {
  const standardHours = new Set(units.flatMap(unit => (unit.workDates || []).map(date => `${unit.staffId}|${date}`))).size * 8;
  const deliveredHours = Number(records.filter(versioned).reduce((sum, record) => sum + Number(record.hours || 0), 0).toFixed(2));
  const recordedHours = Number(records.reduce((sum, record) => sum + Number(record.hours || 0), 0).toFixed(2));
  return { deliveredHours, recordedHours, unversionedHours: Number((recordedHours - deliveredHours).toFixed(2)), standardHours,
    deliveryRate: standardHours ? Number((deliveredHours * 100 / standardHours).toFixed(2)) : null,
    calendarStatus: 'official', units, formula: '已交付工时为有版本已填工时；交付率＝已交付工时÷工作日容量。', scopeNote: '独立校验：从记录与人员工作日期计算' };
}
function fixture({ hours = 32, role = 'ai_dev', history = false } = {}) {
  const task = { id: 'DELIVERY-task', title: history ? 'DELIVERY历史周' : 'DELIVERY验证周', start_date: history ? '2026-09-07' : dates[0], end_date: history ? '2026-09-13' : '2026-09-20', time_dimension: 'week', year: 2026, week_number: history ? 37 : 38, status: history ? 'closed' : 'active', is_preferred: true, record_count: 2 };
  const staff = { id: 'DELIVERY-person', name: 'DELIVERY测试人员', role, employment_status: 'active', is_active: true };
  const pm = { id: 'DELIVERY-pm', name: 'DELIVERY归属产品', is_active: true, employment_status: 'active' };
  const sources = [{ id: 'DELIVERY-source', name: '内部需求', color: '#165DFF', is_active: true, sort_order: 0 }];
  const record = (id, hours, version, delivery_progress) => ({ id, hours, version, delivery_progress, created_at: '2026-09-16T06:00:00Z', task_id: task.id, staff_id: staff.id, staff, staffName: staff.name, role, requirement_title: id, product_managers: [pm.name], source_type: role === 'ai_pm' ? 'product_manager' : 'engineering', is_product_manager_record: role === 'ai_pm', ...(role === 'ai_pm' ? { demand_sources: ['内部需求'], demand_source_weights: { 内部需求: 100 } } : {}) });
  const records = [record('DELIVERY-有版本旧进度0', hours, 'DELIVERY-v1', 0), record('DELIVERY-无版本旧进度100', 16, '', 100)];
  const unit = { staffId: staff.id, staffName: staff.name, role, taskId: task.id, workDates: history ? dates.map(date => `2026-09-${String(Number(date.slice(-2)) - 7).padStart(2, '0')}`) : dates, calendarStatus: 'official', standardHours: 40 };
  const deliverySummary = independentSummary(records, [unit]);
  const workHours = { actualHours: hours + 16, standardHours: 40, completionRate: (hours + 16) * 2.5, excessRate: Math.max((hours + 16) * 2.5 - 100, 0), workingDays: 5, calendarStatus: 'official', units: [unit] };
  Object.assign(task, { workHours, deliverySummary });
  const stats = { tasks: [task], records, staff: [staff], currentStaff: [staff], productManagerRecords: role === 'ai_pm' ? records : [], productDemandDistribution: role === 'ai_pm' ? [{ ...sources[0], total: hours + 16, product: hours + 16 }] : [], demandSources: sources, pmDistribution: [{ ...pm, total: hours + 16, [role]: hours + 16, records }], roleSummary: { ai_dev: 0, voip: 0, ai_quality: 0, embedded: 0, ai_pm: 0, [role]: hours + 16 }, summary: { totalHours: hours + 16, staffCount: 1, taskCount: 1, recordCount: 2 }, matchGroups: [], workHours, deliverySummary };
  return { task, staff, pm, records, unit, stats, deliverySummary, workHours };
}
function assertSummary(actual, expected, source) {
  assert.ok(actual, `${source} missing deliverySummary`);
  for (const key of ['deliveredHours', 'recordedHours', 'unversionedHours', 'standardHours', 'deliveryRate']) assert.equal(actual[key], expected[key], `${source}.${key}`);
}
async function getJson(suffix) {
  const response = await fetch(`${API}${suffix}`); assert.ok(response.ok, `GET ${suffix}: ${response.status}`);
  const body = await response.json(); return body.data || body;
}
function workbookInfo(workbook) {
  return workbook.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }) }));
}
function metricRows(sheets) {
  const rows = sheets.flatMap(sheet => sheet.rows).filter(row => /已交付工时|交付率|无版本工时|标准工时|应填工时/.test(String(row[0])));
  const summary = sheets.find(sheet => sheet.name === '交付汇总');
  if (summary?.rows[1]) summary.rows[0].forEach((label, index) => rows.push([label, summary.rows[1][index]]));
  return rows;
}
function assertExportMetric(rows, expected) {
  assert.ok(rows.some(row => /已交付工时/.test(String(row[0])) && Number(row[1]) === expected.deliveredHours), `Export missing delivered ${expected.deliveredHours}: ${JSON.stringify(rows)}`);
  assert.ok(rows.some(row => /^交付率/.test(String(row[0])) && parseFloat(row[1]) === expected.deliveryRate), `Export missing rate ${expected.deliveryRate}`);
}

async function main() {
  await check('DELIVERY-PURE', async () => {
    const delivery = await import(pathToFileURL(path.join(ROOT, 'frontend/src/utils/deliverySummary.js')).href);
    const workHours = await import(pathToFileURL(path.join(ROOT, 'frontend/src/utils/workHours.js')).href);
    const f = fixture();
    const capacity = workHours.summarizeWorkHours(f.records, [f.unit, { ...f.unit, taskId: 'DELIVERY-duplicate' }]);
    assert.equal(capacity.standardHours, 40, 'Same person/date denominator counted twice');
    const result = delivery.summarizeDelivery(f.records, capacity); assertSummary(result, f.deliverySummary, 'frontend');
    const over = delivery.summarizeDelivery(fixture({ hours: 48 }).records, capacity); assert.equal(over.deliveryRate, 120);
    const blank = ['', ' ', '-'].map((version, index) => ({ id: `blank-${index}`, staff_id: f.staff.id, task_id: f.task.id, version, hours: 16, delivery_progress: 100 }));
    const noVersion = delivery.summarizeDelivery(blank, capacity); assert.equal(noVersion.deliveredHours, 0); assert.equal(noVersion.unversionedHours, 48);
    const zero = delivery.summarizeDelivery(f.records, { ...capacity, standardHours: 0 }); assert.equal(zero.deliveryRate, null);
    const invalid = delivery.summarizeDelivery(f.records, { ...capacity, calendarStatus: 'invalid_period' }); assert.equal(invalid.deliveryRate, null);
    const outside = { ...f.records[0], id: 'DELIVERY-outside', staff_id: 'DELIVERY-other-person', task_id: 'DELIVERY-other-task', hours: 999 };
    const scoped = delivery.summarizeDelivery([...f.records, outside], capacity); assertSummary(scoped, f.deliverySummary, 'outside excluded');
    const emptyUnits = delivery.summarizeDelivery(f.records, { ...capacity, units: [] }); assert.equal(emptyUnits.deliveredHours, 0); assert.equal(emptyUnits.recordedHours, 0);
    const { units, ...legacyCapacity } = capacity;
    const legacy = delivery.summarizeDelivery(f.records, legacyCapacity); assertSummary(legacy, f.deliverySummary, 'legacy capacity');
    return { result, over, noVersion, zero, invalid, scoped, emptyUnits, legacy, duplicateCapacity: capacity.standardHours };
  });
  await check('DELIVERY-API', async () => {
    const stats = await getJson('/stats?year=2026&quarter=Q3');
    const expected = independentSummary(stats.records, stats.deliverySummary?.units || stats.workHours?.units || []);
    assertSummary(stats.deliverySummary, expected, 'stats');
    const detail = await getJson('/stats/progress-details?year=2026&quarter=Q3&scope=current');
    const detailExpected = independentSummary(detail.records, detail.deliverySummary?.units || detail.workHours?.units || []);
    assertSummary(detail.deliverySummary, detailExpected, 'details');
    const response = await fetch(`${API}/stats/export.xlsx?year=2026&quarter=Q3&scope=current`); assert.ok(response.ok);
    const buffer = Buffer.from(await response.arrayBuffer()); fs.writeFileSync(path.join(EVIDENCE, 'live-delivery.xlsx'), buffer);
    const workbook = XLSX.read(buffer, { type: 'buffer' }); const sheets = workbookInfo(workbook); const rows = metricRows(sheets);
    assertExportMetric(rows, detailExpected);
    const detailSheet = sheets.find(sheet => sheet.rows[0]?.includes('需求名称'));
    assert.ok(detailSheet, 'Export record sheet missing');
    assert.ok(detailSheet.rows[0].includes('已交付工时'), 'Export detail delivered column missing');
    assert.ok(!detailSheet.rows[0].some(label => /交付进度|状态/.test(String(label))), 'Obsolete progress columns remain');
    assert.equal(detailSheet.rows.length - 1, detail.records.length);
    const info = { expected, detailExpected, metricRows: rows, sheets: workbook.SheetNames, recordCount: detail.records.length };
    fs.writeFileSync(path.join(EVIDENCE, 'api-summary.json'), JSON.stringify(info, null, 2)); return info;
  });
  const browserCases = ['DELIVERY-CARDS', 'DELIVERY-DIALOG', 'DELIVERY-EDGE', 'DELIVERY-EXPORT', 'DELIVERY-MOBILE', 'DELIVERY-LIVE', 'DELIVERY-FOCUS'];
  if (!CASES || CASES.some(id => browserCases.includes(id))) await browserChecks();
  const latest = new Map();
  if (fs.existsSync(path.join(OUT, 'results.jsonl'))) for (const line of fs.readFileSync(path.join(OUT, 'results.jsonl'), 'utf8').trim().split('\n')) { const row = JSON.parse(line); latest.set(row.id, row); }
  fs.writeFileSync(path.join(OUT, 'summary.md'), `# 已交付工时验证结果\n\n最新批次：${RUN}\n\n| 用例 | 结果 | 批次 |\n| --- | --- | --- |\n${[...latest.values()].map(row => `| ${row.id} | ${row.status} | ${row.run} |`).join('\n')}\n\n执行：\`node backend/scripts/verify_delivered_hours_ui.js${CASES ? ` --case=${CASES.join(',')}` : ''}\`。所有非GET请求拦截，未写业务数据、未发通知。\n`, 'utf8');
  process.exitCode = results.some(row => row.status !== 'PASS') ? 1 : 0;
}

async function browserChecks() {
  const browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  let f = fixture(); let useLive = false; const errors = []; const failures = []; const writes = [];
  fs.writeFileSync(path.join(EVIDENCE, 'fixture.json'), JSON.stringify(f, null, 2));
  await context.route('**/api/**', async route => {
    const req = route.request(); const url = new URL(req.url()); const suffix = url.pathname.replace(/^.*\/api/, '');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes.push({ method: req.method(), path: suffix, intercepted: true }); return route.fulfill({ status: 200, json: { code: 0, data: {} } }); }
    if (useLive) return route.continue();
    let data;
    if (suffix === '/tasks') data = [f.task];
    else if (suffix === '/pm') data = [f.pm];
    else if (suffix === '/stats') data = f.stats;
    else if (suffix === '/stats/progress-details') {
      const type = url.searchParams.get('versionType'); const records = f.records.filter(record => !type || type === 'all' || versioned(record) === (type === 'versioned'));
      data = { tasks: [f.task], records, deliverySummary: independentSummary(records, [f.unit]), workHours: f.workHours, scopeMeta: { taskCount: 1 }, demandSources: f.stats.demandSources };
    }
    else if (suffix === `/stats/personal/${f.staff.id}`) data = { staff: f.staff, tasks: [{ ...f.task, records: f.records }], totalHours: f.workHours.actualHours, recordCount: 2, taskCount: 1, deliverySummary: f.deliverySummary, workHours: f.workHours };
    if (data !== undefined) return route.fulfill({ status: 200, json: { code: 0, data } });
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message)); page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }); });
  const pane = () => page.locator('.el-tab-pane:visible').first();
  const card = () => pane().locator('.dt-delivery-card').first();
  const load = async options => { f = fixture(options); await page.goto(`${APP}/stats?admin=1`, { waitUntil: 'networkidle' }); await card().waitFor(); };
  const capture = name => page.screenshot({ path: path.join(EVIDENCE, name), animations: 'disabled' });
  const checkCard = async (hours = 32, rate = 80) => {
    const text = await card().innerText(); assert.match(text, /已交付工时/); assert.match(text, /交付率/);
    assert.equal(parseFloat(await card().getByTestId('delivered-hours').innerText()), hours);
    assert.equal(parseFloat(await card().getByTestId('delivery-rate').innerText()), rate);
    assert.doesNotMatch(text, /交付综合进度|工时完成度|有效工时加权/); return text;
  };
  const openDialog = async () => { await card().click(); const dialog = page.locator('.dt-delivery-dialog'); await dialog.waitFor({ state: 'visible' }); return dialog; };
  try {
    await check('DELIVERY-CARDS', async () => {
      await load(); const department = await checkCard();
      assert.equal(await page.getByTestId('progress-explanation').count(), 0);
      assert.doesNotMatch(await page.locator('body').innerText(), /工时与交付进度怎么算/);
      const chart = await page.getByTestId('department-engineering-chart').boundingBox(); assert.ok(chart.y + 100 < 900, `Chart below first screen: ${chart.y}`);
      await capture('delivery-department-900.png');
      await page.getByRole('tab', { name: 'AI研发展示', exact: true }).click(); const engineering = await checkCard();
      await load({ role: 'ai_pm' }); await page.getByRole('tab', { name: 'AI产品展示', exact: true }).click(); const product = await checkCard(); await capture('delivery-product-900.png');
      return { department, engineering, product, chart };
    });
    await check('DELIVERY-DIALOG', async () => {
      await load(); const dialog = await openDialog();
      const text = await dialog.innerText(); assert.match(text, /已交付工时/); assert.match(text, /80(?:\.0+)?%/); assert.doesNotMatch(text, /工时与交付进度怎么算|有效工时加权|交付综合进度/);
      const firstRow = dialog.locator('.el-table__body tbody tr').first(); await firstRow.waitFor();
      const rowBox = await firstRow.boundingBox(); assert.ok(rowBox.y + rowBox.height < 900, `First dialog data row off screen: ${JSON.stringify(rowBox)}`);
      await capture('delivery-dialog-900.png');
      await dialog.locator('.el-radio-button').filter({ hasText: '无版本号（仅记录）' }).click();
      assert.equal(await dialog.getByRole('radio', { name: '无版本号（仅记录）', exact: true }).isChecked(), true);
      const noVersionText = await dialog.innerText();
      assert.match(noVersionText, /DELIVERY-无版本旧进度100/); assert.match(noVersionText, /16(?:\.0)?/); assert.doesNotMatch(await dialog.locator('.el-table__body').innerText(), /\d+(?:\.\d+)?%/);
      assert.equal(await dialog.getByTestId('delivery-rate').count(), 0, 'Unversioned dialog still shows a delivery percentage');
      await capture('delivery-dialog-unversioned.png');
      await page.keyboard.press('Escape'); return { text, rowBox, noVersionText };
    });
    await check('DELIVERY-EDGE', async () => {
      await load({ hours: 48 }); const over = await checkCard(48, 120); await capture('delivery-over120.png');
      await load({ history: true }); const history = await checkCard(32, 80); await capture('delivery-history80.png'); return { over, history };
    });
    await check('DELIVERY-EXPORT', async () => {
      await load(); const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '📤 导出Excel', exact: true }).click()]);
      const target = path.join(EVIDENCE, 'fixture-delivered-hours.xlsx'); await download.saveAs(target);
      const workbook = XLSX.readFile(target); const sheets = workbookInfo(workbook); const rows = metricRows(sheets); assertExportMetric(rows, f.deliverySummary);
      assert.ok(sheets.some(sheet => sheet.rows.some(row => row.some(cell => String(cell).includes('DELIVERY-无版本旧进度100')))), 'Unversioned record missing from frontend export');
      return { sheets: workbook.SheetNames, metricRows: rows };
    });
    await check('DELIVERY-MOBILE', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await load(); const text = await checkCard();
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth })); assert.equal(dimensions.width, dimensions.viewport);
      await page.screenshot({ path: path.join(EVIDENCE, 'delivery-mobile-full.png'), fullPage: true, animations: 'disabled' });
      const dialog = await openDialog(); const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390.5);
      const dialogDimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth })); assert.equal(dialogDimensions.width, dialogDimensions.viewport);
      await capture('delivery-dialog-mobile.png'); assert.deepEqual(errors, []); assert.deepEqual(failures, []); return { text, dimensions, dialogDimensions, box, errors, failures, interceptedWrites: writes };
    });
    await check('DELIVERY-LIVE', async () => {
      useLive = true; await page.setViewportSize({ width: 1600, height: 900 }); await load();
      const stats = await getJson('/stats?year=2026&quarter=Q3');
      const productRecords = stats.records.filter(record => record.source_type === 'product_manager' || record.is_product_manager_record || record.staff?.role === 'ai_pm');
      const productUnits = stats.deliverySummary.units.filter(unit => unit.role === 'ai_pm');
      const expected = independentSummary(productRecords, productUnits);
      const expectedNames = [...new Set(productRecords.map(record => record.staff?.name))].sort();
      assert.equal(expectedNames.length, 5, 'Live dataset does not contain five product staff');
      const productChart = page.getByTestId('department-product-chart');
      const names = (await productChart.locator('.dt-product-manager-label').allInnerTexts()).sort();
      assert.deepEqual(names, expectedNames);
      const productCard = pane().locator('.dt-delivery-card').filter({ hasText: 'AI产品经理' });
      const readNumber = async locator => parseFloat((await locator.innerText()).replaceAll(',', ''));
      assert.equal(await readNumber(productCard.getByTestId('delivered-hours')), expected.deliveredHours);
      assert.equal(await readNumber(productCard.getByTestId('delivery-rate')), expected.deliveryRate);
      const geometry = { viewport: { width: 1600, height: 900 }, card: await productCard.boundingBox(), leftChart: await page.getByTestId('department-engineering-chart').boundingBox(), rightChart: await productChart.boundingBox() };
      assert.ok(geometry.leftChart.y + 100 < 900 && geometry.rightChart.y + 100 < 900, 'Live charts below first screen');
      const pageDimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert.equal(pageDimensions.width, pageDimensions.viewport);
      await capture('delivery-live-q3-1600x900.png');
      await productCard.click(); const dialog = page.locator('.dt-delivery-dialog'); await dialog.waitFor({ state: 'visible' });
      assert.match(await dialog.locator('.el-dialog__header').innerText(), /工时明细/);
      assert.equal(await readNumber(dialog.getByTestId('delivered-hours')), expected.deliveredHours);
      assert.equal(await readNumber(dialog.getByTestId('delivery-rate')), expected.deliveryRate);
      const rows = dialog.locator('.el-table__body tbody tr');
      assert.equal(await rows.count(), productRecords.filter(versioned).length);
      await capture('delivery-live-product-dialog-1600x900.png');
      geometry.dialog = await dialog.boundingBox(); geometry.summary = await dialog.locator('.dt-delivery-dialog-summary').boundingBox(); geometry.header = await dialog.locator('.el-table__header-wrapper').boundingBox(); geometry.firstRow = await rows.first().boundingBox();
      assert.ok(geometry.firstRow.y + geometry.firstRow.height < 900, 'Live dialog first row not visible');
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      const chartScroll = await productChart.locator('.dt-product-manager-chart-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; return { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, scrollLeft: el.scrollLeft }; });
      assert.ok(chartScroll.scrollWidth > chartScroll.clientWidth && chartScroll.scrollLeft > 0, 'Live five-person chart did not scroll locally');
      await productChart.screenshot({ path: path.join(EVIDENCE, 'delivery-live-product-chart-scroll-right.png'), animations: 'disabled' });
      assert.deepEqual(errors, []); assert.deepEqual(failures, []);
      return { names, productRows: productRecords.length, versionedRows: productRecords.filter(versioned).length, summary: { deliveredHours: expected.deliveredHours, unversionedHours: expected.unversionedHours, standardHours: expected.standardHours, deliveryRate: expected.deliveryRate }, geometry, chartScroll, pageDimensions, errors, failures, interceptedWrites: writes };
    });
    await check('DELIVERY-FOCUS', async () => {
      useLive = true; await page.setViewportSize({ width: 1600, height: 900 }); await load();
      const stats = await getJson('/stats?year=2026&quarter=Q3');
      const person = stats.staff.filter(person => person.role === 'ai_dev').sort((a, b) => stats.records.filter(record => record.staff_id === b.id).length - stats.records.filter(record => record.staff_id === a.id).length)[0];
      assert.ok(person, 'No real engineering person to inspect');
      const personal = await getJson(`/stats/personal/${person.id}?year=2026&quarter=Q3`);
      await page.getByRole('tab', { name: '研发聚焦', exact: true }).click();
      await pane().locator('.dt-staff-chip').filter({ hasText: person.name }).click();
      const header = pane().locator('.dt-personal-header'); await header.waitFor();
      assert.equal(parseFloat((await header.getByTestId('delivered-hours').innerText()).replaceAll(',', '')), personal.deliverySummary.deliveredHours);
      assert.equal(parseFloat(await header.getByTestId('delivery-rate').innerText()), personal.deliverySummary.deliveryRate);
      const text = await header.innerText(); assert.doesNotMatch(text, /总工时|记录数|周期数|交付综合进度|工时完成度/);
      await capture('delivery-live-personal-focus-1600x900.png');
      const geometry = { header: await header.boundingBox(), firstTask: await pane().locator('.dt-accordion-item').first().boundingBox() };
      assert.deepEqual(errors, []); assert.deepEqual(failures, []);
      return { person: person.name, text, summary: { deliveredHours: personal.deliverySummary.deliveredHours, deliveryRate: personal.deliverySummary.deliveryRate }, geometry, errors, failures, interceptedWrites: writes };
    });
  } finally { fs.writeFileSync(path.join(EVIDENCE, 'runtime.json'), JSON.stringify({ errors, failures, writes }, null, 2)); await browser.close(); }
}
main().catch(error => { console.error(error.stack || error); status(error.message); process.exitCode = 1; });
