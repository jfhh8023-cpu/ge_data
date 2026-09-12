import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5176'
const artifactDir = path.resolve('../docs/@test/req059_feedback_loop_20260912')
const resultsPath = path.join(artifactDir, 'results.jsonl')
const screenshotPath = path.join(artifactDir, 'final-stats.png')
const results = []

function record(id, status, evidence, issue = '') {
  results.push({ id, status, evidence, issue, at: new Date().toISOString() })
}

function assertCase(condition, id, evidence) {
  record(id, condition ? 'PASS' : 'ISSUE', evidence, condition ? '' : '断言未满足')
}

await fs.mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const consoleErrors = []
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('pageerror', error => consoleErrors.push(error.message))

try {
  const apiResponse = await page.request.get(`${baseUrl}/api/stats?year=2026&quarter=Q3`)
  const apiBody = await apiResponse.json()
  const apiData = apiBody.data || apiBody
  const apiSources = apiData.demandSources || []
  const apiProducts = apiData.productManagerRecords || []
  assertCase(apiResponse.ok() && apiSources.length === 4, 'R1-API-001', { status: apiResponse.status(), demandSourceCount: apiSources.length, productRecordCount: apiProducts.length })
  assertCase(apiProducts.every(record => record.is_product_manager_record === true), 'R1-UI-003', { productOnly: apiProducts.every(record => record.is_product_manager_record === true) })

  await page.goto(`${baseUrl}/stats?admin=1`, { waitUntil: 'networkidle' })
  const productTab = page.locator('.dt-stats-tabs .el-tabs__item').filter({ hasText: 'AI产品展示' }).first()
  await productTab.click()
  await page.locator('.dt-product-manager-chart, .dt-empty').first().waitFor({ state: 'visible', timeout: 15000 })

  const chart = page.locator('.dt-product-manager-chart')
  const groupCount = await chart.locator('.dt-product-manager-group').count()
  const labels = await chart.locator('.dt-product-manager-label').allTextContents()
  const legend = await chart.locator('.dt-product-manager-legend span').allTextContents()
  assertCase(groupCount === new Set(labels).size && groupCount > 0, 'R1-UI-001', { groupCount, labels })
  assertCase(legend.length === 5 && legend.at(-1) === '总计', 'R1-UI-002', { legend })

  const switchLocator = page.locator('.dt-product-demand-zero-toggle .el-switch')
  const barsDefault = await chart.locator('.dt-product-manager-bar').count()
  assertCase(barsDefault > 0 && barsDefault <= groupCount * 5, 'R2-UI-001', { groupCount, barsDefault })
  await switchLocator.click()
  await page.waitForTimeout(150)
  const barsExpanded = await chart.locator('.dt-product-manager-bar').count()
  assertCase(barsExpanded === groupCount * 5, 'R2-UI-002', { groupCount, barsExpanded })
  assertCase(barsExpanded === groupCount * 5, 'R3-EDGE-002', { zeroValueBarsRetained: true, groupCount, barsExpanded })
  await switchLocator.click()
  await page.waitForTimeout(150)
  const barsRestored = await chart.locator('.dt-product-manager-bar').count()
  assertCase(barsRestored === barsDefault, 'R4-REG-001', { barsDefault, barsRestored })

  const fixturePage = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await fixturePage.route('**/api/stats**', async route => {
    const fixtureRecord = {
      ...(apiProducts[0] || {}),
      staff_name: '测试产品经理',
      staff: { ...(apiProducts[0]?.staff || {}), name: '测试产品经理' },
      hours: 10,
      demand_sources: apiSources.slice(0, 2).map(source => source.name),
      demand_source_weights: Object.fromEntries(apiSources.slice(0, 2).map((source, index) => [source.name, index === 0 ? 70 : 30]))
    }
    const fixtureData = { ...apiData, productManagerRecords: [fixtureRecord], productDemandDistribution: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data: fixtureData }) })
  })
  await fixturePage.goto(`${baseUrl}/stats?admin=1`, { waitUntil: 'networkidle' })
  await fixturePage.locator('.dt-stats-tabs .el-tabs__item').filter({ hasText: 'AI产品展示' }).first().click()
  await fixturePage.locator('.dt-product-manager-chart').waitFor({ state: 'visible', timeout: 15000 })
  await fixturePage.locator('.dt-product-demand-zero-toggle .el-switch').click()
  const fixtureValues = await fixturePage.locator('.dt-product-manager-bar span').allTextContents()
  assertCase(fixtureValues.join('|') === '7.0|3.0|10.0', 'R2-DATA-001', { fixtureValues, expected: ['7.0', '3.0', '10.0'] })
  await fixturePage.close()

  const emptyPage = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await emptyPage.route('**/api/stats**', async route => {
    const emptyData = { ...apiData, productManagerRecords: [], productDemandDistribution: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data: emptyData }) })
  })
  await emptyPage.goto(`${baseUrl}/stats?admin=1`, { waitUntil: 'networkidle' })
  await emptyPage.locator('.dt-stats-tabs .el-tabs__item').filter({ hasText: 'AI产品展示' }).first().click()
  await emptyPage.locator('.dt-empty').filter({ hasText: '当前范围暂无AI产品经理工时' }).waitFor({ state: 'visible', timeout: 15000 })
  assertCase(await emptyPage.locator('.dt-product-manager-group').count() === 0, 'R3-EDGE-001', { emptyState: true, groupCount: 0 })
  await emptyPage.close()

  if (labels[0]) {
    await chart.locator('.dt-product-manager-label').first().click()
    const tip = await page.locator('.dt-product-demand-tip').filter({ hasText: '当前筛选：' }).innerText()
    const selectedGroups = await chart.locator('.dt-product-manager-group.is-selected').count()
    assertCase(selectedGroups === 1 && tip.includes(labels[0]), 'R2-UI-003', { label: labels[0], selectedGroups, tip })
  } else {
    record('R2-UI-003', 'ISSUE', { labels }, '没有产品经理标签，无法验证筛选')
  }

  await page.locator('.dt-stats-tabs .el-tabs__item').filter({ hasText: '部门展示' }).first().click()
  await page.waitForTimeout(250)
  await productTab.click()
  await page.locator('.dt-product-manager-chart, .dt-empty').first().waitFor({ state: 'visible', timeout: 15000 })
  assertCase(true, 'R3-REG-001', { returnedToProductTab: true })

  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  assertCase(overflow.scrollWidth <= overflow.clientWidth + 1, 'R3-UI-001', overflow)
  const sourceNames = await chart.locator('.dt-product-manager-legend span').allTextContents()
  assertCase(sourceNames.length === apiSources.length + 1, 'R3-REG-002', { apiSourceNames: apiSources.map(source => source.name), uiLegend: sourceNames })

  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.dt-stats-tabs .el-tabs__item').filter({ hasText: 'AI产品展示' }).first().click()
  await page.locator('.dt-product-manager-chart, .dt-empty').first().waitFor({ state: 'visible', timeout: 15000 })
  assertCase(await page.locator('.dt-product-manager-legend span').count() === 5, 'R4-REG-002', { legendCount: await page.locator('.dt-product-manager-legend span').count() })
  await page.screenshot({ path: screenshotPath, fullPage: true })
  assertCase(consoleErrors.length === 0, 'R4-REG-004', { consoleErrors })
} catch (error) {
  record('RUNNER', 'FAIL', { message: error.message, stack: error.stack })
} finally {
  await browser.close()
}

const build = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: path.resolve('../frontend'), encoding: 'utf8' })
  : spawnSync('npm', ['run', 'build'], { cwd: path.resolve('../frontend'), encoding: 'utf8' })
assertCase(build.status === 0, 'R4-REG-003', { exitCode: build.status, error: build.error?.message || '', output: `${build.stdout || ''}${build.stderr || ''}`.slice(-1000) })
const requiredDocs = [
  path.join(artifactDir, 'source_digest.md'),
  path.join(artifactDir, 'round1_requirements_plan_cases.md'),
  path.join(artifactDir, 'round2_requirements_plan_cases.md'),
  path.join(artifactDir, 'round3_requirements_plan_cases.md'),
  path.join(artifactDir, 'round4_requirements_plan_cases.md'),
  path.join(artifactDir, 'plan.md')
]
const missingDocs = []
for (const file of requiredDocs) {
  try { await fs.access(file) } catch { missingDocs.push(file) }
}
assertCase(missingDocs.length === 0, 'R4-DOC-001', { requiredDocs, missingDocs })
await fs.writeFile(resultsPath, results.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf8')

const failed = results.filter(item => item.status !== 'PASS')
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, issues: failed.length, resultsPath, screenshotPath, failed }, null, 2))
if (failed.length) process.exitCode = 1
