/**
 * 诊断脚本 — 检查历史数据完整性
 */
require('dotenv').config();
const { sequelize, Staff, WorkRecord, FillLink, CollectionTask } = require('../src/models');

(async () => {
  await sequelize.authenticate();
  
  // 1. 2026年任务
  const tasks = await CollectionTask.findAll({
    where: { year: 2026 },
    attributes: ['id', 'title', 'week_number'],
    order: [['week_number', 'ASC']]
  });
  console.log('=== 2026年任务数:', tasks.length, '===');
  tasks.forEach(t => console.log(`  第${t.week_number}周: ${t.title}`));

  // 2. 人员
  const staffList = await Staff.findAll();
  console.log('\n=== 人员数:', staffList.length, '===');

  // 3. FillLink
  const linkCount = await FillLink.count();
  console.log('\n=== FillLink总数:', linkCount, '===');

  // 4. WorkRecord
  const recordCount = await WorkRecord.count();
  console.log('=== WorkRecord总数:', recordCount, '===');

  // 5. WorkRecord中不同task_id数
  const distinctTasks = await WorkRecord.findAll({
    attributes: [[require('sequelize').fn('DISTINCT', require('sequelize').col('task_id')), 'task_id']],
    raw: true
  });
  console.log('=== WorkRecord涉及的不同任务数:', distinctTasks.length, '===');

  // 6. 每个人参与的任务数（通过WorkRecord）
  console.log('\n=== 每个人通过WorkRecord参与的任务数 ===');
  for (const s of staffList) {
    const myTasks = await WorkRecord.findAll({
      where: { staff_id: s.id },
      attributes: [[require('sequelize').fn('DISTINCT', require('sequelize').col('task_id')), 'task_id']],
      raw: true
    });
    const myLinks = await FillLink.count({ where: { staff_id: s.id } });
    console.log(`  ${s.name}: WorkRecord任务数=${myTasks.length}, FillLink数=${myLinks}`);
  }

  await sequelize.close();
})();
