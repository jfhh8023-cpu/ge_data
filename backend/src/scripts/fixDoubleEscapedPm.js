/**
 * 修复 work_records.product_managers 中的双重 JSON 转义问题
 * 将 '"[\"xxx\"]"' (JSON STRING) 修复为 '["xxx"]' (JSON ARRAY)
 */
require('dotenv').config();
const sequelize = require('../config/database');

async function fix() {
  await sequelize.authenticate();
  console.log('[DB] connected');

  // 查找所有 JSON_TYPE 为 STRING 的记录（即双重转义）
  const [rows] = await sequelize.query(
    `SELECT id, product_managers FROM work_records
     WHERE product_managers IS NOT NULL
       AND JSON_TYPE(product_managers) = 'STRING'`
  );

  console.log(`[INFO] 发现 ${rows.length} 条双重转义记录`);

  let fixed = 0;
  for (const row of rows) {
    try {
      // product_managers 当前值是一个 JSON 字符串（被 Sequelize 返回时已经解了一层引号）
      // 实际 DB 中存储的是 '"[\"xxx\"]"'，Sequelize 取出后是 '[\"xxx\"]'（一个字符串）
      let val = row.product_managers;
      if (typeof val === 'string') {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          await sequelize.query(
            `UPDATE work_records SET product_managers = :newVal WHERE id = :id`,
            { replacements: { newVal: JSON.stringify(parsed), id: row.id } }
          );
          fixed++;
        }
      }
    } catch (e) {
      console.error(`  [WARN] id=${row.id} parse error:`, e.message);
    }
  }

  console.log(`[OK] 修复了 ${fixed} 条记录`);

  // 验证
  const [remaining] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM work_records
     WHERE product_managers IS NOT NULL AND JSON_TYPE(product_managers) = 'STRING'`
  );
  console.log(`[VERIFY] 残留双重转义: ${remaining[0]?.cnt || 0}`);

  await sequelize.close();
}

fix().catch(e => { console.error(e); process.exit(1); });
