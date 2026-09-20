/* Local read-only verification. Synthetic fixtures stay in the browser process. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/@test/stats_record_order_20260916');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = path.join(OUT, 'evidence', RUN);
const FILTER = process.argv.find(value => value.startsWith('--case='))?.slice(7).split(',');
const APP = 'http://localhost:5176';
const API = 'http://127.0.0.1:3001/api';
const results = [];
let page;
fs.mkdirSync(EVIDENCE, { recursive: true });

function report(current = 'completed') {
  fs.writeFileSync(path.join(OUT, 'status.md'), `# 记录排序与完成绿色验证\n\n运行：${RUN}\n当前：${current}\n\n${results.map(row => `${row.id}: ${row.status}`).join('\n')}\n\n命令：node backend/scripts/verify_stats_record_order_ui.js${FILTER ? ` --case=${FILTER.join(',')}` : ''}\n`, 'utf8');
}
async function check(id, fn) {
  if (FILTER && !FILTER.includes(id)) return;
  report(id);
  let value;
  try { value = { run: RUN, id, status: 'PASS', evidence: await fn() }; }
  catch (error) {
    value = { run: RUN, id, status: 'FAIL', message: error.message, stack: error.stack };
    if (page && !page.isClosed()) {
      value.url = page.url(); value.body = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
      await page.screenshot({ path: path.join(EVIDENCE, `${id}-failure.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
    }
  }
  results.push(value); fs.appendFileSync(path.join(OUT, 'results.jsonl'), `${JSON.stringify(value)}\n`, 'utf8');
  console.log(`${id}: ${value.status}${value.message ? ` ${value.message}` : ''}`); report();
}
const time = row => Number.isFinite(Date.parse(row.created_at)) ? Date.parse(row.created_at) : 0;
const sorted = rows => [...rows].sort((a, b) => time(b) - time(a));
function ordered(rows, name) {
  assert.ok(rows.every(row => Number.isFinite(Date.parse(row.created_at))), `${name}: created_at missing/invalid in response`);
  for (let i = 1; i < rows.length; i++) assert.ok(time(rows[i - 1]) >= time(rows[i]), `${name}: created_at not DESC at ${i}`);
  return { name, count: rows.length, firstCreatedAt: rows[0]?.created_at, lastCreatedAt: rows.at(-1)?.created_at };
}
async function get(suffix) {
  const response = await fetch(`${API}${suffix}`); assert.ok(response.ok, `${suffix} HTTP ${response.status}`);
  const value = await response.json(); return value.data || value;
}
async function apiChecks() {
  await check('SORT-API', async () => {
    const data = await get('/stats?year=2026&quarter=Q3'); const evidence = [];
    evidence.push(ordered(data.records, 'stats.records'), ordered(data.productManagerRecords, 'stats.productManagerRecords'));
    for (const row of data.pmDistribution) evidence.push(ordered(row.records, 'stats.pmDistribution.records'));
    const diversity = rows => new Set(rows.map(row => row.created_at).filter(Boolean)).size;
    const person = [...data.staff].sort((a, b) => diversity(data.records.filter(row => row.staff_id === b.id)) - diversity(data.records.filter(row => row.staff_id === a.id)))[0];
    assert.ok(person, 'No staff with local read-only records');
    const personal = await get(`/stats/personal/${person.id}?year=2026&quarter=Q3`);
    for (const task of personal.tasks) evidence.push(ordered(task.records, 'personal.tasks.records'));
    const pm = [...data.pmDistribution].filter(p => p.id && p.records.length).sort((a, b) => diversity(b.records) - diversity(a.records))[0];
    assert.ok(pm, 'No PM with local read-only records');
    const focus = await get(`/stats/pm/${pm.id}?year=2026&quarter=Q3`);
    for (const task of focus.tasks) evidence.push(ordered(task.records, 'pm.tasks.records'));
    const detail = await get('/stats/progress-details?year=2026&quarter=Q3&scope=current');
    evidence.push(ordered(detail.records, 'progress-details.records'));
    const response = await fetch(`${API}/stats/export.xlsx?year=2026&quarter=Q3&scope=current`); assert.ok(response.ok);
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['进度明细']);
    assert.equal(rows.length, detail.records.length);
    const titleKey = Object.keys(rows[0] || {}).find(k => /需求/.test(k));
    assert.ok(titleKey, 'Excel requirement column missing');
    assert.deepEqual(rows.map(r => r[titleKey]), detail.records.map(r => r.requirement_title), 'Excel/API record order mismatch');
    const result = { arrays: evidence, exportRows: rows.length, exportSheets: workbook.SheetNames };
    fs.writeFileSync(path.join(EVIDENCE, 'api-order.json'), JSON.stringify(result, null, 2)); return result;
  });
}

function makeFixture() {
  const task = { id: 'ORDER-task', title: 'ORDER排序测试周', year: 2026, week_number: 38, start_date: '2026-09-14', end_date: '2026-09-20', time_dimension: 'week', status: 'active', is_preferred: true };
  const staff = [{ id: 'ORDER-dev', name: 'ORDER研发', role: 'ai_dev' }, { id: 'ORDER-voip', name: 'ORDER已完成人员', role: 'voip' }, { id: 'ORDER-product', name: 'ORDER产品', role: 'ai_pm' }].map(s => ({ ...s, is_active: true, employment_status: 'active' }));
  const pm = { id: 'ORDER-pm', name: 'ORDER归属产品', is_active: true, employment_status: 'active' };
  const row = (id, title, hours, delivery_progress, created_at, person = staff[0]) => ({ id, requirement_title: title, hours, delivery_progress, created_at, updated_at: created_at, task_id: task.id, staff_id: person.id, staff: person, staffName: person.name, role: person.role, version: 'ORDER-v1', product_managers: [pm.name], is_product_manager_record: person.role === 'ai_pm', source_type: person.role === 'ai_pm' ? 'product_manager' : 'engineering', demand_sources: person.role === 'ai_pm' ? ['ORDER需求方'] : [] });
  const engineering = [
    row('ORDER-old', 'ORDER-OLD', 90, 100, '2026-09-14T08:00:00Z'),
    row('ORDER-new', 'ORDER-NEW', 1, 0, '2026-09-16T08:00:00Z'),
    row('ORDER-mid', 'ORDER-MID', 10, 50, '2026-09-15T08:00:00Z'),
    row('ORDER-group-old', 'ORDER-GROUP', 2, 100, '2026-09-14T09:00:00Z'),
    row('ORDER-group-new', 'ORDER-GROUP', 1, 0, '2026-09-16T09:00:00Z'),
    row('ORDER-done', 'ORDER-DONE', 5, 100, '2026-09-13T08:00:00Z', staff[1])
  ];
  const product = [row('ORDER-p-old', 'ORDER-P-OLD', 10, 100, '2026-09-14T10:00:00Z', staff[2]), row('ORDER-p-new', 'ORDER-P-NEW', 1, 0, '2026-09-16T10:00:00Z', staff[2]), row('ORDER-p-mid', 'ORDER-P-MID', 2, 50, '2026-09-15T10:00:00Z', staff[2])];
  const records = [...engineering, ...product];
  const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
  const workHours = { actualHours: 122, standardHours: 120, completionRate: 101.67, excessRate: 1.67, workingDays: 15, calendarStatus: 'official', units: staff.map(s => ({ staffId: s.id, staffName: s.name, role: s.role, taskId: task.id, workDates: dates, calendarStatus: 'official' })) };
  const pmDistribution = [{ ...pm, total: 109, ai_dev: 104, voip: 5, records: engineering }];
  const stats = { tasks: [{ ...task, record_count: records.length }], records, staff, currentStaff: staff, roleSummary: { ai_dev: 104, voip: 5, ai_quality: 0, embedded: 0, ai_pm: 13 }, summary: { totalHours: 122, recordCount: records.length, taskCount: 1, staffCount: 3 }, pmDistribution, productManagerRecords: product, productDemandDistribution: [], demandSources: [{ id: 'ORDER-source', name: 'ORDER需求方', color: '#165dff', is_active: true }], matchGroups: [], workHours };
  return { task, staff, pm, records, engineering, product, stats, workHours };
}
const titles = ['ORDER-OLD', 'ORDER-NEW', 'ORDER-MID', 'ORDER-GROUP', 'ORDER-DONE', 'ORDER-P-OLD', 'ORDER-P-NEW', 'ORDER-P-MID'];
async function visibleOrder(root) {
  return (await root.locator('.el-table__body tbody tr').allInnerTexts()).map(text => titles.find(title => text.includes(title))).filter(Boolean);
}
function isGreen(color) {
  const values = String(color).match(/[\d.]+/g)?.map(Number) || [];
  return values.length >= 3 && values[1] > values[0] && values[1] > values[2] && (values.length < 4 || values[3] > 0);
}
async function completionStyles(root) {
  return root.locator('.dt-progress-completed').evaluateAll(items => items.map(el => ({ text: el.textContent.trim(), background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })));
}
async function screenshot(name) { await page.screenshot({ path: path.join(EVIDENCE, name), fullPage: true, animations: 'disabled' }); }

async function browserChecks() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const f = makeFixture(); const errors = []; const writes = []; const failedResponses = [];
  fs.writeFileSync(path.join(EVIDENCE, 'fixture.json'), JSON.stringify(f, null, 2));
  await context.route('**/api/**', async route => {
    const request = route.request(); const suffix = new URL(request.url()).pathname.replace(/^.*\/api/, '');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push({ path: suffix, method: request.method() }); return route.fulfill({ status: 200, json: { code: 0, data: {} } }); }
    let data;
    if (suffix === '/tasks') data = [f.task];
    else if (suffix === '/pm') data = [f.pm];
    else if (suffix === '/stats') data = f.stats;
    else if (suffix === '/stats/progress-details') data = { records: sorted(f.records), tasks: [f.task], weightedProgress: 92.62, effectiveHours: 122, missingProgressCount: 0, scopeMeta: { taskCount: 1 }, workHours: f.workHours };
    else if (suffix.startsWith('/stats/personal/')) {
      const person = f.staff.find(s => suffix.endsWith(s.id)); const records = f.records.filter(r => r.staff_id === person?.id);
      data = { staff: person, tasks: [{ ...f.task, records }], records, totalHours: records.reduce((s, r) => s + r.hours, 0), recordCount: records.length, taskCount: 1, workHours: f.workHours };
    } else if (suffix === `/stats/pm/${f.pm.id}`) data = { pm: f.pm, tasks: [{ ...f.task, records: f.engineering }], totalHours: 109, recordCount: f.engineering.length, taskCount: 1, workHours: f.workHours };
    if (data !== undefined) return route.fulfill({ status: 200, json: { code: 0, data } });
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text() }); });
  page.on('response', response => { if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() }); });
  const load = async () => { await page.goto(`${APP}/stats?admin=1`, { waitUntil: 'networkidle' }); await page.locator('.dt-stat-card-clickable').first().waitFor({ state: 'visible' }); };
  const openDevProgress = async () => {
    await load(); await page.locator('.dt-stat-card-clickable').filter({ hasText: 'AI开发工程师总工时' }).first().click();
    const analysis = page.locator('.dt-analysis-dialog'); await analysis.waitFor({ state: 'visible' });
    await analysis.locator('[title="点击查看需求进度明细"]').first().click();
    const dialog = page.locator('.el-dialog:visible').last(); await dialog.waitFor({ state: 'visible' }); return dialog;
  };
  try {
    await check('SORT-UI', async () => {
      await load(); const observed = [];
      const expectedEngineering = sorted(f.engineering).map(r => r.requirement_title);
      assert.deepEqual(await visibleOrder(page.locator('.el-tab-pane:visible').first()), expectedEngineering, 'department record order');
      observed.push({ page: 'department', titles: expectedEngineering });
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '📤 导出Excel', exact: true }).click()]);
      const file = path.join(EVIDENCE, 'fixture-stats-order.xlsx'); await download.saveAs(file);
      const workbook = XLSX.readFile(file);
      const exported = XLSX.utils.sheet_to_json(workbook.Sheets['AI产品经理工时明细']).filter(row => row.需求名称).map(row => row.需求名称);
      assert.deepEqual(exported, expectedEngineering, 'Frontend export preserves default created_at order');
      observed.push({ page: 'frontend export', titles: exported });
      for (const [label, descending] of [['工时降序 ↓', true], ['工时升序 ↑', false]]) {
        await page.getByText(label, { exact: true }).first().click();
        await page.waitForFunction(isDesc => {
          const pane = [...document.querySelectorAll('.el-tab-pane')].find(el => el.offsetParent !== null);
          const hours = [...pane.querySelectorAll('.el-table__body .hours-val')].map(el => Number(el.textContent));
          return hours.length > 0 && hours.every((value, index) => !index || (isDesc ? hours[index - 1] >= value : hours[index - 1] <= value));
        }, descending);
        const titlesOnPage = await visibleOrder(page.locator('.el-tab-pane:visible').first());
        const [modeDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '📤 导出Excel', exact: true }).click()]);
        const modeFile = path.join(EVIDENCE, `fixture-stats-${descending ? 'hours-desc' : 'hours-asc'}.xlsx`); await modeDownload.saveAs(modeFile);
        const modeWorkbook = XLSX.readFile(modeFile);
        const modeRows = XLSX.utils.sheet_to_json(modeWorkbook.Sheets['AI产品经理工时明细']).filter(row => row.需求名称);
        const modeTitles = modeRows.map(row => row.需求名称);
        // Adjacent equal requirements intentionally share a merged title cell on screen.
        const compactTitles = values => values.filter((value, index) => !index || value !== values[index - 1]);
        assert.deepEqual(compactTitles(modeTitles), compactTitles(titlesOnPage), `${label} export/page title order mismatch`);
        const pageHours = (await page.locator('.el-tab-pane:visible').first().locator('.el-table__body .hours-val').allInnerTexts()).map(Number);
        assert.deepEqual(modeRows.map(row => Number(row['工时(小时)'])), pageHours, `${label} export/page record hours mismatch`);
        observed.push({ page: label, titles: titlesOnPage, exportMatches: true });
      }
      await page.getByText('创建时间倒序', { exact: true }).first().click();
      assert.deepEqual(await visibleOrder(page.locator('.el-tab-pane:visible').first()), expectedEngineering, 'restore newest-created order');
      for (const name of ['AI研发展示', 'AI产品展示']) {
        await page.getByRole('tab', { name, exact: true }).click();
        const actual = await visibleOrder(page.locator('.el-tab-pane:visible').first());
        const expected = sorted(name === 'AI产品展示' ? f.product : f.engineering).map(r => r.requirement_title);
        assert.deepEqual(actual, expected, name); observed.push({ page: name, titles: actual });
      }
      await page.getByRole('tab', { name: '研发聚焦', exact: true }).click(); await page.locator('.dt-staff-chip:visible').filter({ hasText: 'ORDER研发' }).click();
      await page.locator('.dt-personal-header:visible').waitFor();
      const personal = await visibleOrder(page.locator('.el-tab-pane:visible').first());
      assert.deepEqual(personal, sorted(f.engineering.filter(r => r.staff_id === 'ORDER-dev')).map(r => r.requirement_title), 'personal newest first');
      observed.push({ page: 'personal', titles: personal });
      await page.getByRole('tab', { name: '产品经理聚焦', exact: true }).click(); await page.locator('.dt-pm-chip:visible').first().click();
      await page.locator('.dt-pm-header:visible').waitFor();
      const focus = await visibleOrder(page.locator('.el-tab-pane:visible').first());
      assert.deepEqual(focus, expectedEngineering, 'PM focus newest first'); observed.push({ page: 'PM focus', titles: focus });
      await screenshot('stats-order-focus-desktop.png'); return observed;
    });
    await check('SORT-CARD', async () => {
      const dialog = await openDevProgress();
      const order = await visibleOrder(dialog); assert.deepEqual(order, ['ORDER-GROUP', 'ORDER-NEW', 'ORDER-MID', 'ORDER-OLD']);
      const group = dialog.locator('.el-table__body tr').filter({ hasText: 'ORDER-GROUP' }); assert.match(await group.innerText(), /66\.67%/);
      await screenshot('card-progress-order-desktop.png'); return { order, groupRate: '66.67%', groupNewestCreatedAt: '2026-09-16T09:00:00Z' };
    });
    await check('GREEN-UI', async () => {
      const dialog = await openDevProgress();
      const completed = await completionStyles(dialog); assert.ok(completed.length > 0, 'completed badge missing');
      assert.ok(completed.every(x => isGreen(x.background)), `completed background not green ${JSON.stringify(completed)}`);
      const nonCompleted = await dialog.locator('.dt-progress-value').evaluateAll(items => items.map(el => ({ text: el.textContent.trim(), background: getComputedStyle(el).backgroundColor })));
      assert.ok(nonCompleted.length >= 3); assert.ok(nonCompleted.every(x => !isGreen(x.background)), 'unfinished badges share completed green');
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      const completedCard = page.locator('.dt-stat-card').filter({ hasText: 'VOIP工程师总工时' }).first().locator('.dt-stat-card-progress-value');
      const cardColor = await completedCard.evaluate(el => ({ text: el.textContent.trim(), background: getComputedStyle(el).backgroundColor }));
      assert.match(cardColor.text, /100/); assert.ok(isGreen(cardColor.background), `completed summary card not green ${JSON.stringify(cardColor)}`);
      await page.locator('.dt-stat-card-clickable').first().click();
      const analysis = page.locator('.dt-analysis-dialog'); await analysis.getByRole('tab', { name: '全部追踪和进度', exact: true }).click();
      await analysis.locator('.el-tab-pane:visible .el-table__body tr').first().waitFor();
      const tracking = await completionStyles(analysis.locator('.el-tab-pane:visible'));
      assert.ok(tracking.length > 0 && tracking.every(x => isGreen(x.background)), 'completed tracking status not green');
      await screenshot('completed-status-green-desktop.png'); return { completed, nonCompleted, cardColor, tracking };
    });
    await check('MOBILE-UI', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); const dialog = await openDevProgress();
      assert.deepEqual(await visibleOrder(dialog), ['ORDER-GROUP', 'ORDER-NEW', 'ORDER-MID', 'ORDER-OLD']);
      const completed = await completionStyles(dialog); assert.ok(completed.length && completed.every(x => isGreen(x.background)));
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
      assert.equal(dimensions.documentWidth, dimensions.viewport);
      const pagination = await dialog.locator('.el-pagination').evaluate(el => {
        const parent = el.closest('.el-dialog').getBoundingClientRect();
        return { parentLeft: parent.left, parentRight: parent.right, children: [...el.children].map(child => {
          const rect = child.getBoundingClientRect(); return { text: child.textContent.trim(), left: rect.left, right: rect.right };
        }) };
      });
      assert.ok(pagination.children.every(child => child.left >= pagination.parentLeft && child.right <= pagination.parentRight), `pagination clips ${JSON.stringify(pagination)}`);
      await screenshot('card-progress-order-mobile.png');
      const completedBadge = dialog.locator('.dt-progress-completed').first();
      await completedBadge.scrollIntoViewIfNeeded();
      const badgeBounds = await completedBadge.boundingBox();
      assert.ok(badgeBounds.x >= 0 && badgeBounds.x + badgeBounds.width <= 390, 'completed badge could not scroll into mobile viewport');
      await page.screenshot({ path: path.join(EVIDENCE, 'card-progress-green-mobile.png'), fullPage: false, animations: 'disabled' });
      assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []); return { dimensions, pagination, completed, errors, failedResponses, interceptedWrites: writes };
    });
  } finally {
    fs.writeFileSync(path.join(EVIDENCE, 'runtime.json'), JSON.stringify({ errors, failedResponses, interceptedWrites: writes }, null, 2)); await browser.close();
  }
}
async function main() {
  await apiChecks(); if (!FILTER || FILTER.some(id => id !== 'SORT-API')) await browserChecks();
  const latest = new Map(); for (const line of fs.readFileSync(path.join(OUT, 'results.jsonl'), 'utf8').trim().split('\n')) { const row = JSON.parse(line); latest.set(row.id, row); }
  const rows = [...latest.values()];
  fs.writeFileSync(path.join(OUT, 'summary.md'), `# 记录排序与完成绿色验证结果\n\n日期：2026-09-16。最新运行：${RUN}。\n\n| 用例 | 最近结果 | 批次 |\n| --- | --- | --- |\n${rows.map(row => `| ${row.id} | ${row.status} | ${row.run} |`).join('\n')}\n\nfixture/API摘要/截图位于 evidence/<批次>/；原始结果见 results.jsonl。只读本地验证，不改业务数据库，不发通知。\n\n命令：\`node backend/scripts/verify_stats_record_order_ui.js${FILTER ? ` --case=${FILTER.join(',')}` : ''}\`。\n`, 'utf8');
  process.exitCode = results.some(row => row.status !== 'PASS') ? 1 : 0;
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; report(error.message); });
