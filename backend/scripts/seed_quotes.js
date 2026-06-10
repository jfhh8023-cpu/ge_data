/**
 * seed_quotes.js — 默认名句导入脚本（v3.3.0）
 *
 * 用法：
 *   node backend/scripts/seed_quotes.js
 *
 * 行为：
 *   - 读取 default_quotes.txt（每行一句）
 *   - 跳过已存在的相同 content 句子（去重）
 *   - 按文件顺序写入 quotes 表（sort_order 顺延）
 *
 * 注意：执行前请先确保数据库已初始化、quotes 表已建。
 */
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { sequelize, Quote } = require('../src/models');

const DATA_FILE = path.join(__dirname, 'default_quotes.txt');

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`[seed_quotes] 数据文件不存在：${DATA_FILE}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const sentences = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  if (sentences.length === 0) {
    console.warn('[seed_quotes] 未读到任何句子。');
    process.exit(0);
  }
  console.log(`[seed_quotes] 共读取 ${sentences.length} 句，开始去重导入...`);

  await Quote.sync();
  const existing = await Quote.findAll({ attributes: ['content'] });
  const existingSet = new Set(existing.map(q => q.content));

  const maxRow = await Quote.findOne({ order: [['sort_order', 'DESC']] });
  let nextOrder = (maxRow?.sort_order || 0) + 1;

  const rowsToInsert = [];
  let skipped = 0;
  for (const content of sentences) {
    if (existingSet.has(content)) {
      skipped++;
      continue;
    }
    rowsToInsert.push({
      id: uuidv4(),
      content,
      sort_order: nextOrder++,
      created_at: new Date(),
      updated_at: new Date()
    });
    existingSet.add(content);
  }

  if (rowsToInsert.length === 0) {
    console.log(`[seed_quotes] 全部 ${sentences.length} 句已存在，无需导入（skipped=${skipped}）。`);
    await sequelize.close();
    return;
  }

  await Quote.bulkCreate(rowsToInsert);
  console.log(`[seed_quotes] 导入完成：新增 ${rowsToInsert.length} 句，跳过重复 ${skipped} 句。`);
  await sequelize.close();
}

main().catch(err => {
  console.error('[seed_quotes] 失败：', err);
  process.exit(1);
});
