/**
 * 初始化 product_managers 表数据
 * 从现有 work_records 中提取所有产品经理名称
 */
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { WorkRecord, ProductManager } = require('../models');
const { safeParseJsonArray } = require('../utils/parseJson');

async function initPmData() {
  const sequelize = require('../config/database');
  await sequelize.authenticate();
  console.log('[DB] 连接成功');

  // 确保表存在
  await ProductManager.sync();

  // 检查是否已有数据
  const existingCount = await ProductManager.count();
  if (existingCount > 0) {
    console.log(`[INFO] product_managers 表已有 ${existingCount} 条数据，跳过初始化`);
    process.exit(0);
  }

  // 从 work_records 提取所有 PM 名称
  const records = await WorkRecord.findAll({ attributes: ['product_managers'] });
  const pmNames = new Set();

  for (const r of records) {
    const pms = safeParseJsonArray(r.product_managers);
    for (const pm of pms) {
      if (typeof pm === 'string' && pm.trim() && isNaN(pm)) {
        pmNames.add(pm.trim());
      }
    }
  }

  console.log(`[INFO] 从 work_records 中提取到 ${pmNames.size} 位产品经理：`, [...pmNames]);

  // 插入
  let created = 0;
  for (const name of pmNames) {
    const pmId = uuidv4();
    const token = `pm_${pmId.substring(0, 8)}_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    await ProductManager.create({ id: pmId, name, token });
    created++;
    console.log(`  + ${name} (token: ${token})`);
  }

  console.log(`[OK] 初始化完成，共创建 ${created} 位产品经理`);
  process.exit(0);
}

initPmData().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});
