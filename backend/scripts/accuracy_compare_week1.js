/**
 * 数据准确性对比（Week1）
 *
 * 数据来源：backend/scripts/source/week1_web_source.json（最开始网页获取的数据）
 * 对比目标：数据库中 2026年第1周 任务的 work_records（按 人员+需求+版本+PM 聚合）
 *
 * 用法：
 *   cd backend
 *   node scripts/accuracy_compare_week1.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize, Staff, CollectionTask, WorkRecord } = require('../src/models');

function loadWeek1Source() {
  const sourcePath = path.join(__dirname, 'source', 'week1_web_source.json');
  const raw = fs.readFileSync(sourcePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('week1_web_source.json 格式错误：应为数组');
  return parsed;
}

function normalizePm(pm) {
  if (!pm) return [];
  if (Array.isArray(pm)) return pm.filter(Boolean);
  if (typeof pm === 'string') {
    const s = pm.trim();
    // 兼容历史数据：DB 中可能存的是 JSON 字符串，如 '["钟冠"]'
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch {}
    }
    return [s].filter(Boolean);
  }
  return [];
}

function keyOf({ staffName, title, version, pm }) {
  const pmKey = normalizePm(pm).join('|');
  return `${staffName}::${title}::${version || ''}::${pmKey}`;
}

async function main() {
  await sequelize.authenticate();

  const task = await CollectionTask.findOne({
    where: { year: 2026, week_number: 1, time_dimension: 'week' }
  });
  if (!task) throw new Error('未找到 2026年第1周 任务（collection_tasks.year=2026, week_number=1）');

  // 1) 期望数据（源数据 → 期望 work_records 聚合）
  const sourceRows = loadWeek1Source();
  const expected = new Map(); // key -> hours

  for (const row of sourceRows) {
    const [version, title, pm, beName, beHours, feName, feHours, testName, testHours] = row;
    const triples = [
      { staffName: beName, hours: beHours },
      { staffName: feName, hours: feHours },
      { staffName: testName, hours: testHours }
    ];

    for (const t of triples) {
      const staffName = (t.staffName || '').trim();
      const hoursNum = parseFloat(t.hours);
      if (!staffName) continue;
      if (!Number.isFinite(hoursNum) || hoursNum <= 0) continue;

      const k = keyOf({ staffName, title, version, pm });
      expected.set(k, (expected.get(k) || 0) + hoursNum);
    }
  }

  // 2) 实际数据（DB → 实际 work_records 聚合）
  const records = await WorkRecord.findAll({
    where: { task_id: task.id },
    include: [{ model: Staff, as: 'staff', attributes: ['name'] }]
  });

  const actual = new Map(); // key -> hours
  for (const r of records) {
    const staffName = r.staff?.name || '';
    const title = r.requirement_title;
    const version = r.version || '';
    const pm = r.product_managers;
    const hoursNum = parseFloat(r.hours);
    if (!staffName || !title || !Number.isFinite(hoursNum)) continue;

    const k = keyOf({ staffName, title, version, pm });
    actual.set(k, (actual.get(k) || 0) + hoursNum);
  }

  // 3) 对比
  const diffs = [];
  const allKeys = new Set([...expected.keys(), ...actual.keys()]);
  for (const k of allKeys) {
    const e = expected.get(k) || 0;
    const a = actual.get(k) || 0;
    // 保留两位小数对比
    const e2 = Math.round(e * 100) / 100;
    const a2 = Math.round(a * 100) / 100;
    if (e2 !== a2) diffs.push({ key: k, expected: e2, actual: a2 });
  }

  if (diffs.length === 0) {
    console.log('[OK] Week1 数据与网页源数据一致');
    console.log(`- task_id: ${task.id}`);
    console.log(`- records: ${records.length}`);
    return;
  }

  console.error(`[FAIL] 发现 ${diffs.length} 处不一致（按 人员+需求+版本+PM 聚合）`);
  console.error(`- task_id: ${task.id}`);
  for (const d of diffs.slice(0, 50)) {
    console.error(`- ${d.key} | expected=${d.expected} actual=${d.actual}`);
  }
  if (diffs.length > 50) console.error(`... 还有 ${diffs.length - 50} 条差异未展示`);
  process.exitCode = 1;
}

main()
  .catch(err => {
    console.error('[ERROR]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await sequelize.close(); } catch {}
  });

