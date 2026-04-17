/**
 * Tasks 路由 — RESTful CRUD
 * GET    /api/tasks          获取全部任务
 * POST   /api/tasks          创建收集任务
 * GET    /api/tasks/:id      获取单个任务详情（含链接和记录数）
 * PUT    /api/tasks/:id      更新任务
 * DELETE /api/tasks/:id      删除任务
 * POST   /api/tasks/:id/generate-links  为全员生成链接
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { CollectionTask, FillLink, WorkRecord, MatchGroup, Staff } = require('../models');

/* GET /api/tasks */
router.get('/', async (req, res, next) => {
  try {
    const tasks = await CollectionTask.findAll({
      order: [['year', 'DESC'], ['start_date', 'DESC']],
      attributes: {
        include: [
          [require('sequelize').fn('COUNT', require('sequelize').col('records.id')), 'record_count']
        ]
      },
      include: [{ model: WorkRecord, as: 'records', attributes: [] }],
      group: ['collection_tasks.id'],
      subQuery: false
    });
    res.json({ code: 0, data: tasks });
  } catch (err) { next(err); }
});

/* POST /api/tasks */
router.post('/', async (req, res, next) => {
  try {
    const { title, time_dimension, start_date, end_date, week_number, year, status } = req.body;
    if (!title || !start_date || !end_date || !year) {
      return res.status(400).json({ code: 1, message: '必填字段缺失' });
    }
    const task = await CollectionTask.create({
      id: uuidv4(), title, time_dimension: time_dimension || 'week',
      start_date, end_date, week_number, year, status: status || 'active'
    });
    res.json({ code: 0, data: task });
  } catch (err) { next(err); }
});

/* GET /api/tasks/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const task = await CollectionTask.findByPk(req.params.id);
    if (!task) return res.status(404).json({ code: 1, message: '任务不存在' });
    const records = await WorkRecord.findAll({ where: { task_id: req.params.id }, include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }] });
    const links = await FillLink.findAll({ where: { task_id: req.params.id }, include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }] });
    const matchGroups = await MatchGroup.findAll({ where: { task_id: req.params.id } });
    res.json({ code: 0, data: { task, records, links, matchGroups } });
  } catch (err) { next(err); }
});

/* PUT /api/tasks/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const task = await CollectionTask.findByPk(req.params.id);
    if (!task) return res.status(404).json({ code: 1, message: '任务不存在' });
    const allowedFields = ['title', 'time_dimension', 'start_date', 'end_date', 'week_number', 'year', 'status'];
    allowedFields.forEach(f => { if (req.body[f] !== undefined) task[f] = req.body[f]; });
    await task.save();
    res.json({ code: 0, data: task });
  } catch (err) { next(err); }
});

/* DELETE /api/tasks/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const count = await CollectionTask.destroy({ where: { id: req.params.id } });
    if (count === 0) return res.status(404).json({ code: 1, message: '任务不存在' });
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

/* POST /api/tasks/:id/generate-links */
router.post('/:id/generate-links', async (req, res, next) => {
  try {
    const task = await CollectionTask.findByPk(req.params.id);
    if (!task) return res.status(404).json({ code: 1, message: '任务不存在' });
    const staffList = await Staff.findAll({ where: { is_active: true } });
    const links = [];
    for (const s of staffList) {
      const existing = await FillLink.findOne({ where: { task_id: req.params.id, staff_id: s.id } });
      if (!existing) {
        const token = `${req.params.id}_${s.id}_${Date.now()}`;
        const link = await FillLink.create({ id: uuidv4(), task_id: req.params.id, staff_id: s.id, token });
        links.push(link);
      }
    }
    res.json({ code: 0, data: links, message: `生成了 ${links.length} 条新链接` });
  } catch (err) { next(err); }
});

/* GET /api/tasks/:id/activity — REQ-17: 获取任务实时活动状态 */
router.get('/:id/activity', async (req, res, next) => {
  try {
    const EDITING_TIMEOUT_MS = 30000; // 30 秒内算"正在编辑"
    const links = await FillLink.findAll({
      where: { task_id: req.params.id },
      include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }]
    });

    const now = Date.now();
    const editing = [];
    const submitted = [];

    for (const link of links) {
      const staffName = link.staff?.name || '未知';
      // 判断是否正在编辑
      if (link.editing_at && (now - new Date(link.editing_at).getTime()) < EDITING_TIMEOUT_MS) {
        editing.push(staffName);
      }
      // 判断是否刚刚提交（3 秒内）
      if (link.last_action === 'submitted' && link.last_action_at) {
        const elapsed = now - new Date(link.last_action_at).getTime();
        if (elapsed < 5000) {
          submitted.push(staffName);
        }
      }
    }

    res.json({ code: 0, data: { editing, submitted } });
  } catch (err) { next(err); }
});

module.exports = router;
