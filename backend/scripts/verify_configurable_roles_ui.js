const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5176';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(
  REPO_ROOT,
  'docs',
  '@development',
  'configurable_research_roles_20260807',
  'evidence'
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function chartLabel(name) {
  return String(name || '').length > 5 ? `${String(name).slice(0, 5)}...` : String(name || '');
}

async function waitForPage(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(500);
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => {
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    window.__devtrackerCanvasTexts = [];
    CanvasRenderingContext2D.prototype.fillText = function patchedFillText(text, ...args) {
      window.__devtrackerCanvasTexts.push(String(text));
      return originalFillText.call(this, text, ...args);
    };
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });

  const results = {};
  try {
    await page.goto(`${APP_URL}/personnel?admin=1`, { waitUntil: 'networkidle', timeout: 30000 });
    await waitForPage(page, '团队人员');
    assert(await page.getByRole('button', { name: '+ 新增研发人员', exact: true }).isVisible(), '新增研发人员按钮未显示');
    assert(await page.getByRole('button', { name: '配置', exact: true }).isVisible(), '角色配置按钮未显示');
    for (const placeholder of ['按姓名筛选', '按手机号码筛选']) {
      assert(await page.getByPlaceholder(placeholder).isVisible(), `筛选项未显示：${placeholder}`);
    }
    const filterSelects = page.locator('.dt-staff-filter-bar .el-select');
    assert(await filterSelects.count() === 2, '角色/状态筛选下拉框数量不正确');
    const filterText = await page.locator('.dt-staff-filter-bar').innerText();
    assert(filterText.includes('全部角色') && filterText.includes('全部状态'), '角色/状态筛选文案未显示');

    const nameFilter = page.getByPlaceholder('按姓名筛选');
    await nameFilter.fill('赖香山');
    await page.waitForTimeout(300);
    const filteredRows = page.locator('.staff-sortable-table .el-table__body tbody tr');
    assert(await filteredRows.count() === 1, '姓名筛选结果不是 1 条');
    assert((await filteredRows.first().innerText()).includes('赖香山'), '姓名筛选结果不包含赖香山');
    await nameFilter.fill('');
    await page.waitForTimeout(200);

    const roleTagMetrics = await page.locator('.dt-role-tag').evaluateAll(tags => tags.map(tag => ({
      text: tag.textContent.trim(),
      whiteSpace: getComputedStyle(tag).whiteSpace,
      height: tag.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(tag).lineHeight) || 0
    })));
    assert(roleTagMetrics.length > 0, '研发角色标签未渲染');
    assert(roleTagMetrics.every(item => item.whiteSpace === 'nowrap'), '研发角色标签存在换行');

    await page.getByRole('button', { name: '配置', exact: true }).click();
    const roleDialog = page.getByRole('dialog');
    await roleDialog.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    const dialogText = await roleDialog.innerText();
    const dialogInputValues = await roleDialog.locator('input').evaluateAll(inputs => inputs.map(input => input.value));
    for (const roleName of ['AI开发工程师', 'VOIP工程师', 'AI质量工程师', '嵌入式软件工程师']) {
      assert(dialogInputValues.includes(roleName), `配置弹窗缺少角色：${roleName}`);
    }
    assert(dialogText.includes('新增角色'), '配置弹窗缺少新增角色区域');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'personnel-role-config.png'), fullPage: true });
    await roleDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'personnel-desktop.png'), fullPage: true });
    results.personnel = { filterCount: 1, roleTagMetrics, roleConfigCount: 4 };

    await page.goto(`${APP_URL}/report?admin=1`, { waitUntil: 'networkidle', timeout: 30000 });
    await waitForPage(page, '需求工时统计');
    const reportHeaders = await page.locator('th').allInnerTexts();
    for (const roleName of ['AI开发工程师', 'VOIP工程师', 'AI质量工程师', '嵌入式软件工程师']) {
      assert(reportHeaders.some(text => text.includes(roleName)), `需求工时表缺少角色列：${roleName}`);
    }
    const reportNowrap = await page.locator('.dt-report-role-header').evaluateAll(headers => headers.map(header => ({
      text: header.textContent.trim(),
      whiteSpace: getComputedStyle(header).whiteSpace,
      clipped: header.scrollWidth > header.clientWidth
    })));
    assert(reportNowrap.length === 4, '需求工时表角色表头数量不正确');
    assert(reportNowrap.every(item => item.whiteSpace === 'nowrap'), '需求工时表角色表头存在换行');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'report-dynamic-roles.png'), fullPage: true });
    results.report = { headers: reportHeaders.filter(text => /工程师/.test(text)), nowrapHeaders: reportNowrap };

    await page.goto(`${APP_URL}/stats?admin=1`, { waitUntil: 'networkidle', timeout: 30000 });
    await waitForPage(page, '部门全观');
    assert((await page.locator('body').innerText()).includes('嵌入式软件工程师总工时'), '部门全观缺少嵌入式角色卡片');
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);
    const canvasInfo = await canvas.evaluate(element => ({
      width: element.width,
      height: element.height,
      dataLength: element.toDataURL('image/png').length
    }));
    assert(canvasInfo.width > 0 && canvasInfo.height > 0 && canvasInfo.dataLength > 2000, '部门全观图表为空白');

    const statsResponse = await page.request.get('http://127.0.0.1:3001/api/stats?year=2026&quarter=Q3');
    assert(statsResponse.ok(), 'Q3 统计接口失败');
    const statsPayload = await statsResponse.json();
    const pmDistribution = statsPayload.data.pmDistribution || [];
    const positivePms = pmDistribution.filter(item => Number(item.total || 0) > 0);
    const zeroPms = pmDistribution.filter(item => Number(item.total || 0) === 0);
    const canvasTexts = await page.evaluate(() => [...new Set(window.__devtrackerCanvasTexts || [])]);
    for (const pm of positivePms) {
      assert(canvasTexts.includes(chartLabel(pm.name)), `有值 AI 产品经理未绘制：${pm.name}`);
    }
    for (const pm of zeroPms) {
      assert(!canvasTexts.includes(chartLabel(pm.name)), `全零 AI 产品经理仍被绘制：${pm.name}`);
    }
    for (const legend of ['AI开发', 'VOIP', 'AI质量', '嵌入式', '总计']) {
      assert(canvasTexts.includes(legend), `图表图例缺少：${legend}`);
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'stats-zero-pm-filter.png'), fullPage: true });
    results.stats = {
      canvasInfo,
      pmCount: pmDistribution.length,
      displayedPmCount: positivePms.length,
      hiddenZeroPmCount: zeroPms.length,
      legends: ['AI开发', 'VOIP', 'AI质量', '嵌入式', '总计']
    };

    await page.goto('http://127.0.0.1:3001/api/local-reports/workload-analysis/devtracker_workload_period_quarter_2026-Q3_latest.html', { waitUntil: 'networkidle', timeout: 30000 });
    await waitForPage(page, 'DevTracker 工时数据分析报告');
    const staticText = await page.locator('body').textContent();
    assert(staticText.includes('嵌入式软件工程师总工时'), '静态工时报告缺少嵌入式角色卡片');
    assert(staticText.includes('赖香山（VOIP工程师）'), '静态工时报告中赖香山角色错误');
    assert(staticText.includes('赵鲁鹏（VOIP工程师）'), '静态工时报告中赵鲁鹏角色错误');
    const summaryCardLayout = await page.locator('#tab-overview > .overview-metric-grid').evaluate(container => {
      const cards = [...container.querySelectorAll(':scope > .card')];
      const metrics = cards.map(card => {
        const label = card.querySelector('.label');
        const sub = card.querySelector('.sub');
        return {
          y: Math.round(card.getBoundingClientRect().y * 10) / 10,
          labelNowrap: getComputedStyle(label).whiteSpace === 'nowrap',
          subNowrap: getComputedStyle(sub).whiteSpace === 'nowrap',
          labelFits: label.scrollWidth <= label.clientWidth,
          subFits: sub.scrollWidth <= sub.clientWidth
        };
      });
      return {
        count: cards.length,
        sameRow: new Set(metrics.map(item => item.y)).size === 1,
        fullyVisible: container.scrollWidth <= container.clientWidth,
        allTextSingleLine: metrics.every(item => item.labelNowrap && item.subNowrap && item.labelFits && item.subFits)
      };
    });
    assert(summaryCardLayout.count === 5, '静态工时报告汇总卡片数量不是 5 张');
    assert(summaryCardLayout.sameRow, '静态工时报告汇总卡片未保持同一行');
    assert(summaryCardLayout.fullyVisible, '桌面视口下静态工时报告汇总卡片未完整显示');
    assert(summaryCardLayout.allTextSingleLine, '静态工时报告汇总卡片文字发生换行或裁切');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'workload-report-dynamic-roles.png'), fullPage: false });
    results.workloadReport = { embedded: true, voipStaff: ['赖香山', '赵鲁鹏'], summaryCardLayout };

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${APP_URL}/personnel?admin=1`, { waitUntil: 'networkidle', timeout: 30000 });
    await waitForPage(page, '团队人员');
    const mobileWrap = await page.locator('.dt-role-tag').evaluateAll(tags => tags.map(tag => getComputedStyle(tag).whiteSpace));
    assert(mobileWrap.every(value => value === 'nowrap'), '移动视口角色标签存在换行');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'personnel-mobile.png'), fullPage: true });
    results.mobile = { viewport: '390x844', roleTagsNowrap: mobileWrap.length };

    assert(pageErrors.length === 0, `页面脚本异常：${pageErrors.join(' | ')}`);
    assert(consoleErrors.length === 0, `控制台错误：${consoleErrors.join(' | ')}`);
    assert(failedResponses.length === 0, `失败接口：${JSON.stringify(failedResponses)}`);
    results.runtime = { consoleErrors, pageErrors, failedResponses };
  } finally {
    await browser.close();
  }

  const resultPath = path.join(EVIDENCE_DIR, 'ui-results.json');
  fs.writeFileSync(resultPath, JSON.stringify({ status: 'PASS', ...results }, null, 2), 'utf8');
  console.log(JSON.stringify({ status: 'PASS', resultPath, ...results }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
