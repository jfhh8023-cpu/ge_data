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
const { CollectionTask, FillLink, WorkRecord, MatchGroup, Staff, StaffFillLink } = require('../models');
const { Op } = require('sequelize');

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

/* POST /api/tasks — v1.6.1: 新建任务自动成为收集首选，关闭旧首选 */
router.post('/', async (req, res, next) => {
  try {
    const { title, time_dimension, start_date, end_date, week_number, year, status } = req.body;
    if (!title || !start_date || !end_date || !year) {
      return res.status(400).json({ code: 1, message: '必填字段缺失' });
    }
    // 关闭旧首选任务（停止收集 + 取消首选）
    await CollectionTask.update(
      { is_preferred: false, status: 'closed', updated_at: new Date() },
      { where: { is_preferred: true } }
    );
    // 新建任务默认成为首选收集项
    const task = await CollectionTask.create({
      id: uuidv4(), title, time_dimension: time_dimension || 'week',
      start_date, end_date, week_number, year,
      status: 'active',
      is_preferred: true
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

/* PATCH /api/tasks/:id/preferred — v1.6.0: 设置/取消首选收集项 */
router.patch('/:id/preferred', async (req, res, next) => {
  try {
    const { preferred } = req.body;
    const task = await CollectionTask.findByPk(req.params.id);
    if (!task) return res.status(404).json({ code: 1, message: '任务不存在' });

    if (preferred) {
      if (task.status !== 'active') {
        return res.status(400).json({ code: 1, message: '仅收集中的任务可设为首选' });
      }
      // 全局清除后设置当前任务
      await CollectionTask.update({ is_preferred: false }, { where: {} });
      task.is_preferred = true;
    } else {
      task.is_preferred = false;
    }
    task.updated_at = new Date();
    await task.save();
    res.json({ code: 0, data: task });
  } catch (err) { next(err); }
});

/* GET /api/tasks/:id/activity — REQ-17: 获取任务实时活动状态（兼容新旧链接体系） */
router.get('/:id/activity', async (req, res, next) => {
  try {
    const EDITING_TIMEOUT_MS = 30000;
    const now = Date.now();
    const editing = [];
    const submitted = [];

    // 新体系：从 staff_fill_links 中查当前任务的活动
    const sflLinks = await StaffFillLink.findAll({
      where: { editing_task_id: req.params.id },
      include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }]
    });
    for (const sfl of sflLinks) {
      const staffName = sfl.staff?.name || '未知';
      if (sfl.editing_at && (now - new Date(sfl.editing_at).getTime()) < EDITING_TIMEOUT_MS) {
        editing.push(staffName);
      }
      if (sfl.last_action === 'submitted' && sfl.last_action_at) {
        // 30 秒内展示"提交了"标签，保证 5s 轮询可靠触发
        if ((now - new Date(sfl.last_action_at).getTime()) < 30000) {
          submitted.push(staffName);
        }
      }
    }

    res.json({ code: 0, data: { editing, submitted } });
  } catch (err) { next(err); }
});

module.exports = router;
