/**
 * Fill 路由 — 填写页
 * v1.6.0: 支持系统级专属链接（StaffFillLink），向下兼容旧 FillLink
 *
 * GET  /api/fill/:token                   获取填写页数据（自动判断新旧链接体系）
 * POST /api/fill/:token/submit            提交工时记录（新体系需传 task_id）
 * PUT  /api/fill/:token/editing           标记正在编辑（REQ-17）
 * PUT  /api/fill/:token/draft             暂存草稿
 * GET  /api/fill/:token/history           获取该成员历史任务列表
 * GET  /api/fill/:token/task/:taskId/records  获取某任务的已提交记录（历史编辑用）
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { FillLink, CollectionTask, Staff, WorkRecord, MatchGroup, StaffFillLink } = require('../models');
const { matchRecords } = require('../services/MatchService');
const { Op } = require('sequelize');

const EDITING_TIMEOUT_MS = 30000;

/* ======================================================
 * 工具函数：解析 token，返回 { type:'system'|'legacy', sfl?, link? }
 * ====================================================== */
async function resolveToken(token) {
  // 优先检查新体系（staff_fill_links）
  const sfl = await StaffFillLink.findOne({
    where: { token },
    include: [{ model: Staff, as: 'staff' }]
  });
  if (sfl) return { type: 'system', sfl };

  // 旧体系（fill_links）向下兼容
  const link = await FillLink.findOne({
    where: { token },
    include: [
      { model: CollectionTask, as: 'task' },
      { model: Staff, as: 'staff' }
    ]
  });
  if (link) return { type: 'legacy', link };

  return null;
}

/* ======================================================
 * GET /api/fill/:token — 获取填写页数据
 * 新体系：返回 preferred task（可为 null）
 * 旧体系：返回 task（FillLink 绑定的任务）
 * ====================================================== */
router.get('/:token', async (req, res, next) => {
  try {
    const resolved = await resolveToken(req.params.token);
    if (!resolved) return res.status(404).json({ code: 1, message: '链接无效' });

    if (resolved.type === 'system') {
      const { sfl } = resolved;

      // v1.6.2: 优先取首选任务；若无首选则自动取最新的 active 任务；都没有才为 null
      let currentTask = await CollectionTask.findOne({
        where: { is_preferred: true, status: 'active' }
      });
      if (!currentTask) {
        currentTask = await CollectionTask.findOne({
          where: { status: 'active' },
          order: [['created_at', 'DESC']]
        });
      }

      let records = [];
      let draft_records = null;
      let draft_saved_at = null;
      let is_submitted = false;

      if (currentTask) {
        // 查询该成员在当前任务下的已提交记录
        records = await WorkRecord.findAll({
          where: { staff_id: sfl.staff_id, task_id: currentTask.id }
        });
        // 草稿只在当前任务下有效
        if (sfl.draft_task_id === currentTask.id) {
          draft_records = sfl.draft_data || null;
          draft_saved_at = sfl.draft_saved_at || null;
        }
        is_submitted = records.length > 0;
      }

      return res.json({
        code: 0,
        data: {
          linkType: 'system',
          staff: sfl.staff,
          task: currentTask || null,
          records,
          draft_records,
          draft_saved_at,
          is_submitted
        }
      });
    }

    // 旧体系
    const { link } = resolved;
    const records = await WorkRecord.findAll({ where: { link_id: link.id } });
    return res.json({
      code: 0,
      data: {
        linkType: 'legacy',
        link,
        task: link.task,
        staff: link.staff,
        records,
        draft_records: link.draft_data || null,
        draft_saved_at: link.draft_saved_at || null,
        is_submitted: link.is_submitted || false
      }
    });
  } catch (err) { next(err); }
});

/* ======================================================
 * PUT /api/fill/:token/draft — 暂存草稿
 * ====================================================== */
router.put('/:token/draft', async (req, res, next) => {
  try {
    const resolved = await resolveToken(req.params.token);
    if (!resolved) return res.status(404).json({ code: 1, message: '链接无效' });

    const { draft_records, task_id } = req.body || {};
    if (!Array.isArray(draft_records)) {
      return res.status(400).json({ code: 1, message: 'draft_records 须为数组' });
    }

    if (resolved.type === 'system') {
      const { sfl } = resolved;
      // 验证任务状态
      const taskId = task_id || (await CollectionTask.findOne({ where: { is_preferred: true } }))?.id;
      if (taskId) {
        const task = await CollectionTask.findByPk(taskId);
        if (task?.status === 'closed') {
          return res.status(403).json({ code: 1, message: '该任务已停止收集' });
        }
        sfl.draft_task_id = taskId;
      }
      sfl.draft_data = draft_records;
      sfl.draft_saved_at = new Date();
      sfl.last_action = 'drafted';
      sfl.last_action_at = new Date();
      await sfl.save();
      return res.json({ code: 0, message: '草稿已保存', data: { draft_saved_at: sfl.draft_saved_at } });
    }

    // 旧体系
    const { link } = resolved;
    if (link.task?.status === 'closed') {
      return res.status(403).json({ code: 1, message: '该任务已停止收集，请联系管理员重新开启任务收集！' });
    }
    link.draft_data = draft_records;
    link.draft_saved_at = new Date();
    link.last_action = 'drafted';
    link.last_action_at = new Date();
    await link.save();
    return res.json({ code: 0, message: '草稿已保存', data: { draft_saved_at: link.draft_saved_at } });
  } catch (err) { next(err); }
});

/* ======================================================
 * POST /api/fill/:token/submit — 提交工时记录
 * 新体系：body 须含 task_id
 * ====================================================== */
router.post('/:token/submit', async (req, res, next) => {
  try {
    const resolved = await resolveToken(req.params.token);
    if (!resolved) return res.status(404).json({ code: 1, message: '链接无效' });

    const { records, task_id } = req.body || {};
    if (!Array.isArray(records)) return res.status(400).json({ code: 1, message: 'records 须为数组' });

    if (resolved.type === 'system') {
      const { sfl } = resolved;
      if (!task_id) return res.status(400).json({ code: 1, message: 'task_id 为必填项' });

      const task = await CollectionTask.findByPk(task_id);
      if (!task) return res.status(404).json({ code: 1, message: '任务不存在' });
      if (task.status === 'closed') {
        return res.status(403).json({ code: 1, message: '该任务已停止收集，无法提交' });
      }

      // 删除该成员该任务的旧记录后重新插入
      await WorkRecord.destroy({ where: { task_id, staff_id: sfl.staff_id } });
      const created = [];
      for (const r of records) {
        const rec = await WorkRecord.create({
          id: uuidv4(),
          link_id: null,
          task_id,
          staff_id: sfl.staff_id,
          requirement_title: r.requirement_title,
          version: r.version,
          product_managers: r.product_managers,
          hours: r.hours,
          submit_count: 1
        });
        created.push(rec);
      }
      // 更新活动状态
      // v1.6.2: 保留 editing_task_id（不清空），使 activity 查询能找到此记录
      // 前端 keep-alive 停止后，30s 内 editing_at 超时，editing 标签自然消失
      // last_action = 'submitted' 30s 内显示"提交了"标签
      sfl.editing_at = null;
      sfl.last_action = 'submitted';
      sfl.last_action_at = new Date();
      // 提交后清理对应草稿
      if (sfl.draft_task_id === task_id) {
        sfl.draft_data = null;
        sfl.draft_task_id = null;
        sfl.draft_saved_at = null;
      }
      await sfl.save();

      // 提交后自动触发智能匹配（保留旧备注）
      try {
        const oldGroups = await MatchGroup.findAll({ where: { task_id } });
        const oldRemarkMap = new Map();
        for (const og of oldGroups) {
          const key = (og.version || '').trim().toLowerCase() || (og.merged_title || '').trim();
          if (key && (og.remark || og.status === 'manual_merged')) {
            oldRemarkMap.set(key, { remark: og.remark || '', status: og.status });
          }
        }
        const allRecords = await WorkRecord.findAll({
          where: { task_id },
          include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }]
        });
        const groups = matchRecords(allRecords.map(r => r.toJSON()));
        await MatchGroup.destroy({ where: { task_id } });
        for (const g of groups) {
          const key = (g.version || '').trim().toLowerCase() || (g.merged_title || '').trim();
          const old = oldRemarkMap.get(key);
          if (old) {
            if (old.remark) g.remark = old.remark;
            if (old.status === 'manual_merged') g.status = old.status;
          }
          await MatchGroup.create({ ...g, task_id });
        }
      } catch (matchErr) {
        console.error('[fill/submit] 自动匹配失败:', matchErr.message);
      }

      return res.json({ code: 0, data: created, message: `提交了 ${created.length} 条记录` });
    }

    // 旧体系
    const { link } = resolved;
    if (link.task?.status === 'closed') {
      return res.status(403).json({ code: 1, message: '该任务已停止收集，请联系管理员重新开启任务收集！' });
    }
    await WorkRecord.destroy({ where: { link_id: link.id } });
    const created = [];
    for (const r of records) {
      const rec = await WorkRecord.create({
        id: uuidv4(), link_id: link.id, task_id: link.task_id, staff_id: link.staff_id,
        requirement_title: r.requirement_title, version: r.version,
        product_managers: r.product_managers, hours: r.hours, submit_count: 1
      });
      created.push(rec);
    }
    link.is_submitted = true;
    link.last_action = 'submitted';
    link.last_action_at = new Date();
    link.editing_at = null;
    link.draft_data = null;
    link.draft_saved_at = null;
    await link.save();
    try {
      const oldGroups2 = await MatchGroup.findAll({ where: { task_id: link.task_id } });
      const oldRemarkMap2 = new Map();
      for (const og of oldGroups2) {
        const key = (og.version || '').trim().toLowerCase() || (og.merged_title || '').trim();
        if (key && (og.remark || og.status === 'manual_merged')) {
          oldRemarkMap2.set(key, { remark: og.remark || '', status: og.status });
        }
      }
      const allRecords = await WorkRecord.findAll({
        where: { task_id: link.task_id },
        include: [{ model: Staff, as: 'staff', attributes: ['name', 'role'] }]
      });
      const groups = matchRecords(allRecords.map(r => r.toJSON()));
      await MatchGroup.destroy({ where: { task_id: link.task_id } });
      for (const g of groups) {
        const key = (g.version || '').trim().toLowerCase() || (g.merged_title || '').trim();
        const old = oldRemarkMap2.get(key);
        if (old) {
          if (old.remark) g.remark = old.remark;
          if (old.status === 'manual_merged') g.status = old.status;
        }
        await MatchGroup.create({ ...g, task_id: link.task_id });
      }
    } catch (matchErr) {
      console.error('[fill/submit] 自动匹配失败:', matchErr.message);
    }
    return res.json({ code: 0, data: created, message: `提交了 ${created.length} 条记录` });
  } catch (err) { next(err); }
});

/* ======================================================
 * PUT /api/fill/:token/editing — REQ-17: 标记正在编辑
 * ====================================================== */
router.put('/:token/editing', async (req, res, next) => {
  try {
    const resolved = await resolveToken(req.params.token);
    if (!resolved) return res.status(404).json({ code: 1, message: '链接无效' });

    if (resolved.type === 'system') {
      const { sfl } = resolved;
      const { task_id } = req.body || {};
      sfl.editing_task_id = task_id || null;
      sfl.editing_at = new Date();
      sfl.last_action = 'editing';
      sfl.last_action_at = new Date();
      await sfl.save();
      return res.json({ code: 0, message: '已标记编辑状态' });
    }

    const { link } = resolved;
    link.editing_at = new Date();
    link.last_action = 'editing';
    link.last_action_at = new Date();
    await link.save();
    return res.json({ code: 0, message: '已标记编辑状态' });
  } catch (err) { next(err); }
});

/* ======================================================
 * GET /api/fill/:token/history — 获取该成员历史任务列表
 * ====================================================== */
router.get('/:token/history', async (req, res, next) => {
  try {
    const resolved = await resolveToken(req.params.token);
    if (!resolved) return res.status(404).json({ code: 1, message: '链接无效' });

    const staffId = resolved.type === 'system'
      ? resolved.sfl.staff_id
      : resolved.link.staff_id;

    // 渠道1：FillLink
    const allLinks = await FillLink.findAll({ where: { staff_id: staffId }, attributes: ['task_id'] });
    const linkTaskIds = allLinks.map(l => l.task_id).filter(Boolean);

    // 渠道2：WorkRecord（覆盖系统级链接提交及导入数据）
    const workRecordTaskIds = await WorkRecord.findAll({
      where: { staff_id: staffId },
      attributes: [[require('sequelize').fn('DISTINCT', require('sequelize').col('task_id')), 'task_id']],
      raw: true
    });
    const recordTaskIds = workRecordTaskIds.map(r => r.task_id).filter(Boolean);

    const allTaskIds = [...new Set([...linkTaskIds, ...recordTaskIds])];
    if (allTaskIds.length === 0) return res.json({ code: 0, data: { tasks: [] } });

    const tasks = await CollectionTask.findAll({
      where: { id: { [Op.in]: allTaskIds } },
      order: [['start_date', 'DESC']]
    });
    const records = await WorkRecord.findAll({
      where: { staff_id: staffId, task_id: { [Op.in]: allTaskIds } }
    });

    const taskList = tasks.map(t => {
      const taskRecords = records.filter(r => r.task_id === t.id);
      return {
        id: t.id, title: t.title, start_date: t.start_date, end_date: t.end_date,
        year: t.year, status: t.status, time_dimension: t.time_dimension,
        totalHours: taskRecords.reduce((s, r) => s + parseFloat(r.hours || 0), 0),
        records: taskRecords
      };
    });

    res.json({ code: 0, data: { tasks: taskList } });
  } catch (err) { next(err); }
});

/* ======================================================
 * GET /api/fill/:token/task/:taskId/records
 * v1.6.0: 返回该成员在指定任务下的已提交记录（供历史编辑回显）
 * ====================================================== */
router.get('/:token/task/:taskId/records', async (req, res, next) => {
  try {
    const resolved = await resolveToken(req.params.token);
    if (!resolved) return res.status(404).json({ code: 1, message: '链接无效' });

    const staffId = resolved.type === 'system'
      ? resolved.sfl.staff_id
      : resolved.link.staff_id;

    const task = await CollectionTask.findByPk(req.params.taskId);
    if (!task) return res.status(404).json({ code: 1, message: '任务不存在' });

    const records = await WorkRecord.findAll({
      where: { staff_id: staffId, task_id: req.params.taskId }
    });

    res.json({ code: 0, data: { task, records } });
  } catch (err) { next(err); }
});

module.exports = router;
