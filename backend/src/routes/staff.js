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
const { Staff } = require('../models');

/* 常量 */
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;
const VALID_ROLES = ['frontend', 'backend', 'test'];

/* GET /api/staff */
router.get('/', async (req, res, next) => {
  try {
    const list = await Staff.findAll({ order: [['role', 'ASC'], ['created_at', 'ASC']] });
    res.json({ code: 0, data: list });
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
    const staff = await Staff.create({ id: uuidv4(), name: name.trim(), role });
    res.json({ code: 0, data: staff });
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
