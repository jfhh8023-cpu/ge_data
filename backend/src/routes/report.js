/**
 * Report 路由 — 汇总报表
 * GET  /api/report?taskId=xxx              获取匹配组数据
 * POST /api/report/match?taskId=xxx        触发智能匹配
 * PUT  /api/report/:id                     更新匹配组（备注等）
 * POST /api/report/manual-row              手动添加行
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { MatchGroup, WorkRecord, Staff } = require('../models');
const { matchRecords } = require('../services/MatchService');
const { safeParseJsonArray } = require('../utils/parseJson');

/* GET /api/report?taskId=xxx */
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.taskId) where.task_id = req.query.taskId;
    const list = await MatchGroup.findAll({ where, order: [['created_at', 'ASC']] });
    // 解析 JSON 字段
    const parsed = list.map(g => {
      const plain = g.toJSON();
      plain.frontend = safeParseJsonArray(plain.frontend);
      plain.backend = safeParseJsonArray(plain.backend);
      plain.test_role = safeParseJsonArray(plain.test_role);
      plain.product_managers = safeParseJsonArray(plain.product_managers);
      return plain;
    });
    res.json({ code: 0, data: parsed });
  } catch (err) { next(err); }
});

/* POST /api/report/match?taskId=xxx — 触发智能匹配 */
router.post('/match', async (req, res, next) => {
  try {
    const { taskId } = req.query;
    if (!taskId) return res.status(400).json({ code: 1, message: 'taskId 必填' });

    // 获取原始记录
    const records = await WorkRecord.findAll({
      where: { task_id: taskId },
      include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }]
    });

    // 执行匹配
    const groups = matchRecords(records.map(r => r.toJSON()));

    // 清除旧匹配组
    await MatchGroup.destroy({ where: { task_id: taskId } });

    // 保存新匹配组
    const created = [];
    for (const g of groups) {
      const mg = await MatchGroup.create({ ...g, task_id: taskId });
      created.push(mg);
    }

    res.json({ code: 0, data: created, message: `生成了 ${created.length} 个匹配组` });
  } catch (err) { next(err); }
});

/* PUT /api/report/:id — 更新匹配组（备注等） */
router.put('/:id', async (req, res, next) => {
  try {
    const mg = await MatchGroup.findByPk(req.params.id);
    if (!mg) return res.status(404).json({ code: 1, message: '匹配组不存在' });
    const fields = ['merged_title', 'version', 'product_managers', 'remark', 'status'];
    fields.forEach(f => { if (req.body[f] !== undefined) mg[f] = req.body[f]; });
    await mg.save();
    res.json({ code: 0, data: mg });
  } catch (err) { next(err); }
});

/* POST /api/report/manual-row — 手动添加行 */
router.post('/manual-row', async (req, res, next) => {
  try {
    const { task_id, merged_title, version, product_managers, frontend, backend, test_role, remark } = req.body;
    if (!task_id) return res.status(400).json({ code: 1, message: 'task_id 必填' });
    const mg = await MatchGroup.create({
      id: uuidv4(), task_id,
      merged_title: merged_title || '',
      version: version || '',
      product_managers: JSON.stringify(product_managers || []),
      frontend: JSON.stringify(frontend || []),
      backend: JSON.stringify(backend || []),
      test_role: JSON.stringify(test_role || []),
      remark: remark || '',
      confidence: 1,
      status: 'manual_merged'
    });
    res.json({ code: 0, data: mg });
  } catch (err) { next(err); }
});

/* POST /api/report/import — v2.0.0 批量导入 MatchGroup（覆盖逻辑） */
router.post('/import', async (req, res, next) => {
  try {
    const { task_id, rows } = req.body;
    if (!task_id) return res.status(400).json({ code: 1, message: 'task_id 必填' });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ code: 1, message: 'rows 须为非空数组' });

    const { Op } = require('sequelize');
    let created = 0, updated = 0;

    for (const row of rows) {
      // 覆盖规则：已存在相同需求名称或相同版本号的 MatchGroup 则覆盖
      let existing = null;
      const conditions = [];
      if (row.merged_title) conditions.push({ merged_title: row.merged_title, task_id });
      if (row.version) conditions.push({ version: row.version, task_id });

      if (conditions.length > 0) {
        existing = await MatchGroup.findOne({ where: { [Op.or]: conditions } });
      }

      // 构建角色 JSON 数组
      const buildRoleArray = (name, hours) => {
        if (!name && !hours) return '[]';
        const names = name ? name.split(/[,，、\s]+/).filter(Boolean) : [''];
        const avgHours = hours ? (hours / names.length) : 0;
        return JSON.stringify(names.map(n => ({ staffName: n, hours: avgHours })));
      };

      const data = {
        merged_title: row.merged_title || '',
        version: row.version || '',
        product_managers: row.product_managers ? JSON.stringify(row.product_managers.split(/[,，、\s]+/).filter(Boolean)) : '[]',
        frontend: buildRoleArray(row.frontend_name, row.frontend_hours),
        backend: buildRoleArray(row.backend_name, row.backend_hours),
        test_role: buildRoleArray(row.test_name, row.test_hours),
        remark: row.remark || ''
      };

      if (existing) {
        // 覆盖保存
        Object.assign(existing, data);
        await existing.save();
        updated++;
      } else {
        // 新增行（manual_merged，可编辑/删除）
        await MatchGroup.create({
          id: uuidv4(),
          task_id,
          ...data,
          confidence: 1,
          status: 'manual_merged'
        });
        created++;
      }
    }

    res.json({ code: 0, message: `导入成功：新增 ${created} 条，覆盖 ${updated} 条` });
  } catch (err) { next(err); }
});

/* DELETE /api/report/:id — 删除手动添加行 */
router.delete('/:id', async (req, res, next) => {
  try {
    const mg = await MatchGroup.findByPk(req.params.id);
    if (!mg) return res.status(404).json({ code: 1, message: '匹配组不存在' });
    if (mg.status !== 'manual_merged') return res.status(403).json({ code: 1, message: '非手动行不可删除' });
    await mg.destroy();
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

module.exports = router;
