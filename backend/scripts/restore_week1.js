/**
 * 恢复第1周数据
 */
require('dotenv').config();
const { sequelize, Staff, CollectionTask, WorkRecord, MatchGroup } = require('../src/models');
const { v4: uuidv4 } = require('uuid');
const { matchRecords } = require('../src/services/MatchService');
const fs = require('fs');
const path = require('path');

function loadWeek1Source() {
  const sourcePath = path.join(__dirname, 'source', 'week1_web_source.json');
  const raw = fs.readFileSync(sourcePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('week1_web_source.json 格式错误：应为数组');
  return parsed;
}

async function main() {
  await sequelize.authenticate();
  console.log('[DB] 连接成功');

  // 获取 staff 映射
  const allStaff = await Staff.findAll();
  const staffMap = {};
  allStaff.forEach(s => staffMap[s.name] = s);

  // 创建第1周任务
  const taskId = uuidv4();
  await CollectionTask.create({
    id: taskId,
    title: '语音业务线-2026年第1周工时统计',
    time_dimension: 'week',
    week_number: 1,
    year: 2026,
    start_date: '2025-12-28',
    end_date: '2026-01-03',
    status: 'closed'
  });
  console.log('✓ 第1周任务已创建');

  // 导入记录
  const WEEK1_DATA = loadWeek1Source();
  let count = 0;
  for (const row of WEEK1_DATA) {
    const [version, title, pm, beName, beHours, feName, feHours, testName, testHours] = row;
    const pmArr = JSON.stringify([pm]);
    const pairs = [];
    if (beName && staffMap[beName]) pairs.push({ staff: staffMap[beName], hours: parseFloat(beHours) });
    if (feName && staffMap[feName]) pairs.push({ staff: staffMap[feName], hours: parseFloat(feHours) });
    if (testName && staffMap[testName]) pairs.push({ staff: staffMap[testName], hours: parseFloat(testHours) });

    for (const p of pairs) {
      if (p.hours <= 0) continue;
      await WorkRecord.create({
        id: uuidv4(), task_id: taskId, staff_id: p.staff.id,
        requirement_title: title, version, product_managers: pmArr,
        hours: p.hours, status: 'submitted'
      });
      count++;
    }
  }
  console.log(`✓ 导入 ${count} 条记录`);

  // 触发智能匹配
  const records = await WorkRecord.findAll({
    where: { task_id: taskId },
    include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }]
  });
  const groups = matchRecords(records.map(r => r.toJSON()));
  for (const g of groups) {
    await MatchGroup.create({ ...g, task_id: taskId });
  }
  console.log(`✓ 生成 ${groups.length} 个匹配组`);

  await sequelize.close();
  console.log('[完成] 第1周数据已恢复');
}

main().catch(console.error);
