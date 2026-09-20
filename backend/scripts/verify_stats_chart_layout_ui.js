/* Reuses the local route-fixture/append-only evidence workflow of verify_stats_record_order_ui.js. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/@test/stats_chart_layout_20260916');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = path.join(OUT, 'evidence', RUN);
const FILTER = process.argv.find(arg => arg.startsWith('--case='))?.slice(7).split(',');
const results = [];
let page;
fs.mkdirSync(EVIDENCE, { recursive: true });

function status(current = 'completed') {
  fs.writeFileSync(path.join(OUT, 'status.md'), `# 部门图表验证状态\n\n运行：${RUN}\n当前：${current}\n\n${results.map(r => `${r.id}: ${r.status}`).join('\n')}\n`, 'utf8');
}
async function check(id, callback) {
  if (FILTER && !FILTER.includes(id)) return;
  status(id); let row;
  try { row = { run: RUN, id, status: 'PASS', evidence: await callback() }; }
  catch (error) {
    row = { run: RUN, id, status: 'FAIL', message: error.message, stack: error.stack };
    row.body = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
    await page.screenshot({ path: path.join(EVIDENCE, `${id}-failure.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
  }
  results.push(row); fs.appendFileSync(path.join(OUT, 'results.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
  console.log(`${id}: ${row.status}${row.message ? ` ${row.message}` : ''}`); status();
}

function fixture() {
  const task = { id: 'CHART-task', title: 'CHART图表验证周', start_date: '2026-09-14', end_date: '2026-09-20', year: 2026, week_number: 38, time_dimension: 'week', status: 'active', is_preferred: true, record_count: 7 };
  const sources = [
    { id: 'CHART-internal', name: '内部需求', color: '#165DFF' }, { id: 'CHART-customer', name: '客户需求', color: '#00B42A' },
    { id: 'CHART-tech', name: '技术需求', color: '#FF7D00' }, { id: 'CHART-other', name: '其他需求', color: '#722ED1' }
  ].map((source, index) => ({ ...source, sort_order: index * 10, is_active: true }));
  const people = [
    { id: 'CHART-dev', name: '研发甲', role: 'ai_dev' }, { id: 'CHART-voip', name: '研发乙', role: 'voip' },
    { id: 'CHART-quality', name: '研发丙', role: 'ai_quality' }, { id: 'CHART-embedded', name: '研发丁', role: 'embedded' },
    { id: 'CHART-product-a', name: '产品甲', role: 'ai_pm' }, { id: 'CHART-product-b', name: '产品乙', role: 'ai_pm' }
  ].map(person => ({ ...person, is_active: true, employment_status: 'active' }));
  const pms = ['归属甲', '归属乙', '归属丙'].map((name, index) => ({ id: `CHART-pm-${index}`, name, is_active: true, employment_status: 'active' }));
  const row = (id, staffIndex, hours, pmIndex = 0) => ({ id, staff_id: people[staffIndex].id, staff: people[staffIndex], staffName: people[staffIndex].name, role: people[staffIndex].role, task_id: task.id, hours, delivery_progress: 50, created_at: '2026-09-16T08:00:00Z', requirement_title: id, version: 'CHART-v1', product_managers: [pms[pmIndex].name], is_product_manager_record: staffIndex >= 4, source_type: staffIndex >= 4 ? 'product_manager' : 'engineering' });
  const engineering = [row('CHART-E1', 0, 32), row('CHART-E2', 1, 8), row('CHART-E3', 0, 16, 1), row('CHART-E4', 2, 8, 1), row('CHART-E5', 3, 12, 2)];
  const products = [
    { ...row('CHART-P1', 4, 40), demand_sources: ['内部需求', '客户需求'], demand_source_weights: { 内部需求: 60, 客户需求: 40 } },
    { ...row('CHART-P2', 5, 20), demand_sources: ['技术需求', '其他需求'], demand_source_weights: { 技术需求: 40, 其他需求: 60 } }
  ];
  const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
  const pmDistribution = pms.map(pm => {
    const records = engineering.filter(record => record.product_managers.includes(pm.name));
    return { ...pm, records, total: records.reduce((s, r) => s + r.hours, 0), ...Object.fromEntries(['ai_dev', 'voip', 'ai_quality', 'embedded', 'ai_pm'].map(role => [role, records.filter(r => r.role === role).reduce((s, r) => s + r.hours, 0)])) };
  });
  const workHours = { actualHours: 136, standardHours: 240, completionRate: 56.67, excessRate: 0, workingDays: 30, calendarStatus: 'official', units: people.map(person => ({ staffId: person.id, staffName: person.name, role: person.role, taskId: task.id, workDates: dates, calendarStatus: 'official' })) };
  return { task, sources, pms, stats: { tasks: [task], records: [...engineering, ...products], staff: people, currentStaff: people, productManagerRecords: products, productDemandDistribution: sources.map((source, i) => ({ ...source, total: [24, 16, 8, 12][i], product: [24, 16, 8, 12][i] })), demandSources: sources, pmDistribution, roleSummary: { ai_dev: 48, voip: 8, ai_quality: 8, embedded: 12, ai_pm: 60 }, summary: { totalHours: 136, recordCount: 7, staffCount: 6, taskCount: 1 }, matchGroups: [], workHours } };
}

async function measure() {
  return page.locator('.dt-department-chart-grid').evaluate(grid => {
    const cards = [...grid.querySelectorAll('.dt-department-chart-card')];
    const canvas = cards[0]?.querySelector('canvas');
    const bars = [...(cards[1]?.querySelectorAll('.dt-product-manager-bar') || [])];
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const canvasRect = canvas.getBoundingClientRect();
    return {
      cards: cards.map(rect), canvas: rect(canvas),
      canvasBars: (canvas.__qaPaths || []).filter(row => row.height > 0 && row.y >= 40 && row.width > 0).map(row => ({ ...row, cssWidth: row.width * canvasRect.width / (canvas.width / devicePixelRatio) })),
      productBars: bars.map(bar => ({ ...rect(bar), series: bar.dataset.series, text: bar.textContent.trim(), color: getComputedStyle(bar).backgroundColor })),
      labels: [...(cards[1]?.querySelectorAll('.dt-product-manager-label') || [])].map(el => el.textContent.trim()),
      legend: [...(cards[1]?.querySelectorAll('.dt-product-manager-legend-item') || [])].map(el => el.textContent.trim()),
      legendRects: [...(cards[1]?.querySelectorAll('.dt-product-manager-legend-item') || [])].map(el => ({ ...rect(el), text: el.textContent.trim() })),
      groups: [...(cards[1]?.querySelectorAll('.dt-product-manager-group') || [])].map(group => ({ label: group.querySelector('.dt-product-manager-label')?.textContent.trim(), bars: [...group.querySelectorAll('.dt-product-manager-bar')].map(bar => ({ series: bar.dataset.series, text: bar.textContent.trim(), width: bar.getBoundingClientRect().width })) }))
    };
  });
}
function assertWidths(value) {
  assert.ok(value.canvasBars.length > 0, 'No left canvas bar drawing captured');
  assert.ok(value.productBars.length > 0, 'No product bars rendered');
  const widths = [...value.canvasBars.map(bar => bar.cssWidth), ...value.productBars.map(bar => bar.width)];
  assert.ok(Math.max(...widths) < 40, `Bars not narrower than previous 40px maximum: ${widths}`);
  assert.ok(Math.max(...widths) - Math.min(...widths) < 0.2, `Left/right widths differ: ${widths}`);
  return [...new Set(widths.map(width => Number(width.toFixed(2))))];
}
function assertDesktopLegend(value) {
  assert.equal(value.legendRects.length, 5, 'Expected four sources and total in legend');
  const tops = value.legendRects.map(item => item.y);
  assert.ok(Math.max(...tops) - Math.min(...tops) < 1, 'Desktop product legend wrapped');
  const right = value.cards[1];
  assert.ok(value.legendRects.every(item => item.x >= right.x && item.x + item.width <= right.x + right.width), 'Product legend escaped card');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const f = fixture(); const errors = []; const failures = []; const writes = [];
  let useLive = false;
  fs.writeFileSync(path.join(EVIDENCE, 'fixture.json'), JSON.stringify(f, null, 2));
  // Measure paint output, including rounded paths; do not reproduce application layout formulas.
  await context.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const original = Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'arcTo', 'rect', 'fill', 'fillText'].map(name => [name, proto[name]]));
    proto.clearRect = function (...args) { this.canvas.__qaPaths = []; this.canvas.__qaTexts = []; return original.clearRect.apply(this, args); };
    proto.fillText = function (text, x, y, ...args) {
      const size = this.measureText(String(text)); this.canvas.__qaTexts ||= [];
      this.canvas.__qaTexts.push({ text: String(text), x, y, left: x - size.actualBoundingBoxLeft, right: x + size.actualBoundingBoxRight, top: y - size.actualBoundingBoxAscent, bottom: y + size.actualBoundingBoxDescent });
      return original.fillText.call(this, text, x, y, ...args);
    };
    proto.beginPath = function (...args) { this.__qaPoints = []; return original.beginPath.apply(this, args); };
    for (const name of ['moveTo', 'lineTo', 'arcTo', 'rect']) proto[name] = function (...args) {
      this.__qaPoints ||= []; this.__qaPoints.push([args[0], args[1]]);
      if (name === 'arcTo') this.__qaPoints.push([args[2], args[3]]);
      if (name === 'rect') this.__qaPoints.push([args[0] + args[2], args[1] + args[3]]);
      return original[name].apply(this, args);
    };
    proto.fill = function (...args) {
      const points = this.__qaPoints || [];
      if (points.length) {
        const xs = points.map(p => p[0]); const ys = points.map(p => p[1]);
        this.canvas.__qaPaths ||= []; this.canvas.__qaPaths.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), color: this.fillStyle });
      }
      return original.fill.apply(this, args);
    };
  });
  await context.route('**/api/**', async route => {
    const request = route.request(); const suffix = new URL(request.url()).pathname.replace(/^.*\/api/, '');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push({ path: suffix, method: request.method() }); return route.fulfill({ status: 200, json: { code: 0, data: {} } }); }
    if (useLive) return route.continue();
    const data = suffix === '/tasks' ? [f.task] : suffix === '/pm' ? f.pms : suffix === '/stats' ? f.stats : undefined;
    if (data !== undefined) return route.fulfill({ status: 200, json: { code: 0, data } });
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message)); page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }); });
  const load = async () => {
    await page.goto('http://localhost:5176/stats?admin=1', { waitUntil: 'networkidle' });
    await page.locator('.dt-department-chart-grid [data-testid="product-hours-chart"]').waitFor();
    await page.waitForFunction(() => document.querySelector('.dt-department-chart-grid canvas')?.__qaPaths?.length > 0);
  };
  const screenshot = async name => { await page.locator('.dt-department-chart-grid').screenshot({ path: path.join(EVIDENCE, name), animations: 'disabled' }); };
  try {
    await check('CHART-DESKTOP', async () => {
      await load(); const value = await measure(); const widths = assertWidths(value);
      assert.deepEqual(value.labels, ['产品甲', '产品乙']);
      assert.deepEqual(value.legend, [...f.sources.map(s => s.name), '总计']);
      assertDesktopLegend(value);
      assert.deepEqual(value.groups.map(g => Number(g.bars.find(bar => bar.series === 'total')?.text)), [40, 20]);
      assert.ok(Math.abs(value.cards[0].y - value.cards[1].y) < 1, 'Desktop charts not side by side');
      const ratio = value.cards[0].width / value.cards[1].width;
      assert.ok(ratio >= 0.65 && ratio <= 1.7, `Chart allocation disproportionate for 3 vs 2 groups: ${ratio}`);
      await screenshot('department-charts-desktop.png');
      await page.getByRole('tab', { name: 'AI产品展示', exact: true }).click();
      const product = page.locator('.el-tab-pane:visible [data-testid="product-hours-chart"]');
      const people = await product.locator('.dt-product-manager-label').allInnerTexts(); assert.deepEqual(people, value.labels);
      const productWidths = await product.locator('.dt-product-manager-bar').evaluateAll(bars => bars.map(bar => bar.getBoundingClientRect().width));
      assert.ok(productWidths.every(width => Math.abs(width - widths[0]) < 0.2));
      await product.screenshot({ path: path.join(EVIDENCE, 'product-tab-same-chart.png'), animations: 'disabled' });
      return { ...value, widths, productWidths };
    });
    await check('CHART-ZERO', async () => {
      await load(); const right = page.locator('.dt-department-chart-card').nth(1); const before = await measure();
      assert.deepEqual(before.groups.map(g => g.bars.length), [3, 3]);
      await right.locator('.el-switch__core').click();
      await page.waitForFunction(() => document.querySelectorAll('.dt-department-chart-grid .dt-product-manager-bar').length === 10);
      const all = await measure(); assertWidths(all);
      assert.deepEqual(all.groups.map(g => g.bars.map(b => b.series)), [f.sources.map(s => s.id).concat('total'), f.sources.map(s => s.id).concat('total')]);
      assert.deepEqual(all.groups.map(g => Number(g.bars.find(b => b.series === 'total')?.text)), [40, 20]);
      await screenshot('department-charts-show-zero.png');
      await right.locator('.el-switch__core').click();
      await page.waitForFunction(() => document.querySelectorAll('.dt-department-chart-grid .dt-product-manager-bar').length === 6);
      return { hiddenCounts: before.groups.map(g => g.bars.length), visibleCounts: all.groups.map(g => g.bars.length), widths: assertWidths(all), totals: [40, 20] };
    });
    await check('CHART-FILTER', async () => {
      await load(); await page.locator('.dt-department-chart-grid .dt-product-manager-label').filter({ hasText: '产品甲' }).click();
      assert.equal(await page.getByRole('tab', { name: 'AI产品展示', exact: true }).getAttribute('aria-selected'), 'true');
      const pane = page.locator('.el-tab-pane:visible').first();
      const rows = await pane.locator('.el-table__body tbody tr').allInnerTexts();
      assert.equal(rows.length, 1); assert.ok(rows[0].includes('CHART-P1') && !rows[0].includes('CHART-P2'));
      await pane.locator('.dt-product-manager-label').filter({ hasText: '产品甲' }).click();
      assert.equal(await pane.locator('.el-table__body tbody tr').count(), 2, 'Click selected person again did not restore full product list');
      return { selectedStaff: '产品甲', selectedRows: 1, toggledBackRows: 2 };
    });
    await check('CHART-MOBILE', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await load();
      const value = await measure(); const widths = assertWidths(value);
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
      assert.equal(dimensions.width, dimensions.viewport); assert.ok(value.cards[1].y > value.cards[0].y, 'Mobile charts did not stack');
      assert.deepEqual(value.labels, ['产品甲', '产品乙']);
      await page.screenshot({ path: path.join(EVIDENCE, 'department-charts-mobile-full.png'), fullPage: true, animations: 'disabled' });
      await screenshot('department-charts-mobile.png');
      const scrolls = await page.locator('.dt-department-chart-grid .dt-pm-chart-stage, .dt-department-chart-grid .dt-product-manager-chart-scroll').evaluateAll(elements => elements.map(el => {
        el.scrollLeft = el.scrollWidth;
        return { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, scrollLeft: el.scrollLeft };
      }));
      assert.ok(scrolls.length === 2 && scrolls.every(item => item.scrollWidth > item.clientWidth && item.scrollLeft > 0), 'Mobile chart local scrolling failed');
      assert.deepEqual(errors, []); assert.deepEqual(failures, []); return { widths, dimensions, scrolls, value, errors, failures, interceptedWrites: writes };
    });
    await check('CHART-LIVE', async () => {
      useLive = true; await page.setViewportSize({ width: 1600, height: 1100 }); await load();
      const value = await measure(); assertWidths(value);
      assertDesktopLegend(value);
      const labels = await page.locator('.dt-department-chart-grid').evaluate(grid => {
        const left = (grid.querySelector('canvas').__qaTexts || []).filter(text => /^\d+(?:\.\d+)?$/.test(text.text) && text.x >= 50);
        const right = [...grid.querySelectorAll('.dt-product-manager-bar span')].map(el => { const r = el.getBoundingClientRect(); return { text: el.textContent.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
        const overlaps = items => items.flatMap((a, index) => items.slice(index + 1).filter(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5).map(b => ({ a, b })));
        return { left: left.map(({ text, left, right, top, bottom }) => ({ text, left, right, top, bottom })), right, leftOverlaps: overlaps(left), rightOverlaps: overlaps(right) };
      });
      await screenshot('department-charts-live-desktop.png');
      fs.writeFileSync(path.join(EVIDENCE, 'live-bar-label-measurement.json'), JSON.stringify({ widths: assertWidths(value), labels }, null, 2));
      assert.deepEqual(labels.rightOverlaps, [], 'Live product value labels overlap');
      assert.deepEqual(labels.leftOverlaps, [], 'Live engineering value labels overlap');
      return { widths: assertWidths(value), cards: value.cards, legendRects: value.legendRects, rightLabels: value.labels, labels };
    });
  } finally { fs.writeFileSync(path.join(EVIDENCE, 'runtime.json'), JSON.stringify({ errors, failures, writes }, null, 2)); await browser.close(); }
  const latest = new Map(); for (const line of fs.readFileSync(path.join(OUT, 'results.jsonl'), 'utf8').trim().split('\n')) { const row = JSON.parse(line); latest.set(row.id, row); }
  fs.writeFileSync(path.join(OUT, 'summary.md'), `# 部门双图验证结果\n\n日期：2026-09-16。最新批次：${RUN}。\n\n| 用例 | 最近结果 | 批次 |\n| --- | --- | --- |\n${[...latest.values()].map(row => `| ${row.id} | ${row.status} | ${row.run} |`).join('\n')}\n\n复现：\`node backend/scripts/verify_stats_chart_layout_ui.js${FILTER ? ` --case=${FILTER.join(',')}` : ''}\`。原始结果见results.jsonl，fixture/测量/截图在evidence/<批次>/。不写业务数据，不发通知。\n`, 'utf8');
  process.exitCode = results.some(row => row.status !== 'PASS') ? 1 : 0;
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; status(error.message); });
