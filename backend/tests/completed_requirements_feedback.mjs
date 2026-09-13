import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, Module } from 'node:module'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { weightedProgress } from '../../frontend/src/utils/progress.js'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifacts = path.join(root, 'docs/@test/completed_requirements_feedback_20260914')
const round = process.argv.find(arg => arg.startsWith('--round='))?.split('=')[1] || 'all'
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${round}`
const runDir = path.join(artifacts, 'runs', runId)
await fs.mkdir(runDir, { recursive: true })
const results = []
const base = process.env.BASE_URL || 'http://127.0.0.1:5176'
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Only local base URLs are allowed')

// Evaluate the actual route module with additional test-only access to pure functions.
async function internals(relative, names) {
  const filename = path.join(root, relative)
  const instance = new Module(filename)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(path.dirname(filename))
  instance._compile(`${await fs.readFile(filename, 'utf8')}\nmodule.exports.qa = { ${names.join(',')} };`, filename)
  return instance.exports.qa
}
const cases = []
const test = (id, phase, requirement, fn) => cases.push({ id, phase, requirement, fn })
const stats = await internals('backend/src/routes/stats.js', ['buildProgressDetails', 'versionTypeOf', 'applyHistoricalProgress', 'buildProductDemandDistribution'])
for (const [id, rows, expected, effective, missing] of [
  ['DATA-01', [[10,100],[2,50]],91.67,12,0],
  ['DATA-02', [[10,100],[10,null]],100,10,1],
  ['DATA-03', [[10,100],[10,''],[10,'  ']],100,10,2],
  ['DATA-04', [[10,100],[10,0]],50,20,0],
  ['DATA-05', [[10,null],[0,100]],null,0,1],
  ['DATA-06', [[10,100],[10,-10],[10,110],[10,true]],100,10,3]
]) test(id, 1, '048/055/057', async () => {
  const records = rows.map(([hours, delivery_progress]) => ({ hours, delivery_progress }))
  const frontend = weightedProgress(records)
  const backend = stats.buildProgressDetails(records)
  const evidence = { frontend, backend: { weightedProgress: backend.weightedProgress, effectiveHours: backend.effectiveHours, missingProgressCount: backend.missingProgressCount }, expected }
  assert.deepEqual([frontend, backend.weightedProgress, backend.effectiveHours, backend.missingProgressCount], [expected, expected, effective, missing], JSON.stringify(evidence))
  return evidence
})
test('VER-01', 1, '055', async () => {
  const types = [null,'','  ','-', 'v1'].map(version => stats.versionTypeOf({ version }))
  assert.deepEqual(types, ['no_version','no_version','no_version','no_version','versioned'])
  return { types }
})
test('HIST-01', 1, '057', async () => {
  const now = new Date()
  const monday = new Date(now); monday.setDate(now.getDate() - (now.getDay() || 7) + 1)
  const previous = new Date(monday); previous.setDate(monday.getDate() - 1)
  const next = new Date(monday); next.setDate(monday.getDate() + 13)
  const ymd = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  const row = { hours: 10, delivery_progress: null }
  const values = [previous, monday, next].map(date => stats.applyHistoricalProgress(row, { end_date: ymd(date) }).delivery_progress)
  assert.deepEqual(values,[100,null,null]); assert.equal(row.delivery_progress,null)
  return { values, original: row.delivery_progress }
})

test('CHART-01', 2, '049/059', async () => {
  const response = await fetch(`${base}/api/stats?year=2026&quarter=Q3`)
  const body = await response.json(); const data = body.data || body
  const source = data.productManagerRecords?.[0]
  if (!source) throw new Error('BLOCKER: 当前本地没有产品经理记录，无法执行多人员图表夹具')
  const first = { ...source, id: 'fixture-manager-a', staff_id: 'fixture-a', staff_name: '同名产品经理', staff: { id: 'fixture-a', name: '同名产品经理' } }
  const second = { ...source, id: 'fixture-manager-b', staff_id: 'fixture-b', staff_name: '同名产品经理', staff: { id: 'fixture-b', name: '同名产品经理' } }
  const page = await productPage({ ...data, productManagerRecords: [first, second] })
  const labels = await page.locator('.dt-product-manager-label').allTextContents(); await page.close()
  assert.equal(labels.length, 2, '产品经理必须按稳定人员 ID 分组，不得按姓名合并')
  return { labels, staffIds: ['fixture-a','fixture-b'] }
})
test('CHART-02', 2, '048/055/059', async () => {
  const response = await fetch(`${base}/api/stats?year=2026&quarter=Q3`)
  const body = await response.json(); const data = body.data || body
  const source = data.productManagerRecords?.[0]
  if (!source) throw new Error('BLOCKER: 当前本地没有产品经理记录，无法执行需求方夹具')
  const names = (data.demandSources || []).slice(0,2).map(item => item.name)
  const fixture = { ...source, hours: 10, demand_sources: names, demand_source_weights: { [names[0]]: 70, [names[1]]: 30 }, staff_name: '权重夹具', staff: { name: '权重夹具' } }
  const page = await productPage({ ...data, productManagerRecords: [fixture] }); await page.locator('.dt-product-demand-zero-toggle .el-switch').click()
  const values = await page.locator('.dt-product-manager-bar span').allTextContents(); await page.close()
  assert.deepEqual(values, ['7.0','3.0','10.0'])
  return { values, sourceNames: names }
})
test('SOURCE-01', 3, '048/055/059', async () => {
  const definitions = [{ id:'s1',name:'内部需求',color:'#111111' },{ id:'s2',name:'客户需求',color:'#222222' }]
  const raw = { id:'r1', hours:10, demand_sources:['内部需求','客户需求'], demand_source_weights:{'内部需求':70,'客户需求':30}, staff:{name:'夹具'} }
  const distribution = stats.buildProductDemandDistribution([{ toJSON: () => raw }], definitions)
  assert.deepEqual(distribution.map(row => row.total), [7,3]); assert.equal(distribution.reduce((sum,row)=>sum+row.total,0),10)
  return { distribution: distribution.map(row => ({ name: row.name, total: row.total, original: row.records[0].originalHours })) }
})
test('SOURCE-02', 3, '055', async () => {
  const service = require('../src/services/DemandSourceService')
  assert.equal(service.normalizeName('  客户   需求  '), '客户 需求')
  assert.equal(service.DEFAULT_DEMAND_SOURCES.length, 4)
  return { names: service.DEFAULT_DEMAND_SOURCES.map(row=>row.name) }
})
test('UI-CONTRACT-01', 3, '044/048/050/056', async () => {
  const [settings, fill, statsPage] = await Promise.all([
    fs.readFile(path.join(root,'frontend/src/views/SettingsPage.vue'),'utf8'),
    fs.readFile(path.join(root,'frontend/src/views/FillPage.vue'),'utf8'),
    fs.readFile(path.join(root,'frontend/src/views/StatsPage.vue'),'utf8')
  ])
  for (const size of [10,20,50,100,200,300,500,1000]) assert.match(settings, new RegExp(String(size)))
  for (const progress of ['0','10','20','30','40','50','60','70','80','90','100']) assert.match(fill, new RegExp(`PROGRESS_OPTIONS[^\\n]*${progress}`))
  assert.match(fill, /HISTORY_PROGRESS_DISPLAY\s*=\s*['"]100%['"]/)
  assert.match(statsPage, /ANALYSIS_PAGE_SIZE_OPTIONS/)
  return { settingsPageSizes: [10,20,50,100,200,300,500,1000], progressOptions: [0,10,20,30,40,50,60,70,80,90,100] }
})

test('API-REG-01', 4, '048/055/057/059', async () => {
  const response = await fetch(`${base}/api/stats?year=2026&quarter=Q3`)
  assert.equal(response.ok, true)
  const body = await response.json(); const data = body.data || body
  const all = [...(data.records || []), ...(data.productManagerRecords || [])]
  const invalid = all.filter(row => row.delivery_progress !== null && row.delivery_progress !== undefined &&
    !(typeof row.delivery_progress === 'number' && Number.isFinite(row.delivery_progress) && row.delivery_progress >= 0 && row.delivery_progress <= 100))
  assert.deepEqual(invalid, [])
  return { recordCount: all.length, invalidCount: invalid.length }
})

test('UI-REG-01', 4, '049/059', async () => {
  const response = await fetch(`${base}/api/stats?year=2026&quarter=Q3`)
  const body = await response.json(); const data = body.data || body
  const errors = []
  const pages = []
  for (const width of [1280, 1920]) {
    const page = await productPage(data, width)
    page.on('pageerror', error => errors.push(`${width}:pageerror:${error.message}`))
    page.on('console', message => { if (message.type() === 'error') errors.push(`${width}:console:${message.text()}`) })
    await page.locator('.dt-product-manager-chart').waitFor({ state: 'visible' }).catch(() => {})
    const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    const labels = await page.locator('.dt-product-manager-label').allTextContents()
    pages.push({ width, layout, labels })
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `width ${width} must not introduce horizontal scrolling`)
    await page.close()
  }
  assert.deepEqual(errors, [])
  return { pages }
})

test('UI-REG-02', 4, '049/059', async () => {
  const response = await fetch(`${base}/api/stats?year=2026&quarter=Q3`)
  const body = await response.json(); const data = body.data || body
  const page = await productPage(data, 1280)
  const labels = await page.locator('.dt-product-manager-label').allTextContents()
  if (labels.length > 0) {
    await page.locator('.dt-product-manager-label').first().click()
    const filter = await page.locator('.dt-product-demand-tip').last().textContent()
    assert.ok(filter?.includes(labels[0]))
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }); await page.locator('.dt-stats-tabs').waitFor({ state: 'visible' })
  }
  await page.close()
  return { labelCount: labels.length, selectedLabel: labels[0] || null }
})

test('BUILD-01', 4, 'all completed requirements', async () => {
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], {
    cwd: path.join(root, 'frontend'), encoding: 'utf8', timeout: 120000, windowsHide: true
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return { status: result.status, output: `${result.stdout}`.slice(-1200) }
})

test('RUNTIME-01', 4, '043/044/046/048/050/052/056/058', async () => {
  const scripts = [
    'verify_webhook_dns_lookup_20260902.js',
    'verify_auto_retry_and_calendar_indicators.js',
    'verify_same_day_unfinished_duty_swap.js',
    'verify_holiday_schedule_display_20260824.js',
    'verify_duty_calendar_system_integration.js',
    'verify_auto_task_history_pagination.js'
  ]
  const evidence = []
  for (const script of scripts) {
    const result = spawnSync(process.execPath, [`scripts/${script}`], {
      cwd: path.join(root, 'backend'), encoding: 'utf8', timeout: 120000, windowsHide: true,
      env: { ...process.env, ALLOW_LOCAL_WEBHOOK_TEST: '1' }
    })
    evidence.push({ script, status: result.status, output: `${result.stdout}${result.stderr}`.slice(-1800) })
    assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`)
  }
  return { scripts: evidence.map(({ script, status }) => ({ script, status })) }
})

let browser
async function openPage(data, width = 1280) {
  browser ||= await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  page.setDefaultTimeout(8000)
  if (data) await page.route('**/api/stats?*', route => route.fulfill({ json: { code: 0, data } }))
  await page.goto(`${base}/stats?admin=1`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.locator('.dt-stats-tabs').waitFor({ state: 'visible' })
  return page
}
async function productPage(data, width) {
  const page = await openPage(data, width)
  await page.getByRole('tab', { name: 'AI产品展示', exact: true }).click()
  return page
}

// CASES_INSERTION_POINT

try {
  const selected = cases.filter(item => round === 'all' || item.phase === Number(round))
  await fs.writeFile(path.join(runDir, 'plan.json'), JSON.stringify(selected.map(({fn,...item})=>item),null,2))
  for (const entry of selected) {
    let result
    try { result = { ...entry, status: 'PASS', evidence: await entry.fn() } }
    catch (error) { result = { ...entry, status: error.message.startsWith('BLOCKER:') ? 'BLOCKER' : 'FAIL', error: error.message, stack: error.stack } }
    delete result.fn
    result.time = new Date().toISOString(); results.push(result)
    await fs.appendFile(path.join(runDir, 'results.jsonl'), JSON.stringify(result)+'\n')
    await fs.writeFile(path.join(artifacts,'status.md'), `# 执行进度\n\n运行：${runId}\n\n完成 ${results.length}/${selected.length}；通过 ${results.filter(x=>x.status==='PASS').length}；最后 ${result.id} ${result.status}\n\n原始结果：runs/${runId}/results.jsonl\n`)
    console.log(`${result.status} ${result.id}${result.error ? ': '+result.error.slice(0,220) : ''}`)
  }
} finally {
  await browser?.close()
  await require('../src/models').sequelize.close()
}
console.log(JSON.stringify({ runId, total: results.length, pass: results.filter(x=>x.status==='PASS').length, failed: results.filter(x=>x.status!=='PASS').map(x=>x.id) }))
if (results.some(x=>x.status!=='PASS')) process.exitCode = 1
