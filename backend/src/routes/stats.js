/**
 * Stats 路由 — 周期统计
 * GET  /api/stats?year=2026&quarter=Q2&taskId=xxx       部门统计
 * GET  /api/stats/personal/:staffId?year=2026&quarter=Q2&taskId=xxx 个人统计
 *
 * v1.1.0 改动:
 *   - 部门统计改为基于 WorkRecord + Staff role 聚合（REQ-11）
 *   - 新增按 PM 分组的工时统计数据（REQ-13）
 *   - 保留 matchGroups 用于明细表展示
 */
const express = require('express');
const router = express.Router();
const { CollectionTask, WorkRecord, MatchGroup, Staff, FillLink } = require('../models');
const { Op } = require('sequelize');
const { safeParseJsonArray } = require('../utils/parseJson');

/* 季度月份映射 */
const QUARTER_MONTHS = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12] };

/* 角色常量 */
const ROLE_KEYS = ['frontend', 'backend', 'test'];

/**
 * 获取指定月份的最后一天（安全日期计算）
 * @param {number} year  年份
 * @param {number} month 月份 (1-12)
 * @returns {string} YYYY-MM-DD 格式日期
 */
function getLastDayOfMonth(year, month) {
  // new Date(year, month, 0) 返回上月最后一天，
  // month 是 1-indexed，所以 new Date(y, m, 0) = m月最后一天
  const d = new Date(year, month, 0);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * 根据年份和季度计算日期范围
 */
function getDateRange(yearNum, quarter) {
  if (quarter && QUARTER_MONTHS[quarter]) {
    const months = QUARTER_MONTHS[quarter];
    const startFrom = `${yearNum}-${String(months[0]).padStart(2, '0')}-01`;
    const startTo = getLastDayOfMonth(yearNum, months[2]);
    return { startFrom, startTo };
  }
  return { startFrom: `${yearNum}-01-01`, startTo: `${yearNum}-12-31` };
}


/* GET /api/stats — 部门统计 */
router.get('/', async (req, res, next) => {
  try {
    const { year, quarter, taskId } = req.query;
    const yearNum = parseInt(year) || new Date().getFullYear();
    const { startFrom, startTo } = getDateRange(yearNum, quarter);

    // REQ-22 fix: 统一用 end_date 判定季度归属（与前端 task store 一致）|| 消除跨季度双重计算
    const tasks = await CollectionTask.findAll({
      where: {
        year: yearNum,
        end_date: { [Op.between]: [startFrom, startTo] }
      }
    });

    let taskIds = tasks.map(t => t.id);
    if (taskId && taskId !== 'all') taskIds = [taskId];

    const staff = await Staff.findAll({ where: { is_active: true } });

    // 空数组保护
    if (taskIds.length === 0) {
      return res.json({
        code: 0,
        data: {
          tasks: [], records: [], matchGroups: [], staff,
          summary: { totalHours: 0, recordCount: 0, staffCount: staff.length, taskCount: 0 },
          roleSummary: { frontend: 0, backend: 0, test: 0 },
          pmDistribution: []
        }
      });
    }

    // 获取 WorkRecord（关联 Staff 信息用于角色聚合）
    const records = await WorkRecord.findAll({
      where: { task_id: { [Op.in]: taskIds } },
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role'] }]
    });

    // matchGroups 仍用于明细表展示
    const matchGroups = await MatchGroup.findAll({ where: { task_id: { [Op.in]: taskIds } } });

    // === 基于 WorkRecord + Staff.role 的聚合统计（REQ-11） ===
    const totalHours = records.reduce((s, r) => s + parseFloat(r.hours || 0), 0);

    const roleSummary = { frontend: 0, backend: 0, test: 0 };
    for (const r of records) {
      const role = r.staff?.role;
      if (role && roleSummary[role] !== undefined) {
        roleSummary[role] += parseFloat(r.hours || 0);
      }
    }

    // === 按 PM 分组统计（REQ-13） ===
    // 每条 WorkRecord 有 product_managers 字段（JSON 数组），按第一个 PM 分组
    const pmMap = {};
    for (const r of records) {
      const pms = safeParseJsonArray(r.product_managers);
      const pmName = pms.length > 0 ? pms[0] : '未分配';
      if (!pmMap[pmName]) {
        pmMap[pmName] = { name: pmName, frontend: 0, backend: 0, test: 0, total: 0, records: [] };
      }
      const hours = parseFloat(r.hours || 0);
      const role = r.staff?.role;
      if (role && pmMap[pmName][role] !== undefined) {
        pmMap[pmName][role] += hours;
      }
      pmMap[pmName].total += hours;
      pmMap[pmName].records.push({
        id: r.id,
        version: r.version,
        requirement_title: r.requirement_title,
        hours: r.hours,
        role: role,
        staffName: r.staff?.name || '-'
      });
    }

    // v3.2.0: PM 行顺序按 product_managers 表的 sort_order 排序
    const { ProductManager } = require('../models');
    const pmSortOrders = await ProductManager.findAll({
      attributes: ['name', 'sort_order'],
      order: [['sort_order', 'ASC']]
    });
    const pmOrderMap = new Map();
    pmSortOrders.forEach((pm, idx) => { pmOrderMap.set(pm.name, pm.sort_order || idx); });

    const pmDistribution = Object.values(pmMap);
    pmDistribution.sort((a, b) => {
      const orderA = pmOrderMap.has(a.name) ? pmOrderMap.get(a.name) : 99999;
      const orderB = pmOrderMap.has(b.name) ? pmOrderMap.get(b.name) : 99999;
      return orderA - orderB;
    });

    // REQ-33: pmSort 控制每个 PM 内部的 records 按工时排序（PM 行位置不变）
    const pmSort = req.query.pmSort;
    if (pmSort === 'asc' || pmSort === 'desc') {
      for (const pm of pmDistribution) {
        pm.records.sort((a, b) => {
          const ha = parseFloat(a.hours || 0);
          const hb = parseFloat(b.hours || 0);
          return pmSort === 'asc' ? ha - hb : hb - ha;
        });
      }
    }

    res.json({
      code: 0,
      data: {
        tasks,
        records: records.map(r => {
          const plain = r.toJSON();
          plain.product_managers = safeParseJsonArray(plain.product_managers);
          return plain;
        }),
        matchGroups, staff,
        summary: {
          totalHours,
          recordCount: records.length,
          staffCount: staff.length,
          taskCount: tasks.length
        },
        roleSummary,
        pmDistribution
      }
    });
  } catch (err) { next(err); }
});

/* GET /api/stats/personal/:staffId — 个人统计 */
router.get('/personal/:staffId', async (req, res, next) => {
  try {
    const { staffId } = req.params;
    const { year, quarter, taskId } = req.query;
    const yearNum = parseInt(year) || new Date().getFullYear();
    const { startFrom, startTo } = getDateRange(yearNum, quarter);

    // 获取人员信息
    const staff = await Staff.findByPk(staffId);
    if (!staff) return res.status(404).json({ code: 1, message: '人员不存在' });

    // 获取时间范围内的任务
    // REQ-22 fix: 统一用 end_date 判定季度归属
    const tasks = await CollectionTask.findAll({
      where: {
        year: yearNum,
        end_date: { [Op.between]: [startFrom, startTo] }
      }
    });
    let taskIds = tasks.map(t => t.id);
    if (taskId && taskId !== 'all') {
      // 若选择了具体周期，则只看该周期（且必须属于当前筛选范围）
      if (!taskIds.includes(taskId)) {
        return res.json({
          code: 0,
          data: {
            staff,
            totalHours: 0,
            recordCount: 0,
            taskCount: 0,
            tasks: []
          }
        });
      }
      taskIds = [taskId];
    }

    if (taskIds.length === 0) {
      return res.json({
        code: 0,
        data: {
          staff,
          totalHours: 0,
          recordCount: 0,
          taskCount: 0,
          tasks: []
        }
      });
    }

    // 获取该人员在这些任务下的全部工时记录
    const records = await WorkRecord.findAll({
      where: {
        staff_id: staffId,
        task_id: { [Op.in]: taskIds }
      },
      order: [['created_at', 'DESC']]
    });

    // 按任务分组
    const taskMap = {};
    for (const t of tasks) {
      if (!taskIds.includes(t.id)) continue;
      taskMap[t.id] = { ...t.toJSON(), records: [] };
    }
    for (const r of records) {
      if (taskMap[r.task_id]) {
        const plain = r.toJSON();
        plain.product_managers = safeParseJsonArray(plain.product_managers);
        taskMap[r.task_id].records.push(plain);
      }
    }

    // v1.4.4: 展示所有任务周期（含无记录的），按 start_date 倒序
    const allTasks = Object.values(taskMap)
      .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    const tasksWithRecords = allTasks.filter(t => t.records.length > 0);
    const totalHours = records.reduce((s, r) => s + parseFloat(r.hours), 0);

    res.json({
      code: 0,
      data: {
        staff,
        totalHours,
        recordCount: records.length,
        taskCount: tasksWithRecords.length,
        tasks: allTasks
      }
    });
  } catch (err) { next(err); }
});

/* GET /api/stats/pm/:pmId — 产品经理聚焦统计 */
router.get('/pm/:pmId', async (req, res, next) => {
  try {
    const { pmId } = req.params;
    const { year, quarter, taskId } = req.query;
    const yearNum = parseInt(year) || new Date().getFullYear();
    const { startFrom, startTo } = getDateRange(yearNum, quarter);

    // 获取 PM 信息
    const { ProductManager } = require('../models');
    const pm = await ProductManager.findByPk(pmId);
    if (!pm) return res.status(404).json({ code: 1, message: '产品经理不存在' });

    // 获取时间范围内的任务
    const tasks = await CollectionTask.findAll({
      where: {
        year: yearNum,
        end_date: { [Op.between]: [startFrom, startTo] }
      }
    });
    let taskIds = tasks.map(t => t.id);
    if (taskId && taskId !== 'all') {
      if (!taskIds.includes(taskId)) {
        return res.json({
          code: 0,
          data: { pm: { id: pm.id, name: pm.name }, totalHours: 0, recordCount: 0, taskCount: 0, tasks: [] }
        });
      }
      taskIds = [taskId];
    }

    if (taskIds.length === 0) {
      return res.json({
        code: 0,
        data: { pm: { id: pm.id, name: pm.name }, totalHours: 0, recordCount: 0, taskCount: 0, tasks: [] }
      });
    }

    // 获取这些任务下的全部工时记录（关联 Staff 信息）
    const allRecords = await WorkRecord.findAll({
      where: { task_id: { [Op.in]: taskIds } },
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role'] }],
      order: [['created_at', 'DESC']]
    });

    // 过滤出包含该 PM 名称的记录
    const pmRecords = allRecords.filter(r => {
      const pms = safeParseJsonArray(r.product_managers);
      return pms.includes(pm.name);
    });

    // 按任务分组
    const taskMap = {};
    for (const t of tasks) {
      if (!taskIds.includes(t.id)) continue;
      taskMap[t.id] = { ...t.toJSON(), records: [] };
    }
    for (const r of pmRecords) {
      if (taskMap[r.task_id]) {
        const plain = r.toJSON();
        plain.product_managers = safeParseJsonArray(plain.product_managers);
        taskMap[r.task_id].records.push({
          id: plain.id,
          requirement_title: plain.requirement_title,
          version: plain.version,
          hours: plain.hours,
          staffName: r.staff?.name || '-',
          role: r.staff?.role || '-',
          product_managers: plain.product_managers
        });
      }
    }

    // 展示所有任务周期（含无记录的），按 start_date 倒序
    const allTasks = Object.values(taskMap)
      .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    const tasksWithRecords = allTasks.filter(t => t.records.length > 0);
    const totalHours = pmRecords.reduce((s, r) => s + parseFloat(r.hours || 0), 0);

    // 按角色汇总
    const roleSummary = { frontend: 0, backend: 0, test: 0 };
    for (const r of pmRecords) {
      const role = r.staff?.role;
      if (role && roleSummary[role] !== undefined) {
        roleSummary[role] += parseFloat(r.hours || 0);
      }
    }

    res.json({
      code: 0,
      data: {
        pm: { id: pm.id, name: pm.name },
        totalHours,
        recordCount: pmRecords.length,
        taskCount: tasksWithRecords.length,
        roleSummary,
        tasks: allTasks
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
