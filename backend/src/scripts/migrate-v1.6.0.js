/**
 * 迁移脚本 v1.6.0
 * 1. collection_tasks 加 is_preferred 字段
 * 2. 新建 staff_fill_links 表
 * 3. 迁移现有 fill_links 数据 → staff_fill_links
 * 4. 为无历史链接的 active staff 生成 token
 *
 * 运行：node backend/src/scripts/migrate-v1.6.0.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Sequelize } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

const sequelize = new Sequelize(
  process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS,
  { host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT, 10), dialect: 'mysql', logging: false }
);

async function run() {
  console.log('[migrate-v1.6.0] 开始执行迁移...');

  // Step 1: collection_tasks 加 is_preferred
  try {
    await sequelize.query(`ALTER TABLE collection_tasks ADD COLUMN is_preferred TINYINT(1) NOT NULL DEFAULT 0`);
    console.log('[✓] collection_tasks.is_preferred 字段已添加');
  } catch (e) {
    if (e.message.includes('Duplicate column')) {
      console.log('[跳过] collection_tasks.is_preferred 已存在');
    } else throw e;
  }

  // Step 2: 新建 staff_fill_links 表
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS staff_fill_links (
        id               CHAR(36)     NOT NULL PRIMARY KEY,
        staff_id         CHAR(36)     NOT NULL UNIQUE,
        token            VARCHAR(100) NOT NULL UNIQUE,
        editing_task_id  CHAR(36)     NULL,
        editing_at       DATETIME     NULL,
        last_action      VARCHAR(20)  NULL,
        last_action_at   DATETIME     NULL,
        draft_data       JSON         NULL,
        draft_task_id    CHAR(36)     NULL,
        draft_saved_at   DATETIME     NULL,
        created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[✓] staff_fill_links 表已创建');
  } catch (e) {
    console.log('[跳过] staff_fill_links 表已存在:', e.message);
  }

  // Step 3: 迁移 fill_links → staff_fill_links（每人取最新 token）
  const [fillLinks] = await sequelize.query(`
    SELECT fl.staff_id, fl.token, fl.created_at
    FROM fill_links fl
    INNER JOIN (
      SELECT staff_id, MAX(created_at) AS max_at
      FROM fill_links GROUP BY staff_id
    ) latest ON fl.staff_id = latest.staff_id AND fl.created_at = latest.max_at
  `);

  let migratedCount = 0;
  for (const row of fillLinks) {
    try {
      await sequelize.query(
        `INSERT IGNORE INTO staff_fill_links (id, staff_id, token, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW())`,
        { replacements: [uuidv4(), row.staff_id, row.token, row.created_at] }
      );
      migratedCount++;
    } catch (e) {
      console.warn(`[跳过] staff_id=${row.staff_id} 已有链接`);
    }
  }
  console.log(`[✓] 已迁移 ${migratedCount} 条 fill_links → staff_fill_links`);

  // Step 4: 为无历史链接的 active staff 自动生成 token
  const [staffList] = await sequelize.query(`
    SELECT s.id FROM staff s
    WHERE s.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM staff_fill_links sfl
        WHERE sfl.staff_id COLLATE utf8mb4_unicode_ci = s.id COLLATE utf8mb4_unicode_ci
      )
  `);

  let generatedCount = 0;
  for (const s of staffList) {
    const token = `${s.id.substring(0, 8)}_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    await sequelize.query(
      `INSERT INTO staff_fill_links (id, staff_id, token) VALUES (?, ?, ?)`,
      { replacements: [uuidv4(), s.id, token] }
    );
    generatedCount++;
  }
  console.log(`[✓] 已为 ${generatedCount} 名人员生成系统级链接`);

  // Step 5: 修正 staff_fill_links 表 collation 与 staff 表一致
  try {
    await sequelize.query(`ALTER TABLE staff_fill_links CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log('[✓] staff_fill_links collation 已修正为 utf8mb4_unicode_ci');
  } catch (e) {
    console.warn('[跳过] collation 修正:', e.message);
  }

  console.log('[migrate-v1.6.0] 迁移完成！');
  await sequelize.close();
}

run().catch(err => {
  console.error('[migrate-v1.6.0] 迁移失败:', err.message);
  process.exit(1);
});
