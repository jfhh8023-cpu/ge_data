/* Production release v3.4.0: read-only browser acceptance; never submit real data. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const TARGET = 'https://jfzhu8023.cloud/devtracker/stats?admin=1';
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/@test/production_release_20260917/browser');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const DIR = path.join(OUT, RUN);
const METRICS = ['expected-hours', 'delivered-hours', 'delivery-rate', 'weighted-delivery-rate'];
const results = [], pageErrors = [], failedApis = [], interceptedWrites = [];
let page, step = 'initialization';

// Do not retain query strings, IDs, tokens, response bodies, error messages or stacks.
function safePath(raw) {
  let pathname;
  try { pathname = new URL(raw).pathname; } catch { return '/:redacted'; }
  const allowed = new Set(['devtracker', 'api', 'stats', 'health', 'tasks', 'staff', 'roles', 'pm', 'permissions', 'settings', 'demand-sources', 'progress-details', 'records', 'fill', 'report', 'quotes', 'duty-calendar', 'history', 'access', 'profile', 'current', 'all']);
  return '/' + pathname.split('/').filter(Boolean).map(part => allowed.has(part) ? part : ':redacted').join('/');
}
function ensure(condition, code) {
  if (!condition) { const error = new Error(code); error.acceptanceCode = code; throw error; }
}
function normalize(text) { return String(text).replace(/[\s,]/g, ''); }
function metricNumber(text) {
  if (String(text).includes('—')) return null;
  const match = normalize(text).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}
async function shot(name) {
  await page.screenshot({ path: path.join(DIR, `${name}.png`), animations: 'disabled' });
}
async function metrics(scope) {
  const values = [];
  for (const id of METRICS) values.push(normalize(await scope.getByTestId(id).innerText()));
  return values;
}
async function fourInRow(scope) {
  const boxes = await Promise.all(METRICS.map(id => scope.getByTestId(id).boundingBox()));
  ensure(boxes.every(Boolean), 'FOUR_METRICS_PRESENT');
  ensure(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y)) < 2, 'FOUR_METRICS_SAME_ROW');
  for (let i = 0; i < boxes.length - 1; i++) ensure(boxes[i].x + boxes[i].width <= boxes[i + 1].x + 1, 'FOUR_METRICS_NO_OVERLAP');
  const content = await scope.locator('.delivery-metric').evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, content: node.scrollWidth, title: !!node.title })));
  ensure(content.length === 4 && content.every(item => item.content <= item.width + 1 && item.title), 'FOUR_METRICS_FIT_AND_HAVE_TIPS');
}
async function checkNotice(scope, values) {
  const notice = scope.getByTestId('delivery-status-notice');
  ensure(await notice.count() === 1, 'STATUS_NOTICE_PRESENT');
  const [expected, delivered, effective, weighted] = values.map(metricNumber);
  let wanted;
  if (effective == null || weighted == null || expected == null) wanted = '交付率暂无法计算';
  else if (weighted > effective) wanted = '数据统计需确认';
  else if (!(delivered > 0)) wanted = '当前周期暂无有效交付工时';
  else if (weighted === effective) wanted = '周期内需求交付进度100%';
  else wanted = '部分需求需跨周期完成。';
  ensure((await notice.locator('span').first().innerText()).trim() === wanted, 'STATUS_NOTICE_MATCHES_RATES');
  ensure(!!await notice.getAttribute('title'), 'STATUS_NOTICE_TIP');
  const canView = wanted === '部分需求需跨周期完成。';
  ensure(await notice.getByTestId('view-incomplete').count() === (canView ? 1 : 0), 'STATUS_VIEW_VISIBILITY');
}
async function closeDialog(dialog) {
  await dialog.locator('.el-dialog__headerbtn').click();
  await dialog.waitFor({ state: 'hidden' });
}
async function inspectIncomplete(button, name, expectParent) {
  await button.click();
  const dialog = page.locator('.incomplete-requirements-dialog');
  await dialog.waitFor({ state: 'visible' });
  const headers = (await dialog.locator('.el-table__header-wrapper th .cell').allTextContents()).map(text => text.replace(/\s/g, ''));
  ensure(JSON.stringify(headers) === JSON.stringify(['周次', '人员', '需求', '当前进度']), 'INCOMPLETE_FOUR_COLUMNS');
  const data = await dialog.locator('.el-table__body-wrapper tbody tr').evaluateAll(rows => rows.map(row => {
    const cells = row.querySelectorAll('td');
    return { columns: cells.length, weekPresent: !!cells[0]?.textContent.trim(), personPresent: !!cells[1]?.textContent.trim(), requirementPresent: !!cells[2]?.textContent.trim(), progress: Number(cells[3]?.textContent.replace(/[^\d.]/g, '')) };
  }));
  ensure(data.every(row => row.columns === 4 && row.weekPresent && row.personPresent && row.requirementPresent && Number.isFinite(row.progress) && row.progress >= 0 && row.progress < 100), 'INCOMPLETE_ROWS_KNOWN_BELOW100');
  const tableFits = await dialog.locator('.el-table__body-wrapper .el-scrollbar__wrap').evaluate(node => node.scrollWidth <= node.clientWidth + 2);
  ensure(tableFits, 'INCOMPLETE_COLUMNS_FIT');
  const parentVisible = await page.locator('.dt-delivery-dialog').isVisible();
  ensure(parentVisible === expectParent, 'VIEW_BUTTON_PARENT_STATE');
  await shot(name);
  await closeDialog(dialog);
  ensure(await page.locator('.dt-delivery-dialog').isVisible() === expectParent, 'CLOSE_CHILD_PRESERVES_PARENT');
  return data.length;
}
async function check(id, fn) {
  let result;
  try { result = { id, status: 'PASS', evidence: await fn() }; }
  catch (error) {
    result = { id, status: 'FAIL', step, code: error.acceptanceCode || 'BROWSER_OPERATION_FAILED' };
    if (page && !page.isClosed()) await shot(`${id}-failure`).catch(() => {});
  }
  results.push(result);
  console.log(`${id}: ${result.status}${result.code ? ` (${result.code}; ${result.step})` : ''}`);
}
async function runViewport(context, width) {
  page = await context.newPage();
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
  page.setDefaultTimeout(20000);
  page.on('pageerror', () => pageErrors.push({ path: safePath(page.url()), status: 'pageerror' }));
  page.on('response', response => {
    if (response.url().includes('/api/') && response.status() >= 400) failedApis.push({ path: safePath(response.url()), status: response.status() });
  });
  page.on('requestfailed', request => {
    if (request.url().includes('/api/') && ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) failedApis.push({ path: safePath(request.url()), status: 'requestfailed' });
  });
  await check(`PROD-UI-${width}`, async () => {
    step = `load-${width}`;
    const statsLoaded = page.waitForResponse(response => {
      const url = new URL(response.url());
      return /\/api\/stats$/.test(url.pathname) && response.request().method() === 'GET';
    });
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const statsResponse = await statsLoaded;
    ensure(statsResponse.ok(), 'STATS_GET_OK');
    await page.locator('.dt-delivery-card').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.dt-delivery-card').length === 6);
    ensure((await page.locator('.dt-logo').innerText()).includes('v3.4.0'), 'UI_VERSION_3_4_0');
    const cards = page.locator('.dt-delivery-card');
    ensure(await cards.count() === 6, 'SIX_DELIVERY_CARDS');
    for (let i = 0; i < 6; i++) {
      step = `card-${width}-${i}`;
      await fourInRow(cards.nth(i));
      await checkNotice(cards.nth(i), await metrics(cards.nth(i)));
    }
    const recordTabs = page.getByTestId('main-record-tabs').locator('.el-tabs__header [role="tab"]');
    ensure(JSON.stringify((await recordTabs.allTextContents()).map(text => text.trim())) === JSON.stringify(['研发及其他人员', 'AI产品经理']), 'ORIGINAL_BOTTOM_TWO_TABS');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(`stats-${width}`);
    let incompleteRows = null;
    const directView = cards.getByTestId('view-incomplete');
    if (await directView.count()) {
      step = `card-incomplete-${width}`;
      incompleteRows = await inspectIncomplete(directView.first(), `incomplete-card-${width}`, false);
    }
    for (let i = 0; i < 6; i++) {
      step = `dialog-${width}-${i}`;
      const before = await metrics(cards.nth(i));
      const total = metricNumber(await cards.nth(i).getByTestId('recorded-hours').innerText());
      await cards.nth(i).locator('.stats-hours-heading').click();
      const dialog = page.locator('.dt-delivery-dialog');
      await dialog.waitFor({ state: 'visible' });
      const summary = dialog.locator('.dt-delivery-dialog-summary');
      await fourInRow(summary);
      ensure(JSON.stringify(await metrics(summary)) === JSON.stringify(before), 'DIALOG_MATCHES_CARD_FOUR_VALUES');
      const detailTotal = metricNumber(await summary.locator('.dt-analysis-inline-kpis button').first().innerText());
      ensure(total === detailTotal, 'DIALOG_MATCHES_CARD_TOTAL');
      await checkNotice(summary, before);
      ensure((await dialog.locator('.dt-delivery-toolbar .el-select').first().innerText()).includes('当前周期'), 'DEFAULT_CURRENT_PERIOD');
      ensure((await summary.locator('h3 span').innerText()).trim() === '当前周期', 'SUMMARY_CURRENT_PERIOD');
      ensure((await dialog.locator('.dt-restored-analysis-tabs > .el-tabs__header [role="tab"]').first().innerText()).trim() === '总览', 'OVERVIEW_FIRST_TAB');
      ensure(await dialog.getByTestId('analysis-people').isVisible(), 'PERSONNEL_AREA_RETAINED');
      if (i === 0 || i === 1) await shot(`dialog-${i === 0 ? 'department' : 'role'}-${width}`);
      if (i === 0 && await summary.getByTestId('view-incomplete').count()) {
        step = `summary-incomplete-${width}`;
        await inspectIncomplete(summary.getByTestId('view-incomplete'), `incomplete-summary-${width}`, true);
      }
      await closeDialog(dialog);
    }
    const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    ensure(dimensions.content <= dimensions.viewport + 1, 'NO_PAGE_HORIZONTAL_OVERFLOW');
    return { width, cardCount: 6, matchingDialogs: 6, currentScope: true, overviewFirst: true, originalRecordTabs: 2, incompleteChecked: incompleteRows !== null, incompleteRowCount: incompleteRows };
  });
  await page.close();
}
async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      interceptedWrites.push({ path: safePath(request.url()), status: 'blocked_non_read' });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  try {
    for (const width of [1920, 390]) await runViewport(context, width);
  } finally {
    await browser.close();
    const passed = results.length === 2 && results.every(row => row.status === 'PASS') && pageErrors.length === 0 && failedApis.length === 0;
    const summary = { run: RUN, status: passed ? 'PASS' : 'FAIL', version: 'v3.4.0', mode: 'GET/HEAD/OPTIONS only; all other methods blocked', results, pageErrors, failedApis, interceptedWrites, optionalFill: { status: 'SKIP', reason: 'No existing fill link read or created; avoid collecting link tokens.' } };
    fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify({ run: RUN, status: summary.status, resultFile: `${RUN}/results.json` }, null, 2) + '\n');
    console.log(`PROD-BROWSER: ${summary.status}; pageerrors=${pageErrors.length}; failedapi=${failedApis.length}; blocked=${interceptedWrites.length}`);
    if (!passed) process.exitCode = 1;
  }
}
main().catch(() => { console.error(`PROD-BROWSER: FAIL (${step}; runner error details omitted)`); process.exitCode = 1; });
