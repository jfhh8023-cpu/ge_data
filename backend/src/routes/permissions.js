/**
 * Permissions 路由 — 权限控制（REQ-21）
 * GET    /api/permissions                 获取全部访问链接（含权限）
 * POST   /api/permissions                 创建访问链接
 * PUT    /api/permissions/:id             更新访问链接
 * DELETE /api/permissions/:id             删除访问链接
 * PUT    /api/permissions/:id/permissions 更新链接权限配置
 * GET    /api/permissions/check/:token    根据 token 获取权限（前端校验用）
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { AccessLink, LinkPermission } = require('../models');
const crypto = require('crypto');

/** 资源标识清单 */
const RESOURCES = [
  { resource: 'page:tasks', label: '任务收集页' },
  { resource: 'page:report', label: '需求工时统计页' },
  { resource: 'page:stats', label: '周期统计页' },
  { resource: 'page:personnel', label: '团队人员页' },
  { resource: 'page:permissions', label: '权限管理页' },
  { resource: 'btn:create_task', label: '新建收集按钮' },
  { resource: 'btn:edit_task', label: '编辑任务按钮' },
  { resource: 'btn:delete_task', label: '删除任务按钮' },
  { resource: 'btn:stop_task', label: '停止收集按钮' }
];

/* GET /api/permissions — 获取全部访问链接（含权限） */
router.get('/', async (req, res, next) => {
  try {
    const links = await AccessLink.findAll({
      include: [{ model: LinkPermission, as: 'permissions' }],
      order: [['created_at', 'DESC']]
    });
    res.json({ code: 0, data: { links, resources: RESOURCES } });
  } catch (err) { next(err); }
});

/* POST /api/permissions — 创建访问链接 */
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ code: 1, message: '链接名称必填' });

    const token = crypto.randomBytes(16).toString('hex');
    const link = await AccessLink.create({
      id: uuidv4(), name, token
    });

    // 为全部资源创建默认权限（全部关闭）
    for (const r of RESOURCES) {
      await LinkPermission.create({
        id: uuidv4(),
        link_id: link.id,
        resource: r.resource,
        can_view: false,
        can_create: false,
        can_update: false,
        can_delete: false
      });
    }

    // 重新查询含权限
    const result = await AccessLink.findByPk(link.id, {
      include: [{ model: LinkPermission, as: 'permissions' }]
    });
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
});

/* PUT /api/permissions/:id — 更新访问链接基本信息 */
router.put('/:id', async (req, res, next) => {
  try {
    const link = await AccessLink.findByPk(req.params.id);
    if (!link) return res.status(404).json({ code: 1, message: '链接不存在' });
    const { name, is_active } = req.body;
    if (name !== undefined) link.name = name;
    if (is_active !== undefined) link.is_active = is_active;
    await link.save();
    res.json({ code: 0, data: link });
  } catch (err) { next(err); }
});

/* DELETE /api/permissions/:id — 删除访问链接（级联删除权限） */
router.delete('/:id', async (req, res, next) => {
  try {
    const count = await AccessLink.destroy({ where: { id: req.params.id } });
    if (count === 0) return res.status(404).json({ code: 1, message: '链接不存在' });
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

/* PUT /api/permissions/:id/permissions — 批量更新链接权限配置 */
router.put('/:id/permissions', async (req, res, next) => {
  try {
    const link = await AccessLink.findByPk(req.params.id);
    if (!link) return res.status(404).json({ code: 1, message: '链接不存在' });

    const { permissions } = req.body;
    if (!Array.isArray(permissions)) return res.status(400).json({ code: 1, message: 'permissions 须为数组' });

    for (const p of permissions) {
      const perm = await LinkPermission.findOne({
        where: { link_id: req.params.id, resource: p.resource }
      });
      if (perm) {
        const hasOpTrueInPayload = p.can_create === true || p.can_update === true || p.can_delete === true;

        // 规则1：如果请求显式开启了任一操作权限，则自动开启查看权限
        if (hasOpTrueInPayload) {
          perm.can_view = true;
        }

        if (p.can_view !== undefined) perm.can_view = p.can_view;
        if (p.can_create !== undefined) perm.can_create = p.can_create;
        if (p.can_update !== undefined) perm.can_update = p.can_update;
        if (p.can_delete !== undefined) perm.can_delete = p.can_delete;

        // 规则2：只有在请求显式关闭查看时，才强制关闭增/改/删
        if (p.can_view === false) {
          perm.can_create = false;
          perm.can_update = false;
          perm.can_delete = false;
        }
        await perm.save();
      }
    }

    const result = await AccessLink.findByPk(req.params.id, {
      include: [{ model: LinkPermission, as: 'permissions' }]
    });
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
});

/* GET /api/permissions/check/:token — 根据 token 获取权限（前端校验用） */
router.get('/check/:token', async (req, res, next) => {
  try {
    const link = await AccessLink.findOne({
      where: { token: req.params.token },
      include: [{ model: LinkPermission, as: 'permissions' }]
    });
    if (!link) {
      return res.status(404).json({ code: 1, reason: 'invalid_token', message: 'Token 无效' });
    }
    if (!link.is_active) {
      return res.status(403).json({ code: 1, reason: 'link_disabled', message: '当前链接已停用，请联系管理员处理！' });
    }
    res.json({
      code: 0,
      data: {
        name: link.name,
        is_active: link.is_active,
        permissions: link.permissions
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
