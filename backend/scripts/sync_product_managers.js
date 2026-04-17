/**
 * sync_product_managers.js — 同步产品经理数据
 * 将 MatchGroup 中的 product_managers 反写到 WorkRecord
 * 
 * 逻辑：按 task_id + requirement_title + version 匹配
 * 用法: node backend/scripts/sync_product_managers.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/config/database');
const { WorkRecord, MatchGroup } = require('../src/models');
const { Op } = require('sequelize');

async function main() {
  await sequelize.authenticate();
  console.log('[OK] 数据库连接成功');

  // 获取所有 product_managers 为空的 WorkRecord
  const emptyRecords = await WorkRecord.findAll({
    where: {
      [Op.or]: [
        { product_managers: null },
        { product_managers: '[]' },
        { product_managers: 'null' }
      ]
    }
  });
  console.log(`[INFO] 找到 ${emptyRecords.length} 条 product_managers 为空的记录`);

  if (emptyRecords.length === 0) {
    console.log('[OK] 无需同步');
    process.exit(0);
  }

  // 获取所有 MatchGroup
  const matchGroups = await MatchGroup.findAll();
  console.log(`[INFO] 共 ${matchGroups.length} 个 MatchGroup`);

  // 建立索引：task_id + merged_title → product_managers
  const pmIndex = {};
  for (const mg of matchGroups) {
    const pms = mg.product_managers;
    if (!pms || (Array.isArray(pms) && pms.length === 0)) continue;
    
    const key = `${mg.task_id}||${(mg.merged_title || '').trim().toLowerCase()}`;
    pmIndex[key] = pms;
    
    // 也按版本号建索引
    if (mg.version) {
      const keyWithVersion = `${mg.task_id}||${(mg.merged_title || '').trim().toLowerCase()}||${mg.version}`;
      pmIndex[keyWithVersion] = pms;
    }
  }

  let updatedCount = 0;

  for (const record of emptyRecords) {
    // 优先用 task_id + requirement_title + version 匹配
    const keyFull = `${record.task_id}||${(record.requirement_title || '').trim().toLowerCase()}||${record.version || ''}`;
    let pms = pmIndex[keyFull];
    
    // 降级用 task_id + requirement_title 匹配
    if (!pms) {
      const keyPartial = `${record.task_id}||${(record.requirement_title || '').trim().toLowerCase()}`;
      pms = pmIndex[keyPartial];
    }
    
    if (pms) {
      record.product_managers = pms;
      await record.save();
      updatedCount++;
      console.log(`  [OK] ${record.requirement_title} → ${JSON.stringify(pms)}`);
    }
  }

  console.log(`\n[OK] 同步完成，更新了 ${updatedCount}/${emptyRecords.length} 条记录`);
  process.exit(0);
}

main().catch(err => {
  console.error('[ERR]', err);
  process.exit(1);
});
