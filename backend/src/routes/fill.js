/**
 * Fill 路由 — 填写页
 * GET  /api/fill/:token          获取填写页数据
 * POST /api/fill/:token/submit   提交工时记录
 * PUT  /api/fill/:token/editing  标记正在编辑（REQ-17）
 * PUT  /api/fill/:token/draft    暂存草稿（v1.3.0）
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { FillLink, CollectionTask, Staff, WorkRecord, MatchGroup } = require('../models');
const { matchRecords } = require('../services/MatchService');

/* 编辑中判定超时阈值（毫秒）— 超过此时间认为不再编辑 */
const EDITING_TIMEOUT_MS = 30000;

/* GET /api/fill/:token */
router.get('/:token', async (req, res, next) => {
  try {
    const link = await FillLink.findOne({
      where: { token: req.params.token },
      include: [
        { model: CollectionTask, as: 'task' },
        { model: Staff, as: 'staff' }
      ]
    });
    if (!link) return res.status(404).json({ code: 1, message: '链接无效' });
    const records = await WorkRecord.findAll({ where: { link_id: link.id } });
    res.json({
      code: 0,
      data: {
        link,
        task: link.task,
        staff: link.staff,
        records,
        draft_records: link.draft_data || null,
        draft_saved_at: link.draft_saved_at || null
      }
    });
  } catch (err) { next(err); }
});

/* PUT /api/fill/:token/draft — 暂存草稿（v1.3.0） */
router.put('/:token/draft', async (req, res, next) => {
  try {
    const link = await FillLink.findOne({
      where: { token: req.params.token },
      include: [{ model: CollectionTask, as: 'task' }]
    });
    if (!link) return res.status(404).json({ code: 1, message: '链接无效' });

    // 若任务已停止收集，草稿也不允许保存（保持与提交一致的约束）
    if (link.task && link.task.status === 'closed') {
      return res.status(403).json({
        code: 1,
        message: '该任务已停止收集，请联系管理员重新开启任务收集！'
      });
    }

    const { draft_records } = req.body || {};
    if (!Array.isArray(draft_records)) {
      return res.status(400).json({ code: 1, message: 'draft_records 须为数组' });
    }

    link.draft_data = draft_records;
    link.draft_saved_at = new Date();
    link.last_action = 'drafted';
    link.last_action_at = new Date();
    await link.save();

    res.json({ code: 0, message: '草稿已保存', data: { draft_saved_at: link.draft_saved_at } });
  } catch (err) { next(err); }
});

/* POST /api/fill/:token/submit */
router.post('/:token/submit', async (req, res, next) => {
  try {
    const link = await FillLink.findOne({
      where: { token: req.params.token },
      include: [{ model: CollectionTask, as: 'task' }]
    });
    if (!link) return res.status(404).json({ code: 1, message: '链接无效' });

    // REQ-16: 检查任务是否已停止收集
    if (link.task && link.task.status === 'closed') {
      return res.status(403).json({
        code: 1,
        message: '该任务已停止收集，请联系管理员重新开启任务收集！'
      });
    }

    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ code: 1, message: 'records 须为数组' });

    // 删除旧记录后重新插入
    await WorkRecord.destroy({ where: { link_id: link.id } });
    const created = [];
    for (const r of records) {
      const rec = await WorkRecord.create({
        id: uuidv4(), link_id: link.id, task_id: link.task_id, staff_id: link.staff_id,
        requirement_title: r.requirement_title, version: r.version,
        product_managers: r.product_managers, hours: r.hours,
        submit_count: 1
      });
      created.push(rec);
    }
    // REQ-17: 更新提交状态
    link.is_submitted = true;
    link.last_action = 'submitted';
    link.last_action_at = new Date();
    link.editing_at = null;
    // 提交后清理草稿，避免下次误加载
    link.draft_data = null;
    link.draft_saved_at = null;
    await link.save();

    // v1.4.4: 提交后自动触发智能匹配，使需求工时统计页实时更新
    try {
      const allRecords = await WorkRecord.findAll({
        where: { task_id: link.task_id },
        include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }]
      });
      const groups = matchRecords(allRecords.map(r => r.toJSON()));
      await MatchGroup.destroy({ where: { task_id: link.task_id } });
      for (const g of groups) {
        await MatchGroup.create({ ...g, task_id: link.task_id });
      }
    } catch (matchErr) {
      console.error('[fill/submit] 自动匹配失败:', matchErr.message);
    }

    res.json({ code: 0, data: created, message: `提交了 ${created.length} 条记录` });
  } catch (err) { next(err); }
});

/* PUT /api/fill/:token/editing — REQ-17: 标记正在编辑 */
router.put('/:token/editing', async (req, res, next) => {
  try {
    const link = await FillLink.findOne({ where: { token: req.params.token } });
    if (!link) return res.status(404).json({ code: 1, message: '链接无效' });
    link.editing_at = new Date();
    link.last_action = 'editing';
    link.last_action_at = new Date();
    await link.save();
    res.json({ code: 0, message: '已标记编辑状态' });
  } catch (err) { next(err); }
});
/* GET /api/fill/:token/history — v1.4.1: 获取该staff的全部历史任务及记录 */
/* 修复：同时通过 FillLink + WorkRecord 双渠道查找，避免仅靠FillLink导致数据缺失 */
router.get('/:token/history', async (req, res, next) => {
  try {
    const { Op } = require('sequelize');

    const link = await FillLink.findOne({
      where: { token: req.params.token },
      include: [{ model: Staff, as: 'staff' }]
    });
    if (!link) return res.status(404).json({ code: 1, message: '链接无效' });

    const staffId = link.staff_id;

    // 渠道1：通过 FillLink 获取任务ID
    const allLinks = await FillLink.findAll({
      where: { staff_id: staffId },
      attributes: ['task_id']
    });
    const linkTaskIds = allLinks.map(l => l.task_id).filter(Boolean);

    // 渠道2：通过 WorkRecord 获取任务ID（覆盖导入数据场景）
    const workRecordTaskIds = await WorkRecord.findAll({
      where: { staff_id: staffId },
      attributes: [[require('sequelize').fn('DISTINCT', require('sequelize').col('task_id')), 'task_id']],
      raw: true
    });
    const recordTaskIds = workRecordTaskIds.map(r => r.task_id).filter(Boolean);

    // 合并去重
    const allTaskIds = [...new Set([...linkTaskIds, ...recordTaskIds])];

    if (allTaskIds.length === 0) {
      return res.json({ code: 0, data: { tasks: [] } });
    }

    // 获取这些任务的详情
    const tasks = await CollectionTask.findAll({
      where: { id: { [Op.in]: allTaskIds } },
      order: [['start_date', 'DESC']]
    });

    // 获取该成员在这些任务下的全部记录
    const records = await WorkRecord.findAll({
      where: {
        staff_id: staffId,
        task_id: { [Op.in]: allTaskIds }
      }
    });

    // 按任务分组
    const taskList = tasks.map(t => {
      const taskRecords = records.filter(r => r.task_id === t.id);
      const totalHours = taskRecords.reduce((s, r) => s + parseFloat(r.hours || 0), 0);
      return {
        id: t.id,
        title: t.title,
        start_date: t.start_date,
        end_date: t.end_date,
        year: t.year,
        status: t.status,
        time_dimension: t.time_dimension,
        totalHours,
        records: taskRecords
      };
    });

    res.json({ code: 0, data: { tasks: taskList } });
  } catch (err) { next(err); }
});

module.exports = router;
