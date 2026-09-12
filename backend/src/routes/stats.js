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
const XLSX = require('xlsx');
const { CollectionTask, WorkRecord, ProductManagerWorkRecord, MatchGroup, Staff, ProductManager } = require('../models');
const { Op, fn, col } = require('sequelize');
const { safeParseJsonArray } = require('../utils/parseJson');
const {
  RESIGNED_STATUS,
  buildCurrentStatusPayload,
  collectPmNamesFromRecords,
  filterPmNamesForRecord,
  filterRecordsByStaffStatus,
  filterRecordsForPm,
  getPmStatusContextByName,
  isNonResigned
} = require('../services/PersonStatusService');
const {
  addRoleHours,
  createRoleSummary,
  getRoleDefinitions,
  normalizeStaffRole,
  withRoleAliases
} = require('../services/RoleService');
const { getDemandSourceDefinitions } = require('../services/DemandSourceService');

/* 季度月份映射 */
const QUARTER_MONTHS = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12] };

const PM_DEFAULT_NAME = '不在上述';
function recordBelongsToPm(pms, pmName) {
  return pms.includes(pmName) || (pmName === PM_DEFAULT_NAME && pms.length === 0);
}

function productManagersForPmResponse(pms, pmName) {
  return pmName === PM_DEFAULT_NAME && pms.length === 0 ? [PM_DEFAULT_NAME] : pms;
}

function normalizeDemandSourceWeights(value, sources, definitions = []) {
  const allowed = new Set(definitions.map(item => item.name));
  const sourceList = Array.isArray(sources) ? sources.filter(source => allowed.has(source)) : [];
  if (sourceList.length === 0) return {};
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  const values = sourceList.map(source => {
    const n = Number(parsed && typeof parsed === 'object' ? parsed[source] : NaN);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const total = values.reduce((sum, n) => sum + n, 0);
  if (total <= 0) {
    const equal = Number((100 / sourceList.length).toFixed(2));
    const weights = Object.fromEntries(sourceList.map(source => [source, equal]));
    weights[sourceList[sourceList.length - 1]] = Number((equal + 100 - equal * sourceList.length).toFixed(2));
    return weights;
  }
  const normalized = sourceList.map((source, index) => [source, Number((values[index] * 100 / total).toFixed(2))]);
  const roundedTotal = normalized.reduce((sum, [, n]) => sum + n, 0);
  normalized[normalized.length - 1][1] = Number((normalized[normalized.length - 1][1] + 100 - roundedTotal).toFixed(2));
  return Object.fromEntries(normalized);
}

function buildProductDemandDistribution(records, definitions = []) {
  const rows = Object.fromEntries(definitions.map(definition => [definition.name, {
    id: definition.id, name: definition.name, color: definition.color, total: 0, product: 0, recordCount: 0, records: []
  }]));
  for (const record of records) {
    const plain = record.toJSON ? record.toJSON() : record;
    const sourceById = new Map(definitions.map(definition => [definition.id, definition.name]));
    const legacyNames = safeParseJsonArray(plain.demand_sources);
    const ids = safeParseJsonArray(plain.demand_source_ids);
    const sources = (ids.length ? ids.map(id => sourceById.get(id)).filter(Boolean) : legacyNames).filter(source => rows[source]);
    const weights = normalizeDemandSourceWeights(plain.demand_source_weights, sources, definitions);
    const hours = parseFloat(plain.hours || 0);
    for (const source of sources) {
      const allocatedHours = hours * Number(weights[source] || 0) / 100;
      rows[source].total += allocatedHours;
      rows[source].product += allocatedHours;
      rows[source].recordCount += 1;
      rows[source].records.push({ id: plain.id, staffName: plain.staff?.name || '-', requirement_title: plain.requirement_title, version: plain.version || '-', hours: allocatedHours, originalHours: hours, delivery_progress: plain.delivery_progress });
    }
  }
  return Object.values(rows).map(row => ({
    ...row,
    total: Number(row.total.toFixed(2)),
    product: Number(row.product.toFixed(2)),
    records: row.records.map(record => ({ ...record, hours: Number(record.hours.toFixed(2)) }))
  }));
}

function versionTypeOf(record) {
  const value = String(record?.version || '').trim();
  return value && value !== '-' ? 'versioned' : 'no_version';
}

function safeExcelText(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function currentNaturalWeekStart(date = new Date()) {
  const result = new Date(date);
  const day = result.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - daysFromMonday);
  return result;
}

function taskDateValue(task) {
  const value = task?.end_date || task?.start_date;
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const parsed = new Date(`${text}T23:59:59`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isHistoricalNaturalWeekTask(task) {
  const taskDate = taskDateValue(task);
  return Boolean(taskDate && taskDate < currentNaturalWeekStart());
}

function applyHistoricalProgress(record, task) {
  if (!isHistoricalNaturalWeekTask(task)) return record;
  return {
    ...record,
    delivery_progress: 100,
    progress_status: '已完成',
    historical_progress_override: true
  };
}

async function loadScopedStatRecords({ scope = 'current', year, quarter, taskId } = {}) {
  const yearNum = parseInt(year) || new Date().getFullYear();
  const range = getDateRange(yearNum, quarter);
  const taskWhere = scope === 'all' ? {} : {
    year: yearNum,
    end_date: { [Op.between]: [range.startFrom, range.startTo] }
  };
  const tasks = await CollectionTask.findAll({ where: taskWhere, order: [['end_date', 'DESC']] });
  let taskIds = tasks.map(task => task.id);
  if (taskId && taskId !== 'all') taskIds = taskIds.includes(taskId) ? [taskId] : [];
  const taskById = new Map(tasks.map(task => [task.id, task]));
  if (!taskIds.length) return { tasks, records: [], demandSources: await getDemandSourceDefinitions() };
  const [engineeringRows, productRows] = await Promise.all([
    WorkRecord.findAll({ where: { task_id: { [Op.in]: taskIds } }, include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role'] }] }),
    ProductManagerWorkRecord.findAll({ where: { task_id: { [Op.in]: taskIds } }, include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role'] }] })
  ]);
  const visibleEngineeringRows = await filterRecordsByStaffStatus(engineeringRows, taskById);
  const visibleProductRows = await filterRecordsByStaffStatus(productRows, taskById);
  const demandSources = await getDemandSourceDefinitions();
  const productNames = new Set(demandSources.map(item => item.name));
  const records = [];
  for (const row of [...visibleEngineeringRows, ...visibleProductRows]) {
    const plain = applyHistoricalProgress(row.toJSON(), taskById.get(row.task_id));
    const isProduct = row instanceof ProductManagerWorkRecord || Array.isArray(plain.demand_sources);
    plain.is_product_manager_record = isProduct;
    plain.source_type = isProduct ? 'product_manager' : 'engineering';
    const sourceById = new Map(demandSources.map(item => [item.id, item.name]));
    const names = safeParseJsonArray(plain.demand_sources);
    const ids = safeParseJsonArray(plain.demand_source_ids);
    plain.demand_sources = isProduct
      ? (ids.length ? ids.map(id => sourceById.get(id)).filter(Boolean) : names).filter(name => productNames.has(name))
      : [];
    if (!isProduct) plain.product_managers = safeParseJsonArray(plain.product_managers);
    records.push(plain);
  }
  return { tasks, records, demandSources };
}

function filterScopedRecords(records, query, definitions) {
  const sourceType = String(query.sourceType || '').trim();
  const versionType = String(query.versionType || '').trim();
  const staffId = String(query.staffId || '').trim();
  const demandSourceId = String(query.demandSourceId || '').trim();
  const sourceName = definitions.find(item => item.id === demandSourceId)?.name || demandSourceId;
  return records.filter(record => {
    if (sourceType && record.source_type !== sourceType) return false;
    if (versionType && versionTypeOf(record) !== versionType) return false;
    if (staffId && String(record.staff_id || record.staff?.id) !== staffId) return false;
    if (sourceName && !record.demand_sources.includes(sourceName)) return false;
    return true;
  });
}

function buildProgressDetails(records) {
  const valid = records.filter(record => Number(record.hours) > 0 && Number.isFinite(Number(record.delivery_progress)));
  const totalHours = valid.reduce((sum, record) => sum + Number(record.hours), 0);
  const weightedHours = valid.reduce((sum, record) => sum + Number(record.hours) * Number(record.delivery_progress), 0);
  return {
    records: records.map(record => ({
      ...record,
      progress_status: record.delivery_progress === null || record.delivery_progress === undefined || record.delivery_progress === ''
        ? '未填写' : Number(record.delivery_progress) >= 100 ? '已完成' : Number(record.delivery_progress) > 0 ? '部分完成' : '未开始'
    })),
    weightedProgress: totalHours > 0 ? Number((weightedHours / totalHours).toFixed(2)) : null,
    effectiveHours: Number(totalHours.toFixed(2)),
    missingProgressCount: records.filter(record => record.delivery_progress === null || record.delivery_progress === undefined || record.delivery_progress === '').length,
    formula: 'Σ(有效工时×进度)÷Σ有效工时；有效工时必须大于0且进度为数值；历史空进度不进入分母。示例：10h×100%+2h×50%=91.67%'
  };
}

async function getFilteredScopeData(req) {
  const scopeData = await loadScopedStatRecords({
    scope: req.query.scope === 'all' ? 'all' : 'current',
    year: req.query.year,
    quarter: req.query.quarter,
    taskId: req.query.taskId
  });
  const records = filterScopedRecords(scopeData.records, req.query, scopeData.demandSources);
  return { ...scopeData, records };
}

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
    const demandSources = await getDemandSourceDefinitions();
    const yearNum = parseInt(year) || new Date().getFullYear();
    const { startFrom, startTo } = getDateRange(yearNum, quarter);

    // REQ-22 fix: 统一用 end_date 判定季度归属（与前端 task store 一致）|| 消除跨季度双重计算
    const tasks = await CollectionTask.findAll({
      where: {
        year: yearNum,
        end_date: { [Op.between]: [startFrom, startTo] }
      },
      attributes: {
        include: [
          [fn('COUNT', col('records.id')), 'record_count']
        ]
      },
      include: [{ model: WorkRecord, as: 'records', attributes: [] }],
      group: ['collection_tasks.id'],
      subQuery: false
    });

    let taskIds = tasks.map(t => t.id);
    const taskIdOutOfRange = taskId && taskId !== 'all' && !taskIds.includes(taskId);
    if (taskId && taskId !== 'all' && !taskIdOutOfRange) taskIds = [taskId];

    const currentStaffRows = await Staff.findAll({
      where: { employment_status: { [Op.ne]: RESIGNED_STATUS } },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
    });
    const currentStaff = currentStaffRows.map(s => ({ ...s.toJSON(), ...buildCurrentStatusPayload(s) }));
    const roleDefinitions = getRoleDefinitions();

    // 空数组保护
    if (taskIds.length === 0 || taskIdOutOfRange) {
      return res.json({
        code: 0,
        data: {
          tasks, records: [], matchGroups: [], staff: currentStaff,
          currentStaff, roleDefinitions,
          summary: { totalHours: 0, recordCount: 0, staffCount: currentStaff.length, taskCount: 0 },
          roleSummary: withRoleAliases(createRoleSummary()),
          pmDistribution: [],
          demandSources,
          productDemandDistribution: buildProductDemandDistribution([], demandSources)
        }
      });
    }

    // 获取 WorkRecord（关联 Staff 信息用于角色聚合）
    const allRecords = await WorkRecord.findAll({
      where: { task_id: { [Op.in]: taskIds } },
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }]
    });
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const records = await filterRecordsByStaffStatus(allRecords, taskById);
    const allProductRecords = await ProductManagerWorkRecord.findAll({
      where: { task_id: { [Op.in]: taskIds } },
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }]
    });
    const productManagerRecords = await filterRecordsByStaffStatus(allProductRecords, taskById);
    const allStatRecords = [...records, ...productManagerRecords];
    const pmContextByName = await getPmStatusContextByName(collectPmNamesFromRecords(records));

    const staffById = new Map(currentStaff.map(s => [s.id, s]));
    for (const record of allStatRecords) {
      const staffPlain = record.staff?.toJSON ? record.staff.toJSON() : record.staff;
      if (staffPlain?.id && !staffById.has(staffPlain.id)) {
        staffById.set(staffPlain.id, { ...staffPlain, ...buildCurrentStatusPayload(staffPlain) });
      }
    }
    const visibleStaff = [...staffById.values()]
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));

    // matchGroups 仍用于明细表展示
    const matchGroups = await MatchGroup.findAll({ where: { task_id: { [Op.in]: taskIds } } });

    // === 基于 WorkRecord + Staff.role 的聚合统计（REQ-11） ===
    const totalHours = allStatRecords.reduce((s, r) => s + parseFloat(r.hours || 0), 0);

    const roleSummary = createRoleSummary();
    for (const r of allStatRecords) {
      addRoleHours(roleSummary, r.staff?.role, parseFloat(r.hours || 0));
    }

    // === 按 PM 分组统计（REQ-13） ===
    // v3.2.1: 先从 product_managers 表预初始化所有当前非离职 PM
    const activePms = await ProductManager.findAll({
      where: { employment_status: { [Op.ne]: RESIGNED_STATUS } },
      attributes: ['id', 'name', 'sort_order', 'employment_status', 'is_active', 'status_changed_at'],
      order: [['sort_order', 'ASC']]
    });
    const pmMap = {};
    for (const pm of activePms) {
      pmMap[pm.name] = { id: pm.id, name: pm.name, ...withRoleAliases(createRoleSummary()), total: 0, records: [] };
    }

    // 每条 WorkRecord 有 product_managers 字段（JSON 数组），按第一个 PM 分组
    for (const r of records) {
      const rawPms = safeParseJsonArray(r.product_managers);
      const visiblePms = await filterPmNamesForRecord(r, taskById.get(r.task_id), pmContextByName);
      if (rawPms.length > 0 && visiblePms.length === 0) continue;
      const pmName = visiblePms.length > 0 ? visiblePms[0] : PM_DEFAULT_NAME;
      if (!pmMap[pmName]) {
        const pmEntity = pmContextByName.get(pmName)?.pm;
        pmMap[pmName] = { id: pmEntity?.id || null, name: pmName, ...withRoleAliases(createRoleSummary()), total: 0, records: [] };
      }
      const hours = parseFloat(r.hours || 0);
      const role = normalizeStaffRole(r.staff?.role);
      addRoleHours(pmMap[pmName], role, hours);
      Object.assign(pmMap[pmName], withRoleAliases(pmMap[pmName]));
      pmMap[pmName].total += hours;
      const historicalProgress = isHistoricalNaturalWeekTask(taskById.get(r.task_id)) ? 100 : r.delivery_progress;
      pmMap[pmName].records.push({
        id: r.id,
        version: r.version,
        requirement_title: r.requirement_title,
        hours: r.hours,
        delivery_progress: historicalProgress,
        role,
        staffName: r.staff?.name || '-'
      });
    }

    // v3.2.1: PM 排序（复用 activePms 查询结果，避免重复查库）
    const pmOrderMap = new Map();
    activePms.forEach((pm, idx) => { pmOrderMap.set(pm.name, pm.sort_order || idx); });

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
        records: await Promise.all(allStatRecords.map(async r => {
          const plain = applyHistoricalProgress(r.toJSON(), taskById.get(r.task_id));
          plain.is_product_manager_record = r instanceof ProductManagerWorkRecord || Array.isArray(plain.demand_sources);
          if (plain.is_product_manager_record) {
            plain.demand_sources = safeParseJsonArray(plain.demand_sources);
            plain.product_managers = [];
          } else {
            plain.product_managers = await filterPmNamesForRecord(r, taskById.get(r.task_id), pmContextByName);
          }
          return plain;
        })),
        demandSources,
        productManagerRecords: productManagerRecords.map(r => {
          const plain = applyHistoricalProgress(r.toJSON(), taskById.get(r.task_id));
          const sources = safeParseJsonArray(plain.demand_sources);
          const sourceById = new Map(demandSources.map(item => [item.id, item.name]));
          const sourceIds = safeParseJsonArray(plain.demand_source_ids);
          const names = sourceIds.length ? sourceIds.map(id => sourceById.get(id)).filter(Boolean) : sources;
          return { ...plain, is_product_manager_record: true, demand_sources: names, demand_source_ids: sourceIds, demand_source_weights: normalizeDemandSourceWeights(plain.demand_source_weights, names, demandSources) };
        }),
        productDemandDistribution: buildProductDemandDistribution(productManagerRecords, demandSources),
        matchGroups, staff: visibleStaff, currentStaff, roleDefinitions,
        summary: {
          totalHours,
          recordCount: allStatRecords.length,
          staffCount: currentStaff.length,
          taskCount: taskIds.length
        },
        roleSummary: withRoleAliases(roleSummary),
        pmDistribution
      }
    });
  } catch (err) { next(err); }
});

/* GET /api/stats/progress-details — 统一详情与进度明细（REQ-055） */
router.get('/progress-details', async (req, res, next) => {
  try {
    const { tasks, records, demandSources } = await getFilteredScopeData(req);
    const detail = buildProgressDetails(records);
    res.json({
      code: 0,
      data: {
        scope: req.query.scope === 'all' ? 'all' : 'current',
        scopeMeta: { year: req.query.year || null, quarter: req.query.quarter || null, taskId: req.query.taskId || 'all', taskCount: tasks.length },
        demandSources,
        ...detail
      }
    });
  } catch (err) { next(err); }
});

/* GET /api/stats/export.xlsx — 服务端只读详情导出（REQ-055） */
router.get('/export.xlsx', async (req, res, next) => {
  try {
    const { tasks, records, demandSources } = await getFilteredScopeData(req);
    const detail = buildProgressDetails(records);
    const scope = req.query.scope === 'all' ? '全部可见历史' : '当前统计范围';
    const metaRows = [
      ['数据范围', scope], ['年份', req.query.year || '全部'], ['季度', req.query.quarter || '全部'],
      ['任务', req.query.taskId || '全部'], ['来源', req.query.sourceType || '全部'],
      ['版本分组', req.query.versionType || '全部'], ['需求方筛选', req.query.demandSourceId || '全部'],
      ['综合进度', detail.weightedProgress == null ? '-' : `${detail.weightedProgress}%`],
      ['有效工时', detail.effectiveHours], ['未填写进度记录数', detail.missingProgressCount], ['计算公式', detail.formula]
    ];
    const rows = records.map(record => ({
      来源: record.source_type === 'product_manager' ? 'AI产品经理' : '研发',
      人员: record.staff?.name || '-', 岗位: record.staff?.role || '-',
      周期: tasks.find(task => task.id === record.task_id)?.title || record.task_id || '-',
      版本号: versionTypeOf(record) === 'no_version' ? '无版本号' : record.version,
      需求名称: record.requirement_title || '-',
      需求方: record.demand_sources.join('、') || '-', 工时: Number(record.hours || 0),
      交付进度: record.delivery_progress === null || record.delivery_progress === undefined ? '-' : `${record.delivery_progress}%`,
      状态: record.progress_status
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaRows), '导出说明');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' ? safeExcelText(value) : value])))), '进度明细');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(demandSources.map(source => ({ ID: source.id, 需求方: source.name, 颜色: source.color, 启用: source.is_active ? '是' : '否' }))), '需求方目录快照');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`工时进度追踪_${req.query.scope === 'all' ? '全部' : '当前'}.xlsx`)}`);
    res.send(buffer);
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
            tasks: [], roleDefinitions: getRoleDefinitions()
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
          tasks: [], roleDefinitions: getRoleDefinitions()
        }
      });
    }

    // 获取该人员在这些任务下的全部工时记录，并按人员/PM 状态过滤
    const RecordModel = String(staff.role || '') === 'ai_pm' ? ProductManagerWorkRecord : WorkRecord;
    const allRecords = await RecordModel.findAll({
      where: {
        staff_id: staffId,
        task_id: { [Op.in]: taskIds }
      },
      order: [['created_at', 'DESC']]
    });
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const records = await filterRecordsByStaffStatus(allRecords, taskById);
    if (!isNonResigned(staff) && records.length === 0) {
      return res.json({
        code: 0,
        data: {
          staff: null,
          totalHours: 0,
          recordCount: 0,
          taskCount: 0,
          tasks: [], roleDefinitions: getRoleDefinitions()
        }
      });
    }
    const pmContextByName = await getPmStatusContextByName(collectPmNamesFromRecords(records));

    // 按任务分组
    const taskMap = {};
    for (const t of tasks) {
      if (!taskIds.includes(t.id)) continue;
      taskMap[t.id] = { ...t.toJSON(), records: [] };
    }
    for (const r of records) {
      if (taskMap[r.task_id]) {
        const plain = r.toJSON();
        plain.product_managers = String(staff.role || '') === 'ai_pm'
          ? []
          : await filterPmNamesForRecord(r, taskById.get(r.task_id), pmContextByName);
        if (String(staff.role || '') === 'ai_pm') plain.demand_sources = safeParseJsonArray(plain.demand_sources);
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
        tasks: allTasks,
        roleDefinitions: getRoleDefinitions()
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
    const pm = await ProductManager.findByPk(pmId);
    if (!pm) return res.status(404).json({ code: 1, message: 'AI产品经理不存在' });

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
          data: { pm: { id: pm.id, name: pm.name }, totalHours: 0, recordCount: 0, taskCount: 0, tasks: [], roleDefinitions: getRoleDefinitions() }
        });
      }
      taskIds = [taskId];
    }

    if (taskIds.length === 0) {
      return res.json({
        code: 0,
        data: { pm: { id: pm.id, name: pm.name }, totalHours: 0, recordCount: 0, taskCount: 0, tasks: [], roleDefinitions: getRoleDefinitions() }
      });
    }

    // 获取这些任务下的全部工时记录（关联 Staff 信息）
    const allRecords = await WorkRecord.findAll({
      where: { task_id: { [Op.in]: taskIds } },
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }],
      order: [['created_at', 'DESC']]
    });
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const statusAllowedRecords = await filterRecordsByStaffStatus(allRecords, taskById);

    // 过滤出包含该 PM 名称且 PM 状态在任务日期允许统计的记录
    const pmRecords = await filterRecordsForPm(statusAllowedRecords, pm, taskById);
    if (!isNonResigned(pm) && pmRecords.length === 0) {
      return res.json({
        code: 0,
        data: { pm: null, totalHours: 0, recordCount: 0, taskCount: 0, tasks: [], roleDefinitions: getRoleDefinitions() }
      });
    }

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
        plain.product_managers = productManagersForPmResponse(plain.product_managers, pm.name);
        taskMap[r.task_id].records.push({
          id: plain.id,
          requirement_title: plain.requirement_title,
          version: plain.version,
          hours: plain.hours,
          staffName: r.staff?.name || '-',
          role: normalizeStaffRole(r.staff?.role, '-'),
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
    const roleSummary = createRoleSummary();
    for (const r of pmRecords) {
      addRoleHours(roleSummary, r.staff?.role, parseFloat(r.hours || 0));
    }

    res.json({
      code: 0,
      data: {
        pm: { id: pm.id, name: pm.name },
        totalHours,
        recordCount: pmRecords.length,
        taskCount: tasksWithRecords.length,
        roleSummary: withRoleAliases(roleSummary),
        roleDefinitions: getRoleDefinitions(),
        tasks: allTasks
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
