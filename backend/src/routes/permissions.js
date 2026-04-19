/**
 * Permissions 路由 — 权限控制（REQ-21 → v3.0.0 扩展）
 * GET    /api/permissions                 获取全部访问链接（含权限）
 * POST   /api/permissions                 创建访问链接（支持 preset 预设）
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

/* ========== v3.0.0: 分组资源清单（40 项） ========== */
const RESOURCES = [
  // ── 模块 A：任务收集 ──
  { resource: 'page:tasks',              label: '📋 任务收集页',     module: 'tasks',       module_label: '任务收集',     group: 'page', valid_actions: ['view'] },
  { resource: 'btn:tasks:create',        label: '➕ 新建收集',       module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:tasks', valid_actions: ['view', 'create'] },
  { resource: 'btn:tasks:view',          label: '👁 查看任务',       module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:tasks', valid_actions: ['view'] },
  { resource: 'btn:tasks:edit',          label: '✏️ 编辑任务',      module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:tasks', valid_actions: ['view', 'update'] },
  { resource: 'btn:tasks:preferred',     label: '✦ 设为首选',        module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:tasks', valid_actions: ['view', 'update'] },
  { resource: 'btn:tasks:toggle',        label: '⏸ 启停收集',       module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:tasks', valid_actions: ['view', 'update'] },
  { resource: 'btn:tasks:delete',        label: '🗑️ 删除任务',     module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:tasks', valid_actions: ['view', 'delete'] },
  // ── 任务详情（属于任务收集模块） ──
  { resource: 'page:task_detail',        label: '📄 任务详情页',     module: 'tasks',       module_label: '任务收集',     group: 'page', valid_actions: ['view'] },
  { resource: 'btn:task_detail:import',  label: '📥 导入记录',       module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:task_detail', valid_actions: ['view', 'create'] },
  { resource: 'btn:task_detail:template',label: '📋 下载模板',       module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:task_detail', valid_actions: ['view'] },
  { resource: 'btn:task_detail:edit_record',   label: '✏️ 编辑记录', module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:task_detail', valid_actions: ['view', 'update'] },
  { resource: 'btn:task_detail:delete_record', label: '🗑️ 删除记录', module: 'tasks',       module_label: '任务收集',     group: 'btn',  parent_page: 'page:task_detail', valid_actions: ['view', 'delete'] },

  // ── 模块 B：需求工时统计 ──
  { resource: 'page:report',             label: '📊 需求工时统计页', module: 'report',      module_label: '需求工时统计', group: 'page', valid_actions: ['view'] },
  { resource: 'btn:report:match',        label: '🔄 智能匹配',       module: 'report',      module_label: '需求工时统计', group: 'btn',  parent_page: 'page:report', valid_actions: ['view', 'create'] },
  { resource: 'btn:report:import',       label: '📥 导入',           module: 'report',      module_label: '需求工时统计', group: 'btn',  parent_page: 'page:report', valid_actions: ['view', 'create'] },
  { resource: 'btn:report:template',     label: '📋 下载模板',       module: 'report',      module_label: '需求工时统计', group: 'btn',  parent_page: 'page:report', valid_actions: ['view'] },
  { resource: 'btn:report:export',       label: '📤 导出',           module: 'report',      module_label: '需求工时统计', group: 'btn',  parent_page: 'page:report', valid_actions: ['view'] },
  { resource: 'btn:report:edit_mode',    label: '✏️ 编辑模式',      module: 'report',      module_label: '需求工时统计', group: 'btn',  parent_page: 'page:report', valid_actions: ['view', 'update'] },
  { resource: 'btn:report:add_row',      label: '➕ 新增行',         module: 'report',      module_label: '需求工时统计', group: 'btn',  parent_page: 'page:report', valid_actions: ['view', 'create'] },
  { resource: 'btn:report:delete_row',   label: '🗑️ 删除行',       module: 'report',      module_label: '需求工时统计', group: 'btn',  parent_page: 'page:report', valid_actions: ['view', 'delete'] },

  // ── 模块 C：周期统计 ──
  { resource: 'page:stats',              label: '📈 周期统计页',     module: 'stats',       module_label: '周期统计',     group: 'page', valid_actions: ['view'] },
  { resource: 'btn:stats:export',        label: '📤 导出Excel',      module: 'stats',       module_label: '周期统计',     group: 'btn',  parent_page: 'page:stats', valid_actions: ['view'] },

  // ── 模块 D：团队人员 ──
  { resource: 'page:personnel',          label: '👥 团队人员页',     module: 'personnel',   module_label: '团队人员',     group: 'page', valid_actions: ['view'] },
  { resource: 'btn:personnel:create',    label: '➕ 新增人员',       module: 'personnel',   module_label: '团队人员',     group: 'btn',  parent_page: 'page:personnel', valid_actions: ['view', 'create'] },
  { resource: 'btn:personnel:edit',      label: '✏️ 编辑人员',      module: 'personnel',   module_label: '团队人员',     group: 'btn',  parent_page: 'page:personnel', valid_actions: ['view', 'update'] },
  { resource: 'btn:personnel:transfer',  label: '🔄 交接人员',       module: 'personnel',   module_label: '团队人员',     group: 'btn',  parent_page: 'page:personnel', valid_actions: ['view', 'update'] },
  { resource: 'btn:personnel:delete',    label: '🗑️ 删除人员',     module: 'personnel',   module_label: '团队人员',     group: 'btn',  parent_page: 'page:personnel', valid_actions: ['view', 'delete'] },
  { resource: 'btn:personnel:open_link', label: '🔗 打开链接',       module: 'personnel',   module_label: '团队人员',     group: 'btn',  parent_page: 'page:personnel', valid_actions: ['view'] },
  { resource: 'btn:personnel:copy_link', label: '📋 复制链接',       module: 'personnel',   module_label: '团队人员',     group: 'btn',  parent_page: 'page:personnel', valid_actions: ['view'] },

  // ── 模块 E：权限管理 ──
  { resource: 'page:permissions',           label: '🔐 权限管理页',   module: 'permissions', module_label: '权限管理',     group: 'page', valid_actions: ['view'] },
  { resource: 'btn:permissions:create_link',label: '➕ 新建访问链接',  module: 'permissions', module_label: '权限管理',     group: 'btn',  parent_page: 'page:permissions', valid_actions: ['view', 'create'] },
  { resource: 'btn:permissions:edit_perms', label: '✏️ 编辑权限',     module: 'permissions', module_label: '权限管理',     group: 'btn',  parent_page: 'page:permissions', valid_actions: ['view', 'update'] },
  { resource: 'btn:permissions:toggle_link',label: '⏸ 启停链接',      module: 'permissions', module_label: '权限管理',     group: 'btn',  parent_page: 'page:permissions', valid_actions: ['view', 'update'] },
  { resource: 'btn:permissions:delete_link',label: '🗑️ 删除链接',    module: 'permissions', module_label: '权限管理',     group: 'btn',  parent_page: 'page:permissions', valid_actions: ['view', 'delete'] },
  { resource: 'btn:permissions:copy_link',  label: '📋 复制链接',     module: 'permissions', module_label: '权限管理',     group: 'btn',  parent_page: 'page:permissions', valid_actions: ['view'] },

  // ── 模块 F：填写工时 ──
  { resource: 'page:fill',              label: '✍️ 填写工时页',     module: 'fill',        module_label: '填写工时',     group: 'page', valid_actions: ['view'] },
  { resource: 'btn:fill:import',        label: '📥 导入Excel',       module: 'fill',        module_label: '填写工时',     group: 'btn',  parent_page: 'page:fill', valid_actions: ['view', 'create'] },
  { resource: 'btn:fill:template',      label: '📋 下载模板',        module: 'fill',        module_label: '填写工时',     group: 'btn',  parent_page: 'page:fill', valid_actions: ['view'] },
  { resource: 'btn:fill:export_history',label: '📤 导出历史',        module: 'fill',        module_label: '填写工时',     group: 'btn',  parent_page: 'page:fill', valid_actions: ['view'] },
  { resource: 'btn:fill:recognize',     label: '🔍 一键识别',        module: 'fill',        module_label: '填写工时',     group: 'btn',  parent_page: 'page:fill', valid_actions: ['view'] }
];

/* v3.0.0: 旧资源名 → 新资源名映射 */
const RENAME_MAP = {
  'btn:create_task': 'btn:tasks:create',
  'btn:edit_task':   'btn:tasks:edit',
  'btn:delete_task': 'btn:tasks:delete',
  'btn:stop_task':   'btn:tasks:toggle'
};

/**
 * v3.0.0: Lazy migration — 对已有链接执行 rename + 补齐缺失资源
 * 在查询链接时自动调用，确保旧链接平滑迁移
 */
async function migratePermissions(linkId) {
  // 1) Rename 旧资源名
  for (const [oldRes, newRes] of Object.entries(RENAME_MAP)) {
    const existing = await LinkPermission.findOne({ where: { link_id: linkId, resource: oldRes } });
    if (existing) {
      const dup = await LinkPermission.findOne({ where: { link_id: linkId, resource: newRes } });
      if (dup) {
        // 新名已存在，删除旧的
        await existing.destroy();
      } else {
        existing.resource = newRes;
        await existing.save();
      }
    }
  }
  // 2) 补齐缺失资源（默认全 false）
  const currentPerms = await LinkPermission.findAll({ where: { link_id: linkId } });
  const currentResources = new Set(currentPerms.map(p => p.resource));
  for (const r of RESOURCES) {
    if (!currentResources.has(r.resource)) {
      await LinkPermission.create({
        id: uuidv4(),
        link_id: linkId,
        resource: r.resource,
        can_view: false,
        can_create: false,
        can_update: false,
        can_delete: false
      });
    }
  }
}

/* ========== v3.0.0: 预设模板定义 ========== */
function getPresetValues(preset, resource) {
  if (preset === 'readonly') {
    // 所有 page 和 btn 的 can_view=true，其余 false
    return { can_view: true, can_create: false, can_update: false, can_delete: false };
  }
  if (preset === 'edit') {
    // 全部 can_view + can_create + can_update = true, can_delete = false
    return { can_view: true, can_create: true, can_update: true, can_delete: false };
  }
  if (preset === 'full') {
    return { can_view: true, can_create: true, can_update: true, can_delete: true };
  }
  // custom: 全部关闭
  return { can_view: false, can_create: false, can_update: false, can_delete: false };
}

/* GET /api/permissions — 获取全部访问链接（含权限） */
router.get('/', async (req, res, next) => {
  try {
    const links = await AccessLink.findAll({
      include: [{ model: LinkPermission, as: 'permissions' }],
      order: [['created_at', 'DESC']]
    });
    // v3.0.0: 对每个链接执行 lazy migration
    for (const link of links) {
      const resSet = new Set(link.permissions.map(p => p.resource));
      const needsMigration = Object.keys(RENAME_MAP).some(k => resSet.has(k)) ||
                             RESOURCES.some(r => !resSet.has(r.resource));
      if (needsMigration) {
        await migratePermissions(link.id);
      }
    }
    // 迁移后重新查询
    const updatedLinks = await AccessLink.findAll({
      include: [{ model: LinkPermission, as: 'permissions' }],
      order: [['created_at', 'DESC']]
    });
    res.json({ code: 0, data: { links: updatedLinks, resources: RESOURCES } });
  } catch (err) { next(err); }
});

/* POST /api/permissions — 创建访问链接（v3.0.0: 支持 preset 预设） */
router.post('/', async (req, res, next) => {
  try {
    const { name, preset } = req.body;
    if (!name) return res.status(400).json({ code: 1, message: '链接名称必填' });

    const token = crypto.randomBytes(16).toString('hex');
    const link = await AccessLink.create({
      id: uuidv4(), name, token
    });

    // 根据 preset 初始化权限
    for (const r of RESOURCES) {
      const vals = getPresetValues(preset || 'custom', r.resource);
      await LinkPermission.create({
        id: uuidv4(),
        link_id: link.id,
        resource: r.resource,
        ...vals
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
    let link = await AccessLink.findOne({
      where: { token: req.params.token },
      include: [{ model: LinkPermission, as: 'permissions' }]
    });
    if (!link) {
      return res.status(404).json({ code: 1, reason: 'invalid_token', message: 'Token 无效' });
    }
    if (!link.is_active) {
      return res.status(403).json({ code: 1, reason: 'link_disabled', message: '当前链接已停用，请联系管理员处理！' });
    }
    // v3.0.0: lazy migration for token-based access
    const resSet = new Set(link.permissions.map(p => p.resource));
    const needsMigration = Object.keys(RENAME_MAP).some(k => resSet.has(k)) ||
                           RESOURCES.some(r => !resSet.has(r.resource));
    if (needsMigration) {
      await migratePermissions(link.id);
      link = await AccessLink.findOne({
        where: { token: req.params.token },
        include: [{ model: LinkPermission, as: 'permissions' }]
      });
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
