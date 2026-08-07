/**
 * PM 路由 — v3.2.0 产品经理管理
 * REQ-31: CRUD + 交接 + 专属查看链接
 * REQ-32: 全局 PM 数据源
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { ProductManager, WorkRecord, MatchGroup, CollectionTask, Staff } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { safeParseJsonArray } = require('../utils/parseJson');
const {
  PM_RESIGNED_MESSAGE,
  buildCurrentStatusPayload,
  filterRecordsByStaffStatus,
  filterRecordsForPm,
  isNonResigned,
  normalizeStatusDate,
  setProductManagerStatus
} = require('../services/PersonStatusService');
const {
  addRoleHours,
  createRoleSummary,
  getRoleDefinitions,
  normalizeStaffRole,
  withRoleAliases
} = require('../services/RoleService');

/* 常量 */
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;
const PM_DEFAULT_NAME = '不在上述';

function recordBelongsToPmName(record, pmName) {
  const pms = safeParseJsonArray(record.product_managers);
  return pms.includes(pmName) || (pmName === PM_DEFAULT_NAME && pms.length === 0);
}

function productManagersForPmResponse(record, pmName) {
  const pms = safeParseJsonArray(record.product_managers);
  return pmName === PM_DEFAULT_NAME && pms.length === 0 ? [PM_DEFAULT_NAME] : pms;
}

/* ========== GET /api/pm — 获取所有 PM 列表 ========== */
router.get('/', async (req, res, next) => {
  try {
    const list = await ProductManager.findAll({
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
    });
    res.json({ code: 0, data: list.map(pm => ({ ...pm.toJSON(), ...buildCurrentStatusPayload(pm) })) });
  } catch (err) { next(err); }
});

/* ========== POST /api/pm — 新增 PM ========== */
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || name.trim().length < MIN_NAME_LENGTH || name.trim().length > MAX_NAME_LENGTH) {
      return res.status(400).json({ code: 1, message: `姓名长度须为${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH}个字符` });
    }
    const trimmedName = name.trim();

    // 唯一性校验
    const existing = await ProductManager.findOne({ where: { name: trimmedName } });
    if (existing) {
      return res.status(400).json({ code: 1, message: `AI产品经理「${trimmedName}」已存在` });
    }

    const pmId = uuidv4();
    const token = `pm_${pmId.substring(0, 8)}_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const pm = await ProductManager.create({
      id: pmId,
      name: trimmedName,
      token
    });
    await setProductManagerStatus(pm, 'active', pm.created_at || new Date());
    res.json({ code: 0, data: { ...pm.toJSON(), ...buildCurrentStatusPayload(pm) } });
  } catch (err) { next(err); }
});

/* ========== PUT /api/pm/sort — 批量更新排序（必须在 /:id 前注册） ========== */
router.put('/sort', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 1, message: 'ids 须为非空数组' });
    }
    for (let i = 0; i < ids.length; i++) {
      await ProductManager.update({ sort_order: i + 1 }, { where: { id: ids[i] } });
    }
    res.json({ code: 0, message: '排序已保存' });
  } catch (err) { next(err); }
});

/* ========== PUT /api/pm/:id/status — 切换在职/离职/留职/长假 ========== */
router.put('/:id/status', async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const pm = await ProductManager.findByPk(req.params.id, { transaction: t });
    if (!pm) {
      await t.rollback();
      return res.status(404).json({ code: 1, message: 'AI产品经理不存在' });
    }
    const effectiveAt = normalizeStatusDate(req.body.effective_date || req.body.status_changed_at);
    await setProductManagerStatus(pm, req.body.employment_status || req.body.status, effectiveAt, t);
    await t.commit();
    res.json({ code: 0, data: { ...pm.toJSON(), ...buildCurrentStatusPayload(pm) }, message: '状态已更新' });
  } catch (err) {
    await t.rollback();
    next(err);
  }
});

/* ========== PUT /api/pm/:id — 修改 PM（名称全局同步） ========== */
router.put('/:id', async (req, res, next) => {
  try {
    const pm = await ProductManager.findByPk(req.params.id);
    if (!pm) return res.status(404).json({ code: 1, message: 'AI产品经理不存在' });

    const { name, is_active } = req.body;

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (trimmedName.length < MIN_NAME_LENGTH || trimmedName.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ code: 1, message: `姓名长度须为${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH}个字符` });
      }

      // 唯一性校验（排除自身）
      const existing = await ProductManager.findOne({
        where: { name: trimmedName, id: { [Op.ne]: pm.id } }
      });
      if (existing) {
        return res.status(400).json({ code: 1, message: `AI产品经理「${trimmedName}」已存在` });
      }

      const oldName = pm.name;
      if (oldName !== trimmedName) {
        // 全局同步：更新 work_records 中的 product_managers JSON 字段
        await syncPmNameInJsonColumn('work_records', 'product_managers', oldName, trimmedName);
        // 全局同步：更新 match_groups 中的 product_managers JSON 字段
        await syncPmNameInJsonColumn('match_groups', 'product_managers', oldName, trimmedName);
      }

      pm.name = trimmedName;
    }

    if (is_active !== undefined) {
      await setProductManagerStatus(pm, is_active ? 'active' : 'resigned', req.body.status_changed_at || new Date());
    }
    if (req.body.employment_status !== undefined || req.body.status !== undefined) {
      await setProductManagerStatus(pm, req.body.employment_status || req.body.status, req.body.status_changed_at || new Date());
    }
    pm.updated_at = new Date();
    await pm.save();

    res.json({ code: 0, data: { ...pm.toJSON(), ...buildCurrentStatusPayload(pm) }, message: '更新成功' });
  } catch (err) { next(err); }
});

/* ========== DELETE /api/pm/:id — 删除 PM（有关联数据时阻止） ========== */
router.delete('/:id', async (req, res, next) => {
  try {
    const pm = await ProductManager.findByPk(req.params.id);
    if (!pm) return res.status(404).json({ code: 1, message: 'AI产品经理不存在' });

    // 检查是否有关联的工时数据
    const relatedCount = await countPmReferences(pm.name);
    if (relatedCount > 0) {
      return res.status(400).json({
        code: 1,
        message: `该AI产品经理有 ${relatedCount} 条关联工时记录，请先通过「交接」功能将数据迁移到其他AI产品经理后再删除`
      });
    }

    await pm.destroy();
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

/* ========== GET /api/pm/:id/references — 获取 PM 关联数据汇总（交接弹窗用） ========== */
router.get('/:id/references', async (req, res, next) => {
  try {
    const pm = await ProductManager.findByPk(req.params.id);
    if (!pm) return res.status(404).json({ code: 1, message: 'AI产品经理不存在' });

    // 查找 work_records 中包含该 PM 名称的记录
    const records = await WorkRecord.findAll();
    const relatedRecords = records.filter(r => recordBelongsToPmName(r, pm.name));

    // 按任务分组
    const taskIds = [...new Set(relatedRecords.map(r => r.task_id))];
    const tasks = taskIds.length > 0
      ? await CollectionTask.findAll({ where: { id: { [Op.in]: taskIds } } })
      : [];

    const taskList = tasks.map(t => {
      const taskRecs = relatedRecords.filter(r => r.task_id === t.id);
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

    res.json({
      code: 0,
      data: {
        pm,
        tasks: taskList,
        totalRecords: relatedRecords.length
      }
    });
  } catch (err) { next(err); }
});

/* ========== POST /api/pm/:id/transfer — PM 数据交接（事务保护） ========== */
router.post('/:id/transfer', async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { to_pm_id } = req.body;
    if (!to_pm_id) { await t.rollback(); return res.status(400).json({ code: 1, message: 'to_pm_id 为必填项' }); }
    if (to_pm_id === req.params.id) { await t.rollback(); return res.status(400).json({ code: 1, message: '不能交接给自己' }); }

    const fromPm = await ProductManager.findByPk(req.params.id, { transaction: t });
    const toPm = await ProductManager.findByPk(to_pm_id, { transaction: t });
    if (!fromPm) { await t.rollback(); return res.status(404).json({ code: 1, message: '被交接的AI产品经理不存在' }); }
    if (!toPm) { await t.rollback(); return res.status(404).json({ code: 1, message: '目标AI产品经理不存在' }); }
    if (!isNonResigned(toPm)) {
      await t.rollback();
      return res.status(400).json({ code: 1, message: '交接目标AI产品经理已离职，不能作为接收人' });
    }

    // 全局替换：work_records + match_groups 中的 PM 名称（事务内执行）
    const wrCount = await syncPmNameInJsonColumn('work_records', 'product_managers', fromPm.name, toPm.name, t);
    const mgCount = await syncPmNameInJsonColumn('match_groups', 'product_managers', fromPm.name, toPm.name, t);

    await t.commit();
    res.json({
      code: 0,
      data: { workRecords: wrCount, matchGroups: mgCount },
      message: `已将数据从「${fromPm.name}」交接给「${toPm.name}」`
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
});


/* ========== GET /api/pm/view/:token — PM 专属查看页 ========== */
router.get('/view/:token', async (req, res, next) => {
  try {
    const pm = await ProductManager.findOne({ where: { token: req.params.token } });
    if (!pm) return res.status(404).json({ code: 1, message: '链接无效' });
    if (!isNonResigned(pm)) {
      return res.json({
        code: 0,
        data: {
          blocked: true,
          reason: 'pm_resigned',
          message: PM_RESIGNED_MESSAGE,
          pm: { id: pm.id, name: pm.name, ...buildCurrentStatusPayload(pm) }
        }
      });
    }

    // 筛选参数
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const quarter = req.query.quarter ? parseInt(req.query.quarter) : null;
    const month = req.query.month ? parseInt(req.query.month) : null;

    const tasks = await CollectionTask.findAll({ where: { year } });
    let filteredTasks = tasks;

    // 按季度过滤
    if (quarter && quarter >= 1 && quarter <= 4) {
      const qStart = new Date(year, (quarter - 1) * 3, 1);
      const qEnd = new Date(year, quarter * 3, 0, 23, 59, 59);
      filteredTasks = filteredTasks.filter(t => {
        const sd = new Date(t.start_date);
        return sd >= qStart && sd <= qEnd;
      });
    }

    // 按月过滤
    if (month && month >= 1 && month <= 12) {
      const mStart = new Date(year, month - 1, 1);
      const mEnd = new Date(year, month, 0, 23, 59, 59);
      filteredTasks = filteredTasks.filter(t => {
        const sd = new Date(t.start_date);
        return sd >= mStart && sd <= mEnd;
      });
    }

    const taskIds = filteredTasks.map(t => t.id);
    const taskById = new Map(filteredTasks.map(t => [t.id, t]));

    if (taskIds.length === 0) {
      return res.json({
        code: 0,
        data: { pm: { id: pm.id, name: pm.name }, year, quarter, month, tasks: [], totalHours: 0, totalRecords: 0, roleDefinitions: getRoleDefinitions() }
      });
    }

    const allRecords = await WorkRecord.findAll({
      where: { task_id: { [Op.in]: taskIds } },
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }]
    });

    // 过滤出包含该 PM 且人员/PM 状态在任务日期允许统计的记录
    const statusAllowedRecords = await filterRecordsByStaffStatus(allRecords, taskById);
    const pmRecords = await filterRecordsForPm(statusAllowedRecords, pm, taskById);

    // 按任务分组
    const taskMap = {};
    for (const t of filteredTasks) {
      taskMap[t.id] = { ...t.toJSON(), records: [] };
    }
    for (const r of pmRecords) {
      if (taskMap[r.task_id]) {
        taskMap[r.task_id].records.push({
          id: r.id,
          requirement_title: r.requirement_title,
          version: r.version,
          hours: r.hours,
          staffName: r.staff?.name || '-',
          role: normalizeStaffRole(r.staff?.role, '-'),
          created_at: r.created_at,
          product_managers: productManagersForPmResponse(r, pm.name)
        });
      }
    }

    const taskList = Object.values(taskMap)
      .filter(t => t.records.length > 0)
      .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

    const totalHours = pmRecords.reduce((s, r) => s + parseFloat(r.hours || 0), 0);

    // 按角色汇总
    const roleSummary = createRoleSummary();
    for (const r of pmRecords) {
      addRoleHours(roleSummary, r.staff?.role, parseFloat(r.hours || 0));
    }

    res.json({
      code: 0,
      data: {
        pm: { id: pm.id, name: pm.name },
        year, quarter, month,
        tasks: taskList,
        totalHours,
        roleSummary: withRoleAliases(roleSummary),
        roleDefinitions: getRoleDefinitions(),
        totalRecords: pmRecords.length
      }
    });
  } catch (err) { next(err); }
});

/* ========== 工具函数 ========== */

/**
 * 在 JSON 数组列中全局替换 PM 名称（安全版 v2）
 * 同时处理正常 JSON 数组和双重转义的 JSON 字符串
 * @param {string} tableName  表名
 * @param {string} columnName 列名
 * @param {string} oldName    旧 PM 名
 * @param {string} newName    新 PM 名
 * @param {object} [transaction] 可选事务对象
 * @returns {number} 受影响的行数
 */
async function syncPmNameInJsonColumn(tableName, columnName, oldName, newName, transaction) {
  // 安全校验：仅允许操作已知的表和列
  const ALLOWED_TABLES = ['work_records', 'match_groups'];
  const ALLOWED_COLUMNS = ['product_managers'];
  if (!ALLOWED_TABLES.includes(tableName) || !ALLOWED_COLUMNS.includes(columnName)) {
    throw new Error(`不允许操作表 ${tableName}.${columnName}`);
  }

  const queryOpts = { replacements: { oldName, likePattern: `%${oldName}%` } };
  if (transaction) queryOpts.transaction = transaction;

  // 查找包含 oldName 的记录（兼容 JSON ARRAY 和双重转义 STRING）
  const [rows] = await sequelize.query(
    `SELECT id, \`${columnName}\` AS col_val FROM \`${tableName}\`
     WHERE \`${columnName}\` IS NOT NULL
       AND (JSON_CONTAINS(\`${columnName}\`, JSON_QUOTE(:oldName))
            OR \`${columnName}\` LIKE :likePattern)`,
    queryOpts
  );

  if (!rows || rows.length === 0) return 0;

  let affected = 0;
  for (const row of rows) {
    let arr;
    try {
      let val = row.col_val;
      // 解析值：可能是 Array、String（需二次解析）、或已是对象
      if (typeof val === 'string') {
        let parsed = JSON.parse(val);
        // 如果解析出来还是字符串（双重转义），再解析一层
        if (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }
        arr = parsed;
      } else if (Array.isArray(val)) {
        arr = val;
      } else {
        continue;
      }
      if (!Array.isArray(arr)) continue;
    } catch { continue; }

    // 检查数组中是否包含 oldName
    if (!arr.includes(oldName)) continue;

    // 精确替换：将 oldName 替换为 newName，然后去重
    const newArr = [...new Set(arr.map(v => v === oldName ? newName : v))];

    // 只在确实有变化时更新
    if (JSON.stringify(arr) === JSON.stringify(newArr)) continue;

    const hasUpdatedAt = tableName === 'work_records';
    const setClause = hasUpdatedAt
      ? `\`${columnName}\` = :newVal, updated_at = NOW()`
      : `\`${columnName}\` = :newVal`;

    const updateOpts = { replacements: { newVal: JSON.stringify(newArr), id: row.id } };
    if (transaction) updateOpts.transaction = transaction;

    await sequelize.query(
      `UPDATE \`${tableName}\` SET ${setClause} WHERE id = :id`,
      updateOpts
    );
    affected++;
  }
  return affected;
}

/**
 * 统计 PM 在系统中的关联引用数
 */
async function countPmReferences(pmName) {
  const records = await WorkRecord.findAll();
  let count = 0;
  for (const r of records) {
    if (recordBelongsToPmName(r, pmName)) count++;
  }
  return count;
}

module.exports = router;
