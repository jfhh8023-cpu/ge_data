/* Bounded regression for restored analysis dialog. Browser-owned fixtures and read-only GET only. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/@test/delivered_hours_20260916');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = path.join(OUT, 'evidence', RUN);
const FILTER = process.argv.find(arg => arg.startsWith('--case='))?.slice(7).split(',');
const results = [];
let page;
fs.mkdirSync(EVIDENCE, { recursive: true });
async function check(id, callback) {
  if (FILTER && !FILTER.includes(id)) return;
  fs.writeFileSync(path.join(OUT, 'analysis-restored-status.md'), `# 分析弹窗恢复验证\n\n运行：${RUN}\n当前：${id}\n`);
  let row;
  try { row = { run: RUN, id, status: 'PASS', evidence: await callback() }; }
  catch (error) {
    row = { run: RUN, id, status: 'FAIL', message: error.message, stack: error.stack, url: page.url(), body: (await page.locator('body').innerText()).slice(0, 7500) };
    await page.screenshot({ path: path.join(EVIDENCE, `${id}-failure.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
  }
  results.push(row); fs.appendFileSync(path.join(OUT, 'analysis-restored-results.jsonl'), JSON.stringify(row) + '\n');
  console.log(`${id}: ${row.status}${row.message ? ` ${row.message}` : ''}`);
}
const roles = [
  ['ai_dev', 'AI开发工程师', 'AI开发', '#165DFF'], ['voip', 'VOIP工程师', 'VOIP', '#00B42A'], ['ai_quality', 'AI质量工程师', 'AI质量', '#FF7D00'],
  ['embedded', '嵌入式工程师', '嵌入式', '#14B8A6'], ['ai_pm', 'AI产品经理', 'AI产品', '#722ED1'], ['rest_audit', 'REST动态岗位', 'REST审计', '#123456']
].map(([key, name, short_name, color], index) => ({ key, name, short_name, color, sort_order: index * 10, is_active: true }));
function fixture() {
  const people = [{ id: 'REST-dev', name: 'REST研发甲', role: 'ai_dev' }, { id: 'REST-audit', name: 'REST审计乙', role: 'rest_audit' }].map(person => ({ ...person, is_active: true, employment_status: 'active' }));
  const task = { id: 'REST-task', title: 'REST当前验证周', year: 2026, week_number: 38, time_dimension: 'week', start_date: '2026-09-14', end_date: '2026-09-20', status: 'active', is_preferred: true };
  const history = { ...task, id: 'REST-history', title: 'REST历史验证周', year: 2025, week_number: 2, start_date: '2025-01-06', end_date: '2025-01-12', status: 'closed', is_preferred: false };
  const pm = { id: 'REST-pm', name: 'REST归属经理', is_active: true, employment_status: 'active' };
  const record = (id, hours, version, staff, created_at, taskId = task.id, progress = 0) => ({ id, hours, version, staff, staff_id: staff.id, role: staff.role, staffName: staff.name, task_id: taskId, created_at, requirement_title: id, delivery_progress: progress, product_managers: [pm.name], source_type: 'engineering', is_product_manager_record: false });
  const records = Array.from({ length: 24 }, (_, i) => record(`REST-zero-${String(i).padStart(2, '0')}监控`, 0, 'REST-v1', people[0], new Date(Date.UTC(2026, 8, 14, 10, i)).toISOString()));
  records.push(record('REST-new32呼叫优化', 32, 'REST-v1', people[0], '2026-09-16T12:00:00Z'));
  records.push(record('REST-noVersion16旧进度100', 16, '', people[0], '2026-09-16T13:00:00Z', task.id, 100));
  records.push(record('REST-custom48审计', 48, 'REST-v2', people[1], '2026-09-16T11:00:00Z'));
  const old = record('REST-history40部署', 40, 'REST-v1', people[0], '2025-01-07T10:00:00Z', history.id);
  const unit = (person, task) => ({ staffId: person.id, staffName: person.name, role: person.role, taskId: task.id, calendarStatus: 'official', standardHours: 40, workDates: Array.from({ length: 5 }, (_, i) => { const date = new Date(task.start_date); date.setUTCDate(date.getUTCDate() + i); return date.toISOString().slice(0, 10); }) });
  const units = people.map(person => unit(person, task));
  const allUnits = [...units, unit(people[0], history)];
  function capacity(selectedUnits) { const days = new Set(selectedUnits.flatMap(unit => unit.workDates.map(date => `${unit.staffId}|${date}`))); return { standardHours: days.size * 8, workingDays: days.size, units: selectedUnits, calendarStatus: 'official' }; }
  function summary(rows, cap) { const deliveredHours = rows.filter(r => r.version).reduce((sum, r) => sum + r.hours, 0), recordedHours = rows.reduce((sum, r) => sum + r.hours, 0); return { ...cap, deliveredHours, recordedHours, unversionedHours: recordedHours - deliveredHours, deliveryRate: deliveredHours / cap.standardHours * 100 }; }
  const workHours = capacity(units); const allWorkHours = capacity(allUnits);
  const stats = { tasks: [task], staff: people, currentStaff: people, records, roleDefinitions: roles, workHours, deliverySummary: summary(records, workHours), summary: { totalHours: 96, recordCount: records.length, staffCount: 2, taskCount: 1 }, roleSummary: { ai_dev: 48, rest_audit: 48 }, pmDistribution: [{ ...pm, total: 96, ai_dev: 48, rest_audit: 48, records }], productManagerRecords: [], productDemandDistribution: [], demandSources: [], matchGroups: [] };
  return { task, history, people, pm, records, old, stats, allWorkHours, summary, capacity };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  const f = fixture(); const errors = [], failures = [], writes = [], requests = [], exports = [];
  let live = false; let nextExport;
  fs.writeFileSync(path.join(EVIDENCE, 'analysis-fixture.json'), JSON.stringify(f, null, 2));
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), suffix = url.pathname.replace(/^.*\/api/, '');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push({ method: request.method(), suffix }); return route.fulfill({ status: 200, json: { code: 0, data: {} } }); }
    requests.push({ suffix, params: Object.fromEntries(url.searchParams) });
    if (live) return route.continue();
    if (suffix === '/stats/export.xlsx') {
      const params = Object.fromEntries(url.searchParams); exports.push(params); nextExport?.(params); nextExport = null;
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['QA隔离导出：仅验证请求筛选参数']]), '参数验证');
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename=qa-analysis.xlsx' }, body: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) });
    }
    let data;
    if (suffix === '/roles') data = roles;
    else if (suffix === '/tasks') data = [f.task];
    else if (suffix === '/pm') data = [f.pm];
    else if (suffix === '/stats') data = f.stats;
    else if (suffix === '/stats/progress-details') {
      const role = url.searchParams.get('role'), all = url.searchParams.get('scope') === 'all';
      const records = (all ? [...f.records, f.old] : f.records).filter(record => !role || record.staff.role === role);
      const units = (all ? f.allWorkHours.units : f.stats.workHours.units).filter(unit => !role || unit.role === role);
      const workHours = f.capacity(units);
      data = { tasks: all ? [f.task, f.history] : [f.task], records, workHours, deliverySummary: f.summary(records, workHours), roleDefinitions: roles, demandSources: [], scopeMeta: { taskCount: all ? 2 : 1 } };
    }
    if (data !== undefined) return route.fulfill({ status: 200, json: { code: 0, data } });
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message)); page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }); });
  const dialog = () => page.locator('.dt-delivery-dialog');
  const active = () => dialog().locator('.el-tab-pane:visible').first();
  const tab = name => dialog().getByRole('tab', { name, exact: true }).click();
  const rowsText = () => active().locator('.el-table__body tbody tr').allInnerTexts();
  const screen = name => page.screenshot({ path: path.join(EVIDENCE, name), animations: 'disabled' });
  const load = async (role = '') => { await page.goto('http://localhost:5176/stats?admin=1', { waitUntil: 'networkidle' }); const cards = page.locator('.el-tab-pane:visible .dt-delivery-card'); await (role ? cards.filter({ hasText: role }) : cards.first()).click(); await dialog().waitFor(); };
  const exportQuery = async (root = dialog()) => { const pending = new Promise(resolve => { nextExport = resolve; }); await root.getByRole('button', { name: '导出 Excel', exact: true }).click(); return Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error('Export request not observed')), 8000))]); };
  try {
    await check('ANALYSIS-TABS', async () => {
      await load(); const expected = ['工时记录', '总览', '全部追踪和进度', '普通版本（有版本号）', '无版本号版本', 'AI产品经理', '人员', '周期', '版本', '需求', '关键词', '数据质量', '需求进度'];
      assert.deepEqual(await dialog().getByRole('tab').allInnerTexts(), expected);
      assert.equal(await dialog().getByTestId('progress-explanation').count(), 0); assert.doesNotMatch(await dialog().innerText(), /公式步骤|工时与交付进度怎么算/);
      await screen('analysis-restored-default-desktop.png');
      const firstRow = await active().locator('.el-table__body tbody tr').first().boundingBox(); assert.ok(firstRow.y + firstRow.height < 900);
      const observed = [];
      for (const name of expected.filter(name => name !== '全部追踪和进度')) {
        await tab(name); const text = await active().innerText();
        if (name === '总览') { assert.match(text, /核心解读/); assert.match(text, /重点维度/); }
        else assert.ok(await active().locator('.el-table__body tbody tr').count() > 0, `${name} has no rows`);
        if (['AI产品经理', '周期', '版本', '需求'].includes(name)) assert.ok((await active().locator('thead').innerText()).includes('REST审计'), `${name} missing dynamic role column`);
        if (name === '版本') { assert.match(await active().locator('thead').innerText(), /周/); assert.match(text, /W38/); await screen('analysis-restored-version-week.png'); }
        if (name === '无版本号版本') { assert.doesNotMatch(text, /\d+(?:\.\d+)?%/); assert.equal(await dialog().getByTestId('delivery-rate').count(), 0); }
        observed.push({ tab: name, rows: await active().locator('.el-table__body tbody tr').count() });
      }
      await Promise.all([page.waitForResponse(response => response.url().includes('/stats/progress-details'), { timeout: 8000 }), tab('全部追踪和进度')]);
      assert.match(await dialog().locator('.dt-analysis-current-scope').innerText(), /全部可见历史/);
      assert.ok(requests.some(request => request.suffix === '/stats/progress-details' && request.params.scope === 'all'));
      return { tabs: expected, observed, firstRow };
    });
    await check('ANALYSIS-PAGINATION', async () => {
      await load(); const first = await rowsText(); assert.equal(first.length, 20); assert.match(first[0], /REST-new32呼叫优化/); assert.match(first[1], /REST-custom48审计/); assert.match(first[2], /REST-zero-23监控/);
      await active().locator('.btn-next').click(); assert.equal((await rowsText()).length, 6);
      await tab('普通版本（有版本号）'); assert.equal(await active().locator('.el-pager .is-active').innerText(), '1'); assert.equal((await rowsText()).length, 20);
      await tab('工时记录'); assert.equal(await active().locator('.el-pager .is-active').innerText(), '2');
      await active().locator('.el-pagination__sizes .el-select').click();
      const options = await page.getByRole('option').allInnerTexts(); assert.deepEqual(options.map(option => parseInt(option)), [10, 20, 30, 50, 100, 200, 300]);
      await page.getByRole('option', { name: '10条/页', exact: true }).click(); assert.equal((await rowsText()).length, 10); assert.equal(await active().locator('.el-pager .is-active').innerText(), '1');
      await tab('普通版本（有版本号）'); assert.equal((await rowsText()).length, 20);
      return { firstOrder: first.slice(0, 3), independentPage: true, options, independentPageSize: true };
    });
    await check('ANALYSIS-SEMANTICS', async () => {
      await load(); const rows = active().locator('.el-table__body tbody tr');
      const dev = rows.filter({ hasText: 'REST-new32呼叫优化' }), audit = rows.filter({ hasText: 'REST-custom48审计' });
      assert.match(await dev.innerText(), /80%/); assert.match(await audit.innerText(), /120%/);
      assert.equal(await audit.locator('.is-complete').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(232, 247, 238)'); assert.equal(await dev.locator('.is-complete').count(), 0);
      await tab('需求进度'); const progress = active().locator('.el-table__body tbody tr').filter({ hasText: 'REST-custom48审计' }); assert.match(await progress.innerText(), /120%.*已完成/); assert.equal(await progress.locator('.is-complete').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(232, 247, 238)');
      await progress.locator('.el-table__expand-icon').click(); assert.match(await active().locator('.el-table__expanded-cell').innerText(), /120%/);
      await screen('analysis-restored-progress-green.png');
      await tab('工时记录'); await active().locator('.el-radio-button').filter({ hasText: '无版本号（仅记录）' }).click();
      assert.match(await active().innerText(), /REST-noVersion16旧进度100/); assert.doesNotMatch(await active().innerText(), /\d+(?:\.\d+)?%/); assert.equal(await dialog().getByTestId('delivery-rate').count(), 0);
      await screen('analysis-restored-unversioned.png');
      await dialog().locator('.dt-analysis-inline-kpis button').filter({ hasText: '总工时' }).click();
      const child = page.getByRole('dialog').filter({ hasText: '部门需求进度明细' }); await child.waitFor(); assert.ok(await child.locator('.el-table__body tbody tr').count() > 0); await page.keyboard.press('Escape'); await child.waitFor({ state: 'hidden' });
      await dialog().locator('.dt-analysis-role-pills button').filter({ hasText: 'REST审计' }).click();
      const roleChild = page.getByRole('dialog').filter({ hasText: 'REST动态岗位需求进度明细' }); await roleChild.waitFor(); assert.equal(await roleChild.locator('.el-table__body tbody tr').count(), 1); assert.match(await roleChild.innerText(), /REST审计乙/); await page.keyboard.press('Escape');
      return { devRate: 80, auditRate: 120, green: 'rgb(232, 247, 238)', noVersionRecordOnly: true, totalAndDynamicRoleDrilldown: true };
    });
    await check('ANALYSIS-EXPORT', async () => {
      await load('AI开发工程师'); const currentVersioned = await exportQuery(); assert.equal(currentVersioned.scope, 'current'); assert.equal(currentVersioned.versionType, 'versioned'); assert.equal(currentVersioned.role, 'ai_dev');
      await tab('无版本号版本'); const currentNoVersion = await exportQuery(); assert.equal(currentNoVersion.scope, 'current'); assert.equal(currentNoVersion.versionType, 'no_version');
      await tab('全部追踪和进度'); const all = await exportQuery(); assert.equal(all.scope, 'all'); assert.equal(all.versionType, ''); assert.equal(all.role, 'ai_dev');
      await tab('普通版本（有版本号）'); const allVersioned = await exportQuery(); assert.equal(allVersioned.scope, 'all'); assert.equal(allVersioned.versionType, 'versioned');
      await tab('无版本号版本'); const allNoVersion = await exportQuery(); assert.equal(allNoVersion.scope, 'all'); assert.equal(allNoVersion.versionType, 'no_version');
      await dialog().locator('.dt-analysis-role-pills button').first().click(); const child = page.getByRole('dialog').filter({ hasText: 'AI开发工程师需求进度明细' }); await child.waitFor(); const childExport = await exportQuery(child); assert.equal(childExport.role, 'ai_dev'); assert.equal(childExport.scope, 'all');
      return { currentVersioned, currentNoVersion, all, allVersioned, allNoVersion, childExport, note: '浏览器隔离下载仅验证GET筛选参数，未将mock文件当作业务导出内容验证。' };
    });
    await check('ANALYSIS-MOBILE', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await load();
      await screen('analysis-restored-mobile.png');
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert.equal(dimensions.width, dimensions.viewport);
      const box = await dialog().boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390.5);
      const row = await active().locator('.el-table__body tbody tr').first().boundingBox(); assert.ok(row.y < 844);
      assert.deepEqual(errors, []); assert.deepEqual(failures, []); return { dimensions, box, firstRow: row, errors, failures, writes };
    });
    await check('ANALYSIS-LIVE', async () => {
      live = true; await page.setViewportSize({ width: 1600, height: 900 }); await load();
      assert.equal(await dialog().getByRole('tab').count(), 13); await screen('analysis-restored-live-desktop.png');
      const firstRow = await active().locator('.el-table__body tbody tr').first().boundingBox(); assert.ok(firstRow.y + firstRow.height < 900);
      const text = await dialog().locator('.dt-delivery-dialog-summary').innerText(); assert.match(text.replaceAll(',', ''), /1673/); assert.match(text, /38.44%/);
      await tab('版本'); assert.match(await active().locator('thead').innerText(), /周/); await screen('analysis-restored-live-version.png');
      return { summary: text, firstRow, tabCount: 13 };
    });
  } finally { fs.writeFileSync(path.join(EVIDENCE, 'analysis-runtime.json'), JSON.stringify({ errors, failures, writes, requests, exports }, null, 2)); await browser.close(); }
  const latest = new Map(); for (const line of fs.readFileSync(path.join(OUT, 'analysis-restored-results.jsonl'), 'utf8').trim().split('\n')) { const row = JSON.parse(line); latest.set(row.id, row); }
  fs.writeFileSync(path.join(OUT, 'analysis-restored-status.md'), `# 分析弹窗恢复验证\n\n最新批次：${RUN}\n\n${[...latest.values()].map(row => `${row.id}: ${row.status} (${row.run})`).join('\n')}\n`);
  process.exitCode = results.some(row => row.status !== 'PASS') ? 1 : 0;
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
