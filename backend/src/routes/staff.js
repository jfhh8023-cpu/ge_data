/**
 * Staff 路由 — RESTful CRUD
 * v1.6.1: 删除前工时检查 + 数据交接接口
 * v1.6.0: GET / 携带 fillToken；新增 ensure-links；POST 自动创建链接
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Staff, StaffFillLink, WorkRecord, CollectionTask } = require('../models');
const { Op } = require('sequelize');

/* 常量 */
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;
const VALID_ROLES = ['frontend', 'backend', 'test'];

/* GET /api/staff — v1.6.0: 携带 fillToken */
router.get('/', async (req, res, next) => {
  try {
    const list = await Staff.findAll({
      order: [['role', 'ASC'], ['created_at', 'ASC']],
      include: [{ model: StaffFillLink, as: 'fillLink', attributes: ['token'] }]
    });
    const data = list.map(s => ({
      ...s.toJSON(),
      fillToken: s.fillLink?.token ?? null
    }));
    res.json({ code: 0, data });
  } catch (err) { next(err); }
});

/* POST /api/staff/ensure-links — v1.6.0: 幂等生成所有 active 人员的系统级链接 */
router.post('/ensure-links', async (req, res, next) => {
  try {
    const activeStaff = await Staff.findAll({ where: { is_active: true } });
    let created = 0;
    for (const s of activeStaff) {
      const exists = await StaffFillLink.findOne({ where: { staff_id: s.id } });
      if (!exists) {
        const token = `${s.id.substring(0, 8)}_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
        await StaffFillLink.create({ id: uuidv4(), staff_id: s.id, token });
        created++;
      }
    }
    res.json({ code: 0, data: { created }, message: `新生成 ${created} 条链接` });
  } catch (err) { next(err); }
});

/* GET /api/staff/:id/records-summary — v1.6.1: 工时汇总（交接弹窗用） */
router.get('/:id/records-summary', async (req, res, next) => {
  try {
    const staff = await Staff.findByPk(req.params.id);
    if (!staff) return res.status(404).json({ code: 1, message: '人员不存在' });

    const records = await WorkRecord.findAll({ where: { staff_id: req.params.id } });
    if (records.length === 0) {
      return res.json({ code: 0, data: { staff, tasks: [], totalRecords: 0 } });
    }

    const taskIds = [...new Set(records.map(r => r.task_id))];
    const tasks = await CollectionTask.findAll({ where: { id: { [Op.in]: taskIds } } });

    const taskList = tasks.map(t => {
      const taskRecs = records.filter(r => r.task_id === t.id);
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        start_date: t.start_date,
        end_date: t.end_date,
        recordCount: taskRecs.length,
        totalHours: taskRecs.reduce((s, r) => s + parseFloat(r.hours || 0), 0).toFixed(1)
      };
    }).sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

    res.json({ code: 0, data: { staff, tasks: taskList, totalRecords: records.length } });
  } catch (err) { next(err); }
});

/* POST /api/staff/:id/transfer — v1.6.1: 将工时数据交接给指定人员 */
router.post('/:id/transfer', async (req, res, next) => {
  try {
    const { to_staff_id } = req.body;
    if (!to_staff_id) return res.status(400).json({ code: 1, message: 'to_staff_id 为必填项' });
    if (to_staff_id === req.params.id) return res.status(400).json({ code: 1, message: '不能交接给自己' });

    const fromStaff = await Staff.findByPk(req.params.id);
    const toStaff = await Staff.findByPk(to_staff_id);
    if (!fromStaff) return res.status(404).json({ code: 1, message: '被交接人员不存在' });
    if (!toStaff) return res.status(404).json({ code: 1, message: '目标人员不存在' });

    const [affectedRows] = await WorkRecord.update(
      { staff_id: to_staff_id },
      { where: { staff_id: req.params.id } }
    );

    res.json({ code: 0, data: { affectedRows }, message: `已将 ${affectedRows} 条工时记录交接给「${toStaff.name}」` });
  } catch (err) { next(err); }
});

/* POST /api/staff */
router.post('/', async (req, res, next) => {
  try {
    const { name, role } = req.body;
    if (!name || name.trim().length < MIN_NAME_LENGTH || name.trim().length > MAX_NAME_LENGTH) {
      return res.status(400).json({ code: 1, message: `姓名长度须为${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH}个字符` });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ code: 1, message: '角色无效' });
    }
    const staffId = uuidv4();
    const staff = await Staff.create({ id: staffId, name: name.trim(), role });
    // v1.6.0: 自动生成系统级专属链接
    const token = `${staffId.substring(0, 8)}_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    await StaffFillLink.create({ id: uuidv4(), staff_id: staffId, token });
    res.json({ code: 0, data: { ...staff.toJSON(), fillToken: token } });
  } catch (err) { next(err); }
});

/* PUT /api/staff/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const { name, role, is_active } = req.body;
    const staff = await Staff.findByPk(req.params.id);
    if (!staff) return res.status(404).json({ code: 1, message: '人员不存在' });
    if (name !== undefined) {
      if (name.trim().length < MIN_NAME_LENGTH) return res.status(400).json({ code: 1, message: '姓名过短' });
      staff.name = name.trim();
    }
    if (role !== undefined && VALID_ROLES.includes(role)) staff.role = role;
    if (is_active !== undefined) staff.is_active = is_active;
    await staff.save();
    res.json({ code: 0, data: staff });
  } catch (err) { next(err); }
});

/* DELETE /api/staff/:id — v1.6.1: 删除前检查工时记录 */
router.delete('/:id', async (req, res, next) => {
  try {
    const recordCount = await WorkRecord.count({ where: { staff_id: req.params.id } });
    if (recordCount > 0) {
      return res.status(400).json({
        code: 1,
        message: `该人员有 ${recordCount} 条工时记录，请先通过「交接」功能将数据迁移到其他人员后再删除`
      });
    }
    // 同步删除 staff_fill_links
    await StaffFillLink.destroy({ where: { staff_id: req.params.id } });
    const count = await Staff.destroy({ where: { id: req.params.id } });
    if (count === 0) return res.status(404).json({ code: 1, message: '人员不存在' });
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

module.exports = router;
