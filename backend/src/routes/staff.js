/**
 * Staff 路由 — RESTful CRUD
 * GET    /api/staff          获取全部人员
 * POST   /api/staff          新增人员
 * PUT    /api/staff/:id      更新人员
 * DELETE /api/staff/:id      删除人员
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Staff, StaffFillLink } = require('../models');

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

/* DELETE /api/staff/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const count = await Staff.destroy({ where: { id: req.params.id } });
    if (count === 0) return res.status(404).json({ code: 1, message: '人员不存在' });
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

module.exports = router;
