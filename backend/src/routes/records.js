/**
 * Records 路由 — 工时记录 CRUD
 * GET    /api/records?taskId=xxx    获取某任务下的记录
 * POST   /api/records              创建记录
 * PUT    /api/records/:id          更新记录
 * DELETE /api/records/:id          删除记录
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { WorkRecord, Staff } = require('../models');
const { safeParseJsonArray } = require('../utils/parseJson');

/* GET /api/records?taskId=xxx */
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.taskId) where.task_id = req.query.taskId;
    if (req.query.staffId) where.staff_id = req.query.staffId;
    const list = await WorkRecord.findAll({
      where,
      include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }],
      order: [['staff_id', 'ASC'], ['created_at', 'ASC']]
    });
    const parsed = list.map(r => {
      const plain = r.toJSON();
      plain.product_managers = safeParseJsonArray(plain.product_managers);
      return plain;
    });
    res.json({ code: 0, data: parsed });
  } catch (err) { next(err); }
});

/* POST /api/records */
router.post('/', async (req, res, next) => {
  try {
    const { task_id, staff_id, requirement_title, version, product_managers, hours, link_id } = req.body;
    if (!task_id || !staff_id || !requirement_title || hours === undefined) {
      return res.status(400).json({ code: 1, message: '必填字段缺失' });
    }
    const record = await WorkRecord.create({
      id: uuidv4(), link_id, task_id, staff_id,
      requirement_title, version, product_managers, hours
    });
    res.json({ code: 0, data: record });
  } catch (err) { next(err); }
});

/* PUT /api/records/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const rec = await WorkRecord.findByPk(req.params.id);
    if (!rec) return res.status(404).json({ code: 1, message: '记录不存在' });
    const fields = ['requirement_title', 'version', 'product_managers', 'hours'];
    fields.forEach(f => { if (req.body[f] !== undefined) rec[f] = req.body[f]; });
    rec.updated_at = new Date();
    await rec.save();
    res.json({ code: 0, data: rec });
  } catch (err) { next(err); }
});

/* POST /api/records/import — v2.0.0 批量导入 WorkRecord（任务详情页用） */
router.post('/import', async (req, res, next) => {
  try {
    const { task_id, rows } = req.body;
    if (!task_id) return res.status(400).json({ code: 1, message: 'task_id 必填' });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ code: 1, message: 'rows 须为非空数组' });

    // 校验人员姓名
    const staffNames = [...new Set(rows.map(r => r.staff_name).filter(Boolean))];
    const staffList = await Staff.findAll({ where: { name: staffNames } });
    const staffMap = {};
    staffList.forEach(s => { staffMap[s.name] = s; });
    const missing = staffNames.filter(n => !staffMap[n]);
    if (missing.length > 0) {
      return res.status(400).json({ code: 1, message: `以下人员不在系统中：${missing.join(', ')}` });
    }

    const created = [];
    for (const row of rows) {
      const staff = staffMap[row.staff_name];
      if (!staff) continue;
      const rec = await WorkRecord.create({
        id: uuidv4(),
        task_id,
        staff_id: staff.id,
        requirement_title: row.requirement_title || '',
        version: row.version || '',
        product_managers: row.product_managers || '',
        hours: parseFloat(row.hours) || 0,
        submit_count: 1
      });
      created.push(rec);
    }

    // 自动触发智能匹配
    try {
      const { matchRecords } = require('../services/MatchService');
      const { MatchGroup } = require('../models');
      const allRecords = await WorkRecord.findAll({
        where: { task_id },
        include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }]
      });
      const groups = matchRecords(allRecords.map(r => r.toJSON()));
      await MatchGroup.destroy({ where: { task_id } });
      for (const g of groups) {
        await MatchGroup.create({ ...g, task_id });
      }
    } catch (matchErr) {
      console.error('[records/import] 自动匹配失败:', matchErr.message);
    }

    res.json({ code: 0, data: created, message: `导入成功，共 ${created.length} 条记录` });
  } catch (err) { next(err); }
});

/* DELETE /api/records/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const count = await WorkRecord.destroy({ where: { id: req.params.id } });
    if (count === 0) return res.status(404).json({ code: 1, message: '记录不存在' });
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

module.exports = router;
