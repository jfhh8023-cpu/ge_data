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
    const pmDistribution = Object.values(pmMap);

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

module.exports = router;
