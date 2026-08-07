const express = require('express');
const {
  createStaffRole,
  getRoleDefinitions,
  updateStaffRole
} = require('../services/RoleService');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ code: 0, data: getRoleDefinitions() });
});

router.post('/', async (req, res, next) => {
  try {
    const role = await createStaffRole(req.body);
    res.status(201).json({ code: 0, data: role, message: '角色已新增' });
  } catch (err) { next(err); }
});

router.put('/:key', async (req, res, next) => {
  try {
    const role = await updateStaffRole(req.params.key, req.body);
    res.json({ code: 0, data: role, message: '角色配置已保存' });
  } catch (err) { next(err); }
});

module.exports = router;
