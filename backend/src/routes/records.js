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
const { Op } = require('sequelize');
const { WorkRecord, Staff, CollectionTask } = require('../models');
const { safeParseJsonArray } = require('../utils/parseJson');
const { isFullCreditRecord, normalizeFullCreditRecord, normalizeProgress, validateManualHours } = require('../services/EffectiveHoursService');
const {
  STAFF_RESIGNED_MESSAGE,
  collectPmNamesFromRecords,
  filterPmNamesForRecord,
  filterRecordsByStaffStatus,
  getPmStatusContextByName,
  isNonResigned
} = require('../services/PersonStatusService');

function normalizeProductManagers(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
    } catch { /* fall through */ }
    return trimmed.split(/[,，、\s]+/).map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function requireProductManagers(value, label = '记录') {
  const productManagers = normalizeProductManagers(value);
  if (productManagers.length === 0) {
    const prefix = label ? `${label}：` : '';
    const err = new Error(`${prefix}请选择AI产品经理`);
    err.status = 400;
    throw err;
  }
  return productManagers;
}

const VALID_PROGRESS = new Set([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
function requireDeliveryProgress(value, label = '记录', allowMissing = false) {
  const progress = normalizeProgress(value);
  if (allowMissing && (value == null || value === '')) return null;
  if (progress === null || !VALID_PROGRESS.has(progress)) {
    const err = new Error(`${label}：请选择交付进度`);
    err.status = 400;
    throw err;
  }
  return progress;
}

async function assertRecordParticipantsWritable({ task_id, staff_id, product_managers }) {
  const [task, staff] = await Promise.all([
    CollectionTask.findByPk(task_id),
    Staff.findByPk(staff_id)
  ]);
  if (!task) {
    const err = new Error('任务不存在');
    err.status = 404;
    throw err;
  }
  if (!staff) {
    const err = new Error('人员不存在');
    err.status = 404;
    throw err;
  }

  if (!isNonResigned(staff)) {
    const err = new Error(STAFF_RESIGNED_MESSAGE);
    err.status = 403;
    throw err;
  }

  const pmContext = await getPmStatusContextByName(product_managers);
  for (const pmName of product_managers) {
    const ctx = pmContext.get(pmName);
    if (!ctx) continue;
    if (!isNonResigned(ctx.pm)) {
      const err = new Error(STAFF_RESIGNED_MESSAGE);
      err.status = 403;
      throw err;
    }
  }
}

/* GET /api/records?taskId=xxx */
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.taskId) where.task_id = req.query.taskId;
    if (req.query.staffId) where.staff_id = req.query.staffId;
    const list = await WorkRecord.findAll({
      where,
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }],
      order: [['staff_id', 'ASC'], ['created_at', 'ASC']]
    });
    const taskIds = [...new Set(list.map(r => r.task_id).filter(Boolean))];
    const tasks = taskIds.length
      ? await CollectionTask.findAll({ where: { id: { [Op.in]: taskIds } } })
      : [];
    const taskById = new Map(tasks.map(task => [task.id, task]));
    const statusAllowedRecords = await filterRecordsByStaffStatus(list, taskById);
    const pmContextByName = await getPmStatusContextByName(collectPmNamesFromRecords(statusAllowedRecords));
    const parsed = await Promise.all(statusAllowedRecords.map(async r => {
      const plain = r.toJSON();
      plain.product_managers = await filterPmNamesForRecord(r, taskById.get(r.task_id), pmContextByName);
      return plain;
    }));
    res.json({ code: 0, data: parsed });
  } catch (err) { next(err); }
});

/* POST /api/records */
router.post('/', async (req, res, next) => {
  try {
    const normalized = normalizeFullCreditRecord(req.body);
    const { task_id, staff_id, requirement_title, version, product_managers, hours, link_id, delivery_progress } = normalized;
    if (!task_id || !staff_id || !requirement_title || hours === undefined) {
      return res.status(400).json({ code: 1, message: '必填字段缺失' });
    }
    validateManualHours(normalized);
    const normalizedPms = isFullCreditRecord(normalized) ? [] : requireProductManagers(product_managers);
    const progress = isFullCreditRecord(normalized) ? null : requireDeliveryProgress(delivery_progress);
    await assertRecordParticipantsWritable({ task_id, staff_id, product_managers: normalizedPms });
    const record = await WorkRecord.create({
      id: uuidv4(), link_id, task_id, staff_id,
      requirement_title, version, product_managers: normalizedPms, hours, delivery_progress: progress
    });
    res.json({ code: 0, data: record });
  } catch (err) { next(err); }
});

/* PUT /api/records/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const rec = await WorkRecord.findByPk(req.params.id);
    if (!rec) return res.status(404).json({ code: 1, message: '记录不存在' });
    const previous = rec.toJSON();
    const input = normalizeFullCreditRecord({ ...previous, ...req.body }, previous);
    if (isFullCreditRecord(previous) && !isFullCreditRecord(input)) {
      if (req.body.version === undefined || String(req.body.version).trim() === String(previous.version).trim()) input.version = '';
      input.product_managers = requireProductManagers(input.product_managers);
    }
    validateManualHours(input);
    const fields = ['requirement_title', 'version', 'hours', 'delivery_progress'];
    fields.forEach(f => { if (input[f] !== undefined) rec[f] = input[f]; });
    if (isFullCreditRecord(input)) rec.product_managers = [];
    else if (req.body.product_managers !== undefined || isFullCreditRecord(previous)) {
      rec.product_managers = requireProductManagers(input.product_managers);
    }
    if (!isFullCreditRecord(input) && req.body.delivery_progress !== undefined) rec.delivery_progress = requireDeliveryProgress(input.delivery_progress, '记录', true);
    const normalizedPms = safeParseJsonArray(rec.product_managers);
    await assertRecordParticipantsWritable({
      task_id: rec.task_id,
      staff_id: rec.staff_id,
      product_managers: normalizedPms
    });
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

    const created = await WorkRecord.sequelize.transaction(async transaction => {
      const batch = [];
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = normalizeFullCreditRecord(rows[rowIndex]);
        const staff = staffMap[row.staff_name];
        if (!staff) continue;
        validateManualHours(row, `第 ${rowIndex + 1} 条记录`);
        const productManagers = isFullCreditRecord(row) ? [] : requireProductManagers(row.product_managers, `第 ${rowIndex + 1} 条记录`);
        const progress = isFullCreditRecord(row) ? null : requireDeliveryProgress(row.delivery_progress, `第 ${rowIndex + 1} 条记录`);
        await assertRecordParticipantsWritable({ task_id, staff_id: staff.id, product_managers: productManagers });
        const rec = await WorkRecord.create({
          id: uuidv4(), task_id, staff_id: staff.id,
          requirement_title: row.requirement_title || '', version: row.version || '',
          product_managers: productManagers, hours: Number(row.hours),
          delivery_progress: progress, submit_count: 1
        }, { transaction });
        batch.push(rec);
      }
      return batch;
    });

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
