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
  filterMatchGroupsByStaffStatus,
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
const { buildWorkHours, getWorkHours, loadWorkHoursContext } = require('../services/WorkHoursCompletionService');
const { buildDeliverySummary, hasValidVersion, versionTypeOf } = require('../services/DeliverySummaryService');
const { isFullCreditRecord } = require('../services/EffectiveHoursService');

/* 季度月份映射 */
const QUARTER_MONTHS = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12] };

const PM_DEFAULT_NAME = '不在上述';
const RECORD_CREATION_ORDER = [['created_at', 'DESC'], ['id', 'ASC']];

function compareRecordCreationDesc(left, right) {
  const timestamp = record => {
    if (!record?.created_at) return Number.NEGATIVE_INFINITY;
    const value = new Date(record.created_at).getTime();
    return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  };
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1;
  const leftId = String(left?.id || '');
  const rightId = String(right?.id || '');
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

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

function resolveRecordDemandSources(record, definitions = []) {
  const sourceById = new Map(definitions.map(source => [source.id, source.name]));
  const allowedNames = new Set(definitions.map(source => source.name));
  const legacyNames = safeParseJsonArray(record.demand_sources);
  const ids = safeParseJsonArray(record.demand_source_ids);
  let savedWeights = record.demand_source_weights;
  if (typeof savedWeights === 'string') {
    try { savedWeights = JSON.parse(savedWeights); } catch { savedWeights = {}; }
  }
  if (!savedWeights || typeof savedWeights !== 'object' || Array.isArray(savedWeights)) savedWeights = {};
  const sources = [];
  const renamedWeights = Object.create(null);
  const entries = ids.length
    ? ids.map((id, index) => ({ id, name: sourceById.get(id), previousName: legacyNames[index] }))
    : legacyNames.map(name => ({ name, previousName: name }));
  for (const entry of entries) {
    if (!entry.name || !allowedNames.has(entry.name) || sources.includes(entry.name)) continue;
    sources.push(entry.name);
    // IDs and saved names describe the same ordered selection. A catalogue rename must
    // carry the saved weight to its new label instead of resetting the row to equal shares.
    const candidates = [entry.id, entry.previousName, entry.name].filter(Boolean);
    const weightKey = candidates.find(key => Object.prototype.hasOwnProperty.call(savedWeights, key));
    if (weightKey !== undefined) renamedWeights[entry.name] = savedWeights[weightKey];
  }
  return { sources, ids, weights: normalizeDemandSourceWeights(renamedWeights, sources, definitions) };
}

function buildProductDemandDistribution(records, definitions = []) {
  const rows = Object.fromEntries(definitions.map(definition => [definition.name, {
    id: definition.id, name: definition.name, color: definition.color, total: 0, product: 0, recordCount: 0, records: []
  }]));
  for (const record of records) {
    const plain = record.toJSON ? record.toJSON() : record;
    const { sources, weights } = resolveRecordDemandSources(plain, definitions);
    const hours = parseFloat(plain.hours || 0);
    for (const source of sources) {
      const allocatedHours = hours * Number(weights[source] || 0) / 100;
      rows[source].total += allocatedHours;
      rows[source].product += allocatedHours;
      rows[source].recordCount += 1;
      rows[source].records.push({ id: plain.id, created_at: plain.created_at, staffName: plain.staff?.name || '-', requirement_title: plain.requirement_title, version: plain.version || '-', hours: allocatedHours, originalHours: hours, delivery_progress: normalizeProgress(plain.delivery_progress) });
    }
  }
  return Object.values(rows).map(row => {
    const records = row.records.sort(compareRecordCreationDesc);
    return {
      ...row,
      total: Number(row.total.toFixed(2)),
      product: Number(row.product.toFixed(2)),
      latest_created_at: records[0]?.created_at || null,
      records: records.map(record => ({ ...record, hours: Number(record.hours.toFixed(2)) }))
    };
  });
}

function normalizeProgress(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const progress = Number(value);
  return Number.isFinite(progress) && progress >= 0 && progress <= 100 ? progress : null;
}

function safeExcelText(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
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
  if (scope !== 'all' && taskId && taskId !== 'all') taskIds = taskIds.includes(taskId) ? [taskId] : [];
  const selectedTasks = tasks.filter(task => taskIds.includes(task.id));
  const taskById = new Map(selectedTasks.map(task => [task.id, task]));
  if (!taskIds.length) return { tasks: selectedTasks, records: [], demandSources: await getDemandSourceDefinitions() };
  const [engineeringRows, productRows] = await Promise.all([
    WorkRecord.findAll({ where: { task_id: { [Op.in]: taskIds } }, include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role'] }], order: RECORD_CREATION_ORDER }),
    ProductManagerWorkRecord.findAll({ where: { task_id: { [Op.in]: taskIds } }, include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role'] }], order: RECORD_CREATION_ORDER })
  ]);
  const visibleEngineeringRows = await filterRecordsByStaffStatus(engineeringRows, taskById);
  const visibleProductRows = await filterRecordsByStaffStatus(productRows, taskById);
  const demandSources = await getDemandSourceDefinitions();
  const records = [];
  for (const row of [...visibleEngineeringRows, ...visibleProductRows].sort(compareRecordCreationDesc)) {
    const plain = row.toJSON();
    plain.delivery_progress = normalizeProgress(plain.delivery_progress);
    const isProduct = row instanceof ProductManagerWorkRecord || Array.isArray(plain.demand_sources);
    plain.is_product_manager_record = isProduct;
    plain.source_type = isProduct ? 'product_manager' : 'engineering';
    if (isProduct) {
      const resolvedSources = resolveRecordDemandSources(plain, demandSources);
      plain.demand_sources = resolvedSources.sources;
      plain.demand_source_ids = resolvedSources.ids;
      plain.demand_source_weights = resolvedSources.weights;
    } else plain.demand_sources = [];
    if (!isProduct) plain.product_managers = safeParseJsonArray(plain.product_managers);
    records.push(plain);
  }
  return { tasks: selectedTasks, records, demandSources };
}

function filterScopedRecords(records, query, definitions) {
  const sourceType = String(query.sourceType || '').trim();
  const versionType = String(query.versionType || '').trim();
  const staffId = String(query.staffId || '').trim();
  const role = String(query.role || '').trim();
  const demandSourceId = String(query.demandSourceId || '').trim();
  const sourceName = demandSourceId && demandSourceId !== 'all'
    ? definitions.find(item => item.id === demandSourceId)?.name || demandSourceId : '';
  return records.filter(record => {
    if (sourceType && sourceType !== 'all' && record.source_type !== sourceType) return false;
    if (versionType && versionType !== 'all' && versionTypeOf(record) !== versionType) return false;
    if (staffId && staffId !== 'all' && String(record.staff_id || record.staff?.id) !== staffId) return false;
    if (role && role !== 'all' && normalizeStaffRole(record.staff?.role, '') !== normalizeStaffRole(role, '')) return false;
    if (sourceName && !record.demand_sources.includes(sourceName)) return false;
    return true;
  }).map(record => {
    if (!sourceName) return record;
    const weights = normalizeDemandSourceWeights(record.demand_source_weights, record.demand_sources, definitions);
    return { ...record, originalHours: Number(record.hours || 0),
      hours: Number(record.hours || 0) * Number(weights[sourceName] || 0) / 100,
      demand_source_weights: weights };
  });
}

function buildProgressDetails(records, deliverySummary) {
  records = [...records].sort(compareRecordCreationDesc);
  return {
    records: records.map(record => {
      // REQ-071: a five-category row without a saved progress reads as its default 100; the stored value is untouched.
      const progress = isFullCreditRecord(record) ? normalizeProgress(record.delivery_progress) ?? 100 : normalizeProgress(record.delivery_progress);
      return {
        ...record,
        delivery_progress: progress,
        progress_status: progress === null ? '未填写' : progress >= 100 ? '已完成' : progress > 0 ? '部分完成' : '未开始'
      };
    }),
    weightedProgress: deliverySummary.requirementProgress,
    effectiveHours: deliverySummary.progressKnownHours,
    missingProgressCount: deliverySummary.missingProgressCount,
    formula: deliverySummary.formula
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
  const workHours = await getWorkHours({ tasks: scopeData.tasks, records, query: req.query });
  const deliverySummary = buildDeliverySummary(records, workHours);
  return { ...scopeData, records, workHours, deliverySummary };
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
          tasks, records: [], matchGroups: [], staff: [],
          currentStaff: [], roleDefinitions,
          workHours: buildWorkHours(),
          deliverySummary: buildDeliverySummary([], buildWorkHours()),
          summary: { totalHours: 0, recordCount: 0, staffCount: 0, taskCount: 0 },
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
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }],
      order: RECORD_CREATION_ORDER
    });
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const records = (await filterRecordsByStaffStatus(allRecords, taskById)).sort(compareRecordCreationDesc);
    const allProductRecords = await ProductManagerWorkRecord.findAll({
      where: { task_id: { [Op.in]: taskIds } },
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }],
      order: RECORD_CREATION_ORDER
    });
    const productManagerRecords = (await filterRecordsByStaffStatus(allProductRecords, taskById)).sort(compareRecordCreationDesc);
    const allStatRecords = [...records, ...productManagerRecords].sort(compareRecordCreationDesc);
    const selectedTasks = tasks.filter(task => taskIds.includes(task.id));
    const workHoursContext = await loadWorkHoursContext({ tasks: selectedTasks });
    const workHours = buildWorkHours({ ...workHoursContext, records: allStatRecords });
    const deliverySummary = buildDeliverySummary(allStatRecords, workHours);
    const pmContextByName = await getPmStatusContextByName(collectPmNamesFromRecords(records));

    const recordedStaffIds = new Set(allStatRecords.map(record => String(record.staff_id)));
    const staffById = new Map(currentStaff.filter(person => recordedStaffIds.has(String(person.id))).map(s => [s.id, s]));
    for (const record of allStatRecords) {
      const staffPlain = record.staff?.toJSON ? record.staff.toJSON() : record.staff;
      if (staffPlain?.id && !staffById.has(staffPlain.id)) {
        staffById.set(staffPlain.id, { ...staffPlain, ...buildCurrentStatusPayload(staffPlain) });
      }
    }
    const visibleStaff = [...staffById.values()]
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));

    // matchGroups 仍用于明细表展示
    const matchGroups = await filterMatchGroupsByStaffStatus(await MatchGroup.findAll({ where: { task_id: { [Op.in]: taskIds } } }));

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
      pmMap[pmName].records.push({
        id: r.id,
        created_at: r.created_at,
        version: r.version,
        requirement_title: r.requirement_title,
        hours: r.hours,
        delivery_progress: normalizeProgress(r.delivery_progress),
        role,
        staffName: r.staff?.name || '-'
      });
    }

    // v3.2.1: PM 排序（复用 activePms 查询结果，避免重复查库）
    const pmOrderMap = new Map();
    activePms.forEach((pm, idx) => { pmOrderMap.set(pm.name, pm.sort_order || idx); });

    const pmDistribution = Object.values(pmMap);
    for (const pm of pmDistribution) {
      pm.records.sort(compareRecordCreationDesc);
      pm.latest_created_at = pm.records[0]?.created_at || null;
    }
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
          return (pmSort === 'asc' ? ha - hb : hb - ha) || compareRecordCreationDesc(a, b);
        });
      }
    }

    res.json({
      code: 0,
      data: {
        tasks: tasks.map(task => {
          if (!taskIds.includes(task.id)) return task;
          const taskWorkHours = buildWorkHours({ ...workHoursContext, tasks: [task], records: allStatRecords });
          return { ...task.toJSON(), workHours: taskWorkHours,
            deliverySummary: buildDeliverySummary(allStatRecords, taskWorkHours) };
        }),
        workHours,
        deliverySummary,
        records: await Promise.all(allStatRecords.map(async r => {
          const plain = r.toJSON();
          plain.delivery_progress = normalizeProgress(plain.delivery_progress);
          plain.is_product_manager_record = r instanceof ProductManagerWorkRecord || Array.isArray(plain.demand_sources);
          if (plain.is_product_manager_record) {
            const resolvedSources = resolveRecordDemandSources(plain, demandSources);
            plain.demand_sources = resolvedSources.sources;
            plain.demand_source_ids = resolvedSources.ids;
            plain.demand_source_weights = resolvedSources.weights;
            plain.product_managers = [];
          } else {
            plain.product_managers = await filterPmNamesForRecord(r, taskById.get(r.task_id), pmContextByName);
          }
          return plain;
        })),
        demandSources,
        productManagerRecords: productManagerRecords.map(r => {
          const plain = r.toJSON();
          plain.delivery_progress = normalizeProgress(plain.delivery_progress);
          const resolvedSources = resolveRecordDemandSources(plain, demandSources);
          return { ...plain, is_product_manager_record: true, demand_sources: resolvedSources.sources,
            demand_source_ids: resolvedSources.ids, demand_source_weights: resolvedSources.weights };
        }),
        productDemandDistribution: buildProductDemandDistribution(productManagerRecords, demandSources),
        matchGroups, staff: visibleStaff, currentStaff: visibleStaff, roleDefinitions,
        summary: {
          totalHours,
          recordCount: allStatRecords.length,
          staffCount: visibleStaff.length,
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
    const { tasks, records, demandSources, workHours, deliverySummary } = await getFilteredScopeData(req);
    const detail = buildProgressDetails(records, deliverySummary);
    res.json({
      code: 0,
      data: {
        scope: req.query.scope === 'all' ? 'all' : 'current',
        scopeMeta: { year: req.query.scope === 'all' ? null : req.query.year || null,
          quarter: req.query.scope === 'all' ? null : req.query.quarter || null,
          taskId: req.query.scope === 'all' ? 'all' : req.query.taskId || 'all', taskCount: tasks.length },
        demandSources,
        tasks,
        workHours,
        deliverySummary,
        ...detail
      }
    });
  } catch (err) { next(err); }
});

/* GET /api/stats/export.xlsx — 服务端只读详情导出（REQ-055） */
router.get('/export.xlsx', async (req, res, next) => {
  try {
    const { tasks, records, demandSources, workHours, deliverySummary } = await getFilteredScopeData(req);
    const detail = buildProgressDetails(records, deliverySummary);
    const scope = req.query.scope === 'all' ? '全部可见历史' : '当前统计范围';
    const recordsOnly = String(req.query.versionType || '').trim() === 'no_version';
    const metaRows = [
      ['数据范围', scope], ['年份', req.query.scope === 'all' ? '全部' : req.query.year || new Date().getFullYear()],
      ['季度', req.query.scope === 'all' ? '全部' : req.query.quarter || '全部'],
      ['任务', req.query.scope === 'all' ? '全部' : req.query.taskId || '全部'], ['来源', req.query.sourceType || '全部'],
      ['版本分组', req.query.versionType || '全部'], ['需求方筛选', req.query.demandSourceId || '全部'],
      ['岗位筛选', req.query.role || '全部'], ['人员筛选', req.query.staffId || '全部'],
      ['有效已交付', deliverySummary.deliveredHours],
      ['有效交付率', recordsOnly ? '仅记录，不计交付率' : deliverySummary.deliveryRate == null
        ? (deliverySummary.calendarStatus === 'invalid_period' ? '基准不完整，暂不计算' : '无应填工时')
        : `${deliverySummary.deliveryRate}%`],
      ['加权交付率', deliverySummary.weightedDeliveryRate == null
        ? (deliverySummary.calendarStatus === 'invalid_period' ? '基准不完整，暂不计算' : '无应填工时')
        : `${deliverySummary.weightedDeliveryRate}%`],
      ['五类有效工时', deliverySummary.fullCreditHours],
      ['加权有效已交付', deliverySummary.weightedDeliveredHours],
      ['历史空进度兼容', '仅在加权交付计算中按100%；原始值仍为空，明确0%仍按0%，覆盖率仍反映真实填报'],
      ['需求填报进度', deliverySummary.requirementProgress == null ? '—' : `${deliverySummary.requirementProgress}%`],
      ['进度覆盖率', deliverySummary.progressCoverage == null ? '—' : `${deliverySummary.progressCoverage}%`],
      ['已记录工时', deliverySummary.recordedHours], ['无版本记录工时（不计交付）', deliverySummary.unversionedHours],
      ['应填工时（人员工作日去重）', deliverySummary.standardHours],
      ['应填工作人日', deliverySummary.workingDays], ['交付率公式', deliverySummary.formula],
      ['统计范围', deliverySummary.scopeNote], ['工作日日历', deliverySummary.calendarNote]
    ];
    const rows = detail.records.map(record => ({
      来源: record.source_type === 'product_manager' ? 'AI产品经理' : '研发',
      人员: record.staff?.name || '-', 岗位: record.staff?.role || '-',
      周期: tasks.find(task => task.id === record.task_id)?.title || record.task_id || '-',
      版本号: versionTypeOf(record) === 'no_version' ? '无版本号' : record.version,
      需求名称: record.requirement_title || '-',
      需求方: record.demand_sources.join('、') || '-', 工时: Number(record.hours || 0),
      有效已交付: versionTypeOf(record) === 'versioned' ? Number(record.hours || 0) : 0,
      需求填报进度: isFullCreditRecord(record) ? '不适用' : record.delivery_progress == null ? '未填写' : `${record.delivery_progress}%`,
      有效交付率计入说明: isFullCreditRecord(record) ? '五类有效工时，全额计入有效及加权交付，不计需求进度' : hasValidVersion(record.version) ? '有版本号，计入有效已交付工时' : '无版本号，仅记录工时'
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaRows), '导出说明');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' ? safeExcelText(value) : value])))), '进度明细');
    const countedDates = new Set();
    const capacityRows = deliverySummary.units.map(unit => {
      const uniqueDates = unit.workDates.filter(date => {
        const key = `${unit.staffId}:${date}`;
        if (countedDates.has(key)) return false;
        countedDates.add(key);
        return true;
      });
      return { 人员: safeExcelText(unit.staffName), 岗位: safeExcelText(unit.role),
        周期: safeExcelText(unit.taskTitle || unit.taskId), 开始日期: unit.startDate, 结束日期: unit.endDate,
        工作日期: unit.workDates.join('、'), 有效已交付: unit.deliveredHours,
        有效交付率: unit.deliveryRate, 加权交付率: unit.weightedDeliveryRate == null
          ? (unit.calendarStatus === 'invalid_period' ? '基准不完整，暂不计算' : '无应填工时') : unit.weightedDeliveryRate,
        已记录工时: unit.recordedHours, 无版本记录工时: unit.unversionedHours,
        周期应填工时: unit.standardHours, 计入汇总应填工时: uniqueDates.length * 8,
        日历口径: unit.calendarStatus === 'official' ? '官方节假日与调休'
          : unit.calendarStatus === 'invalid_period' ? '周期日期无效，基准不完整' : '周一至周五估算，待核实' };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(capacityRows), '人员周期容量');
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
            staff: null,
            totalHours: 0,
            recordCount: 0,
            taskCount: 0,
            tasks: [], workHours: buildWorkHours(), deliverySummary: buildDeliverySummary([], buildWorkHours()), roleDefinitions: getRoleDefinitions()
          }
        });
      }
      taskIds = [taskId];
    }

    if (taskIds.length === 0) {
      return res.json({
        code: 0,
        data: {
          staff: null,
          totalHours: 0,
          recordCount: 0,
          taskCount: 0,
          tasks: [], workHours: buildWorkHours(), deliverySummary: buildDeliverySummary([], buildWorkHours()), roleDefinitions: getRoleDefinitions()
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
      order: RECORD_CREATION_ORDER
    });
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const records = (await filterRecordsByStaffStatus(allRecords, taskById)).sort(compareRecordCreationDesc);
    if (records.length === 0) {
      return res.json({
        code: 0,
        data: {
          staff: null,
          totalHours: 0,
          recordCount: 0,
          taskCount: 0,
          tasks: [], workHours: buildWorkHours(), deliverySummary: buildDeliverySummary([], buildWorkHours()), roleDefinitions: getRoleDefinitions()
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
    const workHoursContext = await loadWorkHoursContext({ tasks: allTasks, staff: [staff] });
    const workHours = buildWorkHours({ ...workHoursContext, records });
    const deliverySummary = buildDeliverySummary(records, workHours);
    for (const task of allTasks) {
      task.workHours = buildWorkHours({ ...workHoursContext, tasks: [task], records: task.records });
      task.deliverySummary = buildDeliverySummary(task.records, task.workHours);
    }

    res.json({
      code: 0,
      data: {
        staff,
        totalHours,
        workHours,
        deliverySummary,
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
          data: { pm: null, totalHours: 0, recordCount: 0, taskCount: 0, tasks: [], workHours: buildWorkHours(), deliverySummary: buildDeliverySummary([], buildWorkHours()), roleDefinitions: getRoleDefinitions() }
        });
      }
      taskIds = [taskId];
    }

    if (taskIds.length === 0) {
      return res.json({
        code: 0,
        data: { pm: null, totalHours: 0, recordCount: 0, taskCount: 0, tasks: [], workHours: buildWorkHours(), deliverySummary: buildDeliverySummary([], buildWorkHours()), roleDefinitions: getRoleDefinitions() }
      });
    }

    // 获取这些任务下的全部工时记录（关联 Staff 信息）
    const allRecords = await WorkRecord.findAll({
      where: { task_id: { [Op.in]: taskIds } },
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }],
      order: RECORD_CREATION_ORDER
    });
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const statusAllowedRecords = await filterRecordsByStaffStatus(allRecords, taskById);

    // 过滤出包含该 PM 名称且 PM 状态在任务日期允许统计的记录
    const pmRecords = (await filterRecordsForPm(statusAllowedRecords, pm, taskById)).sort(compareRecordCreationDesc);
    if (pmRecords.length === 0) {
      return res.json({
        code: 0,
        data: { pm: null, totalHours: 0, recordCount: 0, taskCount: 0, tasks: [], workHours: buildWorkHours(), deliverySummary: buildDeliverySummary([], buildWorkHours()), roleDefinitions: getRoleDefinitions() }
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
          created_at: plain.created_at,
          staff_id: plain.staff_id,
          task_id: plain.task_id,
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
    const relatedStaff = [...new Map(pmRecords.filter(record => record.staff).map(record => [record.staff_id, record.staff])).values()];
    const workHoursContext = await loadWorkHoursContext({
      tasks: allTasks, staff: relatedStaff,
      scopeNote: '该产品经理关联范围有记录的非离职作者，按完整所选周期计算应填工时；同一人员同一工作日去重。'
    });
    const workHours = buildWorkHours({ ...workHoursContext, records: pmRecords });
    const deliverySummary = buildDeliverySummary(pmRecords, workHours);
    for (const task of allTasks) {
      task.workHours = buildWorkHours({ ...workHoursContext, tasks: [task], records: pmRecords });
      task.deliverySummary = buildDeliverySummary(task.records, task.workHours);
    }

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
        workHours,
        deliverySummary,
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
