/* REQ-060: read-only live API checks and browser-owned fixtures. No business writes. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/@test/work_hours_completion_20260916');
const APP = process.env.APP_URL || 'http://localhost:5176';
const API = process.env.API_URL || 'http://127.0.0.1:3001/api';
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const CASE_FILTER = process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length);
const EVIDENCE = path.join(OUT, 'evidence', RUN);
const results = [];
let util;
let progress;
let activePage;
fs.mkdirSync(EVIDENCE, { recursive: true });

function status(current = 'completed') {
  const counts = results.reduce((r, x) => ({ ...r, [x.status]: (r[x.status] || 0) + 1 }), {});
  fs.writeFileSync(path.join(OUT, 'status.md'), `# REQ-060 测试状态\n\n运行：${RUN}\n\n当前：${current}\n\n计数：${JSON.stringify(counts)}\n\n命令：node backend/scripts/verify_work_hours_ui.js ${CASE_FILTER ? `--case=${CASE_FILTER}` : process.argv.includes('--pure') ? '--pure' : ''}\n\n结果：results.jsonl（追加记录）；证据：evidence/${RUN}/\n`, 'utf8');
}
async function run(id, callback) {
  if (CASE_FILTER && !CASE_FILTER.split(',').includes(id)) return;
  status(id);
  const started = Date.now();
  let result;
  try { result = { run: RUN, id, status: 'PASS', evidence: await callback() }; }
  catch (error) {
    result = { run: RUN, id, status: 'FAIL', error: error.message, stack: error.stack };
    if (activePage && !activePage.isClosed()) {
      result.url = activePage.url();
      result.body = (await activePage.locator('body').innerText().catch(() => '')).slice(0, 4000);
      await activePage.screenshot({ path: path.join(EVIDENCE, `${id}-failure.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
      console.log(JSON.stringify({ url: result.url, body: result.body }));
    }
  }
  result.durationMs = Date.now() - started;
  results.push(result);
  fs.appendFileSync(path.join(OUT, 'results.jsonl'), `${JSON.stringify(result)}\n`, 'utf8');
  console.log(`${id}: ${result.status}${result.error ? ` ${result.error}` : ''}`);
  status();
}
const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
const staff = { id: 'REQ060-staff', name: 'REQ060测试人员', role: 'ai_dev', employment_status: 'active', is_active: true };
const unit = { staffId: staff.id, staffName: staff.name, role: staff.role, taskId: 'REQ060-task', workDates: dates, calendarStatus: 'official' };
const metric = (hours, units = [unit]) => ({ ...util.summarizeWorkHours([{ hours }], units), scopeNote: 'REQ060 自有测试数据；同人同日去重。' });

async function pureChecks() {
  await run('PURE-01', () => {
    const outputs = [32, 40, 48].map(hours => metric(hours));
    assert.deepEqual(outputs.map(x => x.completionRate), [80, 100, 120]);
    assert.deepEqual(outputs.map(x => x.excessRate), [0, 0, 20]);
    return outputs.map(({ actualHours, standardHours, completionRate, excessRate }) => ({ actualHours, standardHours, completionRate, excessRate }));
  });
  await run('PURE-02', () => {
    const value = util.summarizeWorkHours([{ hours: 24 }, { hours: 40 }], [{ ...unit, workDates: dates.slice(1) }, { ...unit, taskId: 'REQ060-next', workDates: dates.map(d => d.replace(/-(\d\d)$/, (_, n) => `-${Number(n) + 7}`)) }]);
    assert.equal(value.standardHours, 72); assert.equal(value.completionRate, 88.89);
    return { actualHours: value.actualHours, standardHours: value.standardHours, completionRate: value.completionRate };
  });
  await run('PURE-03', () => {
    const duplicate = metric(40, [unit, { ...unit, taskId: 'REQ060-duplicate' }]);
    const missing = metric(40, [unit, { ...unit, staffId: 'REQ060-unsubmitted' }]);
    assert.equal(duplicate.standardHours, 40); assert.equal(missing.standardHours, 80); assert.equal(missing.completionRate, 50);
    return { deduplicatedCapacity: duplicate.standardHours, withUnsubmittedStaff: missing.standardHours, completionRate: missing.completionRate };
  });
  await run('PURE-04', () => {
    const zero = metric(8, [{ ...unit, workDates: [] }]);
    assert.equal(zero.actualHours, 8); assert.equal(zero.completionRate, null); assert.equal(zero.excessRate, null);
    assert.equal(metric(40, [{ ...unit, calendarStatus: 'weekday_fallback' }]).calendarStatus, 'weekday_fallback');
    return { zero, fallback: true };
  });
  await run('PURE-05', () => {
    const rows = [{ hours: 1, delivery_progress: 100 }, { hours: 9, delivery_progress: null }, { hours: 10, delivery_progress: 0 }];
    assert.equal(progress.weightedProgress(rows), 9.09);
    const invalid = [null, undefined, '', ' ', true, false, -1, 101, Infinity, NaN];
    for (const value of invalid) assert.equal(progress.normalizeProgress(value), null);
    assert.equal(progress.weightedProgress([...rows, { hours: -10, delivery_progress: 100 }, { hours: Infinity, delivery_progress: 100 }]), 9.09);
    return { rows, expected: 9.09, invalidExcluded: invalid.length };
  });
  await run('PURE-06', () => {
    const rows = util.workHoursExportRows(metric(48));
    const exportMap = Object.fromEntries(rows);
    assert.equal(exportMap['工时完成度'], '120%'); assert.equal(exportMap['超额比例'], '20%');
    assert.equal(exportMap['应填工时/h'], 40); assert.match(exportMap['工时完成度公式'], /32小时=80%/);
    assert.equal(Object.fromEntries(util.workHoursExportRows(metric(8, [])))['工时完成度'], '不适用');
    return { rows };
  });
}

async function jsonGet(suffix) {
  const response = await fetch(`${API}${suffix}`);
  assert.ok(response.ok, `${suffix} HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data || payload;
}
async function apiChecks() {
  await run('API-01', async () => {
    const data = await jsonGet('/stats?year=2026&quarter=Q3');
    assert.ok(data.workHours && Array.isArray(data.workHours.units), 'stats.workHours.units missing; restart backend after implementation');
    const recomputed = util.summarizeWorkHours(data.records, data.workHours.units);
    for (const key of ['actualHours', 'standardHours', 'completionRate', 'excessRate']) assert.equal(data.workHours[key], recomputed[key], `stats ${key}`);
    const detail = await jsonGet('/stats/progress-details?year=2026&quarter=Q3&scope=current');
    assert.ok(detail.workHours, 'progress-details.workHours missing');
    const detailComputed = util.summarizeWorkHours(detail.records, detail.workHours.units);
    for (const key of ['actualHours', 'standardHours', 'completionRate']) assert.equal(detail.workHours[key], detailComputed[key], `details ${key}`);
    const response = await fetch(`${API}/stats/export.xlsx?year=2026&quarter=Q3&scope=current`);
    assert.ok(response.ok, `Excel HTTP ${response.status}`);
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    const sheets = workbook.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }) }));
    const exportedRecords = XLSX.utils.sheet_to_json(workbook.Sheets['进度明细']);
    assert.equal(exportedRecords.length, detail.records.length, 'Excel detail count mismatch');
    assert.ok(exportedRecords.every(row => ['未填写', '未开始', '部分完成', '已完成'].includes(row.状态)), 'Excel progress status missing/invalid');
    const summaryRows = sheets.flatMap(s => s.rows).filter(row => /工时完成度|超额比例|应填工时|工时公式|日历/.test(String(row[0])));
    assert.ok(summaryRows.some(row => /工时公式/.test(String(row[0]))), 'Excel 工时公式 missing');
    assert.ok(summaryRows.some(row => /应填工时/.test(String(row[0])) && row[1] === detail.workHours.standardHours), 'Excel capacity mismatch');
    const evidence = { stats: { ...recomputed, units: undefined }, details: { ...detailComputed, units: undefined }, excelSheets: workbook.SheetNames, excelSummaryRows: summaryRows, exportedRecordCount: exportedRecords.length, exportedProgressStatuses: [...new Set(exportedRecords.map(row => row.状态))] };
    fs.writeFileSync(path.join(EVIDENCE, 'api-export-summary.json'), JSON.stringify(evidence, null, 2));
    return evidence;
  });
}

function fixture() {
  const task = { id: unit.taskId, title: 'REQ060工时计算验证周', time_dimension: 'week', start_date: '2026-09-14', end_date: '2026-09-20', year: 2026, week_number: 38, status: 'active', is_preferred: true, record_count: 4, workHours: metric(48) };
  const record = (id, hours, delivery_progress, title, version = 'REQ060-v1') => ({ id, task_id: task.id, staff_id: staff.id, staff, hours, delivery_progress, requirement_title: title, version, product_managers: ['REQ060产品'], is_product_manager_record: false, source_type: 'engineering', is_active: true });
  const records = [record('REQ060-r1', 1, 100, 'REQ060同组需求'), record('REQ060-r2', 9, null, 'REQ060同组需求'), record('REQ060-r3', 10, 0, 'REQ060其他需求'), record('REQ060-r4', 28, null, 'REQ060无进度补充', '')];
  const fillRecord = record('REQ060-fill', 48, 50, 'REQ060表单预览');
  const historyTask = { ...task, id: 'REQ060-history', title: 'REQ060历史周', status: 'closed', start_date: '2026-09-07', end_date: '2026-09-13', workHours: metric(20), records: [{ ...fillRecord, hours: 20, delivery_progress: 100 }], totalHours: 20 };
  return {
    task, records, fillRecord, historyTask,
    stats: { tasks: [task], records, matchGroups: [], staff: [staff], currentStaff: [staff], productManagerRecords: [], productDemandDistribution: [], demandSources: [], summary: { totalHours: 48, recordCount: 4, staffCount: 1, taskCount: 1 }, roleSummary: { ai_dev: 48, ai_quality: 0, voip: 0, embedded: 0, ai_pm: 0 }, pmDistribution: [{ id: 'REQ060-pm', name: 'REQ060产品', total: 48, ai_dev: 48, records: records.map(r => ({ ...r, staffName: staff.name, role: 'ai_dev' })) }], workHours: metric(48) }
  };
}

async function browserChecks() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  const errors = []; const writes = []; const failedResponses = [];
  const f = fixture();
  let zeroCapacity = false;
  await context.route('**/api/**', async route => {
    const req = route.request(); const url = new URL(req.url()); const suffix = url.pathname.replace(/^.*\/api/, '');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      writes.push({ method: req.method(), path: suffix, intercepted: true });
      return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, json: { success: true, data: {} } });
    }
    let payload;
    if (suffix === '/tasks') payload = [f.task];
    else if (suffix === `/tasks/${f.task.id}`) payload = { task: f.task, records: f.records, links: [], matchGroups: [], workHours: f.task.workHours };
    else if (suffix === `/tasks/${f.task.id}/activity`) payload = { editing: [], submitted: [] };
    else if (suffix === '/records') payload = f.records;
    else if (suffix === '/pm') payload = [{ id: 'REQ060-pm', name: 'REQ060产品', is_active: true, employment_status: 'active' }];
    else if (suffix === '/stats') payload = { success: true, data: f.stats };
    else if (suffix === '/stats/progress-details') payload = { success: true, data: { records: f.records, tasks: [f.task], weightedProgress: 9.09, effectiveHours: 11, missingProgressCount: 2, scopeMeta: { taskCount: 1 }, workHours: f.stats.workHours } };
    else if (suffix === `/stats/personal/${staff.id}`) payload = { success: true, data: { staff, tasks: [{ ...f.task, records: f.records }], totalHours: 48, recordCount: 4, taskCount: 1, workHours: f.stats.workHours } };
    else if (suffix === '/stats/pm/REQ060-pm') payload = { success: true, data: { pm: { id: 'REQ060-pm', name: 'REQ060产品' }, tasks: [{ ...f.task, records: f.records }], totalHours: 48, recordCount: 4, taskCount: 1, workHours: f.stats.workHours } };
    else if (suffix === '/fill/REQ060-fixture') payload = { staff, task: { ...f.task, workHours: zeroCapacity ? metric(48, [{ ...unit, workDates: [], calendarStatus: 'weekday_fallback' }]) : metric(48) }, records: [f.fillRecord], draft_records: [], demandSources: [] };
    else if (suffix === '/fill/REQ060-fixture/history') payload = { tasks: [f.historyTask] };
    if (payload !== undefined) return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, json: suffix.startsWith('/stats') ? payload : { success: true, data: payload } });
    return route.continue();
  });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => { errors.push({ type: 'pageerror', message: error.message }); console.log(`PAGEERROR ${error.message}`); });
  page.on('console', message => { if (message.type() === 'error') { errors.push({ type: 'console', message: message.text() }); console.log(`CONSOLE ${message.text()}`); } });
  page.on('response', response => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  try {
    await run('UI-01', async () => {
      await page.goto(`${APP}/stats?admin=1`, { waitUntil: 'networkidle' });
      const card = page.getByTestId('hours-completion').first();
      await card.waitFor({ state: 'visible' });
      const text = await card.innerText();
      assert.match(text, /120%/); assert.match(text, /超额\s*20%/); assert.match(text, /应填\s*40h/);
      const explanation = page.getByTestId('progress-explanation').first();
      await explanation.locator('summary').focus(); await page.keyboard.press('Enter');
      assert.ok(await explanation.evaluate(el => el.open), 'Keyboard Enter did not expand explanation');
      const explanationText = await explanation.innerText();
      for (const word of ['工时完成度', '交付进度', '未填人员', '有效工时', '48小时=120%']) assert.ok(explanationText.includes(word), `explanation missing ${word}`);
      await page.screenshot({ path: path.join(EVIDENCE, 'stats-desktop.png'), fullPage: true, animations: 'disabled' });
      return { text, keyboardExpanded: true };
    });
    await run('UI-02', async () => {
      await page.locator('.dt-stat-card-clickable').first().click();
      const dialog = page.locator('.dt-analysis-dialog'); await dialog.waitFor({ state: 'visible' });
      const versionCard = dialog.locator('.dt-analysis-kpi').filter({ hasText: '普通版本' }).first();
      const text = await versionCard.innerText(); assert.match(text, /9\.09%/); assert.doesNotMatch(text, /50\.00%/);
      assert.ok(await dialog.getByTestId('hours-completion').count() > 0, 'analysis hours metric missing');
      assert.ok(await dialog.getByTestId('progress-explanation').count() > 0, 'analysis explanation missing');
      await page.screenshot({ path: path.join(EVIDENCE, 'stats-analysis-desktop.png'), fullPage: true, animations: 'disabled' });
      await page.keyboard.press('Escape');
      return { versionCard: text, originalRows: f.records.slice(0, 3).map(({ hours, delivery_progress }) => ({ hours, delivery_progress })) };
    });
    await run('UI-03', async () => {
      await page.goto(`${APP}/fill/REQ060-fixture`, { waitUntil: 'networkidle' });
      const card = page.locator('.fill-hours-summary').getByTestId('hours-completion');
      await card.waitFor({ state: 'visible' }); assert.match(await card.innerText(), /当前表单预览/);
      const input = page.locator('.el-input-number input').first();
      const values = [];
      for (const [hours, rate] of [[32, 80], [40, 100], [48, 120]]) {
        await input.fill(String(hours)); await input.press('Tab');
        await page.waitForFunction(expected => document.querySelector('.fill-hours-summary [data-testid="hours-completion-rate"]')?.textContent === `${expected}%`, rate);
        values.push({ hours, text: await card.innerText() });
      }
      assert.match(values[2].text, /超额\s*20%/);
      assert.match(await page.locator('.fill-history-hours').innerText(), /50%/);
      await page.screenshot({ path: path.join(EVIDENCE, 'fill-desktop.png'), fullPage: true, animations: 'disabled' });
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '📤 导出', exact: true }).click()]);
      const file = path.join(EVIDENCE, 'fixture-fill-history.xlsx'); await download.saveAs(file);
      const workbook = XLSX.readFile(file);
      assert.ok(workbook.SheetNames.includes('周期工时完成度')); assert.ok(workbook.SheetNames.includes('指标说明'));
      return { values, historyCompletion: 50, exportSheets: workbook.SheetNames };
    });
    await run('UI-04', async () => {
      zeroCapacity = true; await page.reload({ waitUntil: 'networkidle' });
      const card = page.locator('.fill-hours-summary').getByTestId('hours-completion');
      const text = await card.innerText(); assert.match(text, /不适用/); assert.match(text, /待核实/); assert.doesNotMatch(text, /Infinity|NaN/);
      zeroCapacity = false;
      return { text };
    });
    await run('UI-06', async () => {
      await page.goto(`${APP}/stats?admin=1`, { waitUntil: 'networkidle' });
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '📤 导出Excel', exact: true }).click()]);
      const file = path.join(EVIDENCE, 'fixture-stats.xlsx'); await download.saveAs(file);
      const workbook = XLSX.readFile(file);
      assert.ok(workbook.SheetNames.includes('工时与交付口径'), 'stats export metric sheet');
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets['工时与交付口径'], { header: 1 });
      assert.equal(rows.find(row => row[0] === '工时完成度')[1], '120%');
      const tabs = [];
      for (const [tab, target, expected] of [['AI研发展示', '', '120%'], ['AI产品展示', '', '不适用'], ['研发聚焦', '.dt-staff-chip', '120%'], ['产品经理聚焦', '.dt-pm-chip', '120%']]) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        if (target) await page.locator(`${target}:visible`).first().click();
        const card = page.locator('[data-testid="hours-completion"]:visible').first();
        await card.waitFor({ state: 'visible' });
        const text = await card.innerText(); assert.ok(text.includes(expected), `${tab}: ${text}`);
        tabs.push({ tab, expected, text });
      }
      return { exportSheets: workbook.SheetNames, tabs };
    });
    await run('UI-07', async () => {
      await page.goto(`${APP}/tasks/${f.task.id}?admin=1`, { waitUntil: 'networkidle' });
      const card = page.getByTestId('hours-completion').first(); await card.waitFor({ state: 'visible' });
      assert.equal(await page.locator('h1').innerText(), f.task.title);
      const text = await card.innerText(); assert.match(text, /120%/); assert.match(text, /超额\s*20%/);
      assert.ok(await page.getByTestId('progress-explanation').isVisible());
      await page.screenshot({ path: path.join(EVIDENCE, 'task-detail-desktop.png'), fullPage: true, animations: 'disabled' });
      return { text };
    });
    await run('UI-05', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const layout = [];
      for (const [name, route] of [['fill', '/fill/REQ060-fixture'], ['stats', '/stats?admin=1']]) {
        await page.goto(`${APP}${route}`, { waitUntil: 'networkidle' });
        await page.getByTestId('hours-completion').first().waitFor({ state: 'visible' });
        const card = page.getByTestId('hours-completion').first();
        const metrics = await card.evaluate(el => {
          const rate = el.querySelector('[data-testid="hours-completion-rate"]'); const r = rate.getBoundingClientRect();
          return { text: el.textContent.trim(), rateWidth: rate.clientWidth, scrollWidth: rate.scrollWidth, rateLeft: r.left, rateRight: r.right, viewport: innerWidth };
        });
        assert.match(metrics.text, /120%/); assert.ok(metrics.rateRight <= metrics.viewport && metrics.rateLeft >= 0, `${name} 120% outside viewport`);
        assert.ok(metrics.scrollWidth <= metrics.rateWidth + 1, `${name} 120% clipped`);
        const documentWidth = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(documentWidth.width <= documentWidth.viewport, `${name} document overflow ${JSON.stringify(documentWidth)}`);
        const buttons = name === 'fill' ? await page.locator('.fill-submit-actions button').evaluateAll(items => items.map(item => {
          const r = item.getBoundingClientRect(); const parent = item.closest('.fill-submit-bar').getBoundingClientRect();
          return { text: item.textContent.trim(), left: r.left, right: r.right, cardLeft: parent.left, cardRight: parent.right };
        })) : [];
        assert.ok(buttons.every(button => button.left >= button.cardLeft && button.right <= button.cardRight), 'fill submit buttons outside card');
        const explanation = page.getByTestId('progress-explanation').first(); await explanation.locator('summary').click();
        assert.ok(await explanation.evaluate(el => el.open));
        await page.screenshot({ path: path.join(EVIDENCE, `${name}-mobile.png`), fullPage: true, animations: 'disabled' }); layout.push({ name, ...metrics, documentWidth, buttons });
      }
      assert.deepEqual(errors, [], 'browser console/page errors'); assert.deepEqual(failedResponses, [], 'HTTP failures');
      return { viewport: '390x844', layout, errors, failedResponses, interceptedWrites: writes };
    });
  } finally {
    fs.writeFileSync(path.join(EVIDENCE, 'browser-runtime.json'), JSON.stringify({ errors, failedResponses, interceptedWrites: writes }, null, 2));
    await browser.close();
  }
}

async function main() {
  util = await import(pathToFileURL(path.join(ROOT, 'frontend/src/utils/workHours.js')).href);
  progress = await import(pathToFileURL(path.join(ROOT, 'frontend/src/utils/progress.js')).href);
  await pureChecks();
  if (!process.argv.includes('--pure')) { await apiChecks(); await browserChecks(); }
  const latest = new Map();
  for (const line of fs.readFileSync(path.join(OUT, 'results.jsonl'), 'utf8').trim().split('\n')) {
    if (!line.trim()) continue;
    const result = JSON.parse(line); latest.set(result.id, result);
  }
  const latestTable = `\n## 各用例最近结果（保留之前完整批次证据）\n\n| 用例 | 最近结果 | 批次 |\n| --- | --- | --- |\n${[...latest.values()].sort((a, b) => a.id.localeCompare(b.id)).map(r => `| ${r.id} | ${r.status} | ${r.run} |`).join('\n')}\n`;
  const summary = `# REQ-060 独立验证报告\n\n运行：${RUN}\n\n模式：${CASE_FILTER ? `定向复测 ${CASE_FILTER}；其他用例最近完整批次见 results.jsonl` : process.argv.includes('--pure') ? '仅纯计算；API/UI等待服务就绪，尚未执行' : '纯计算 + 本地只读 API + 自有浏览器 fixture'}\n\n| 用例 | 结果 | 说明 |\n| --- | --- | --- |\n${results.map(r => `| ${r.id} | ${r.status} | ${(r.error || '见 results.jsonl').replace(/\|/g, '/')} |`).join('\n')}\n\n证据目录：evidence/${RUN}/。真实业务数据未修改；浏览器所有非 GET API 请求均拦截，未发送通知。\n\n复现命令：\`node backend/scripts/verify_work_hours_ui.js${CASE_FILTER ? ` --case=${CASE_FILTER}` : process.argv.includes('--pure') ? ' --pure' : ''}\`。后端工作日/日历边界测试以对应后端测试报告为准。\n`;
  fs.writeFileSync(path.join(OUT, 'summary.md'), summary + latestTable, 'utf8');
  status(); process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; status(`runner failed: ${error.message}`); });
