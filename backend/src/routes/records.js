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

/* DELETE /api/records/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const count = await WorkRecord.destroy({ where: { id: req.params.id } });
    if (count === 0) return res.status(404).json({ code: 1, message: '记录不存在' });
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

module.exports = router;
