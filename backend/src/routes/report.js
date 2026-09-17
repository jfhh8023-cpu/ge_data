/**
 * Report 路由 — 汇总报表
 * GET  /api/report?taskId=xxx              获取匹配组数据
 * POST /api/report/match?taskId=xxx        触发智能匹配
 * PUT  /api/report/:id                     更新匹配组（备注等）
 * POST /api/report/manual-row              手动添加行
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { MatchGroup, WorkRecord, Staff, CollectionTask } = require('../models');
const { matchRecords } = require('../services/MatchService');
const {
  ROLE_AI_DEV,
  ROLE_AI_QUALITY,
  ROLE_VOIP,
  getRoleDefinitions,
  normalizeStaffRole
} = require('../services/RoleService');
const { safeParseJsonArray } = require('../utils/parseJson');
const {
  collectPmNamesFromRecords,
  filterPmNamesForRecord,
  filterRecordsByStaffStatus,
  filterMatchGroupsByStaffStatus,
  getPmStatusContextByName
} = require('../services/PersonStatusService');

function normalizeNameArray(value) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/[,，、\s]+/) : safeParseJsonArray(value));
  return source.map(item => String(item || '').trim()).filter(Boolean);
}

function normalizeRoleArray(value) {
  const source = Array.isArray(value) ? value : safeParseJsonArray(value);
  return source
    .map(item => {
      if (typeof item === 'string') return { staffName: item.trim(), hours: 0 };
      return {
        staffName: String(item?.staffName || item?.name || '').trim(),
        hours: Number(item?.hours || 0)
      };
    })
    .filter(item => item.staffName || item.hours > 0);
}

function normalizeRoleBuckets(value) {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = {}; }
  }
  if (!source || Array.isArray(source) || typeof source !== 'object') return {};
  const buckets = {};
  for (const [role, entries] of Object.entries(source)) {
    const key = normalizeStaffRole(role, '');
    if (!key) continue;
    buckets[key] = normalizeRoleArray(entries);
  }
  return buckets;
}

function roleBucketsFromLegacy(group) {
  return {
    [ROLE_AI_DEV]: [
      ...normalizeRoleArray(group.frontend),
      ...normalizeRoleArray(group.backend)
    ],
    [ROLE_VOIP]: normalizeRoleArray(group.voip),
    [ROLE_AI_QUALITY]: normalizeRoleArray(group.test_role)
  };
}

function roleBucketsFromGroup(group) {
  const buckets = normalizeRoleBuckets(group.role_buckets);
  return Object.keys(buckets).length ? buckets : roleBucketsFromLegacy(group);
}

function addRoleEntry(buckets, role, entry) {
  const key = normalizeStaffRole(role);
  if (!buckets[key]) buckets[key] = [];
  const duplicate = buckets[key].find(item => item.staffName === entry.staffName);
  if (duplicate) duplicate.hours += Number(entry.hours || 0);
  else buckets[key].push({ staffName: entry.staffName, hours: Number(entry.hours || 0) });
}

async function canonicalizeRoleBuckets(input, knownRoleByName = null) {
  const buckets = normalizeRoleBuckets(input);
  const names = [...new Set(Object.values(buckets).flat().map(item => item.staffName).filter(Boolean))];
  if (!names.length) return buckets;

  const roleByName = knownRoleByName || new Map((await Staff.findAll({
    where: { name: { [Op.in]: names } },
    attributes: ['name', 'role']
  })).map(item => [item.name, normalizeStaffRole(item.role, '')]));
  const canonical = {};

  for (const [sourceKey, entries] of Object.entries(buckets)) {
    for (const entry of entries) {
      addRoleEntry(canonical, roleByName.get(entry.staffName) || sourceKey, entry);
    }
  }
  return canonical;
}

function applyRoleBuckets(group, buckets) {
  const normalized = normalizeRoleBuckets(buckets);
  group.role_buckets = normalized;
  group.frontend = normalized[ROLE_AI_DEV] || [];
  group.backend = [];
  group.voip = normalized[ROLE_VOIP] || [];
  group.test_role = normalized[ROLE_AI_QUALITY] || [];
  return group;
}

function parseMatchGroup(group) {
  const plain = group.toJSON ? group.toJSON() : { ...group };
  plain.frontend = safeParseJsonArray(plain.frontend);
  plain.backend = safeParseJsonArray(plain.backend);
  plain.voip = safeParseJsonArray(plain.voip);
  plain.test_role = safeParseJsonArray(plain.test_role);
  plain.role_buckets = roleBucketsFromGroup(plain);
  plain.ai_developers = [...plain.frontend, ...plain.backend];
  plain.ai_quality = plain.test_role;
  plain.product_managers = safeParseJsonArray(plain.product_managers);
  return plain;
}

/* GET /api/report?taskId=xxx */
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.taskId) where.task_id = req.query.taskId;
    const list = await filterMatchGroupsByStaffStatus(await MatchGroup.findAll({ where, order: [['created_at', 'ASC']] }));
    const task = req.query.taskId ? await CollectionTask.findByPk(req.query.taskId) : null;
    const pmNames = new Set();
    for (const group of list) {
      for (const name of safeParseJsonArray(group.product_managers)) pmNames.add(name);
    }
    const pmContextByName = await getPmStatusContextByName([...pmNames]);
    // 解析 JSON 字段
    const parsed = await Promise.all(list.map(async g => {
      const plain = { ...g };
      plain.frontend = safeParseJsonArray(plain.frontend);
      plain.backend = safeParseJsonArray(plain.backend);
      plain.voip = safeParseJsonArray(plain.voip);
      plain.test_role = safeParseJsonArray(plain.test_role);
      plain.role_buckets = roleBucketsFromGroup(plain);
      plain.ai_developers = [...plain.frontend, ...plain.backend];
      plain.ai_quality = plain.test_role;
      plain.product_managers = task
        ? await filterPmNamesForRecord(plain, task, pmContextByName)
        : safeParseJsonArray(plain.product_managers);
      return plain;
    }));
    res.json({ code: 0, data: parsed });
  } catch (err) { next(err); }
});

/* POST /api/report/match?taskId=xxx — 触发智能匹配 */
router.post('/match', async (req, res, next) => {
  try {
    const { taskId } = req.query;
    if (!taskId) return res.status(400).json({ code: 1, message: 'taskId 必填' });

    const task = await CollectionTask.findByPk(taskId);
    if (!task) return res.status(404).json({ code: 1, message: '任务不存在' });

    // 获取原始记录
    const records = await WorkRecord.findAll({
      where: { task_id: taskId },
      include: [{ model: Staff, as: 'staff', attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }]
    });
    const taskById = new Map([[task.id, task]]);
    const statusAllowedRecords = await filterRecordsByStaffStatus(records, taskById);
    const pmContextByName = await getPmStatusContextByName(collectPmNamesFromRecords(statusAllowedRecords));
    const matchInput = await Promise.all(statusAllowedRecords.map(async record => {
      const plain = record.toJSON();
      plain.product_managers = await filterPmNamesForRecord(record, task, pmContextByName);
      return plain;
    }));

    // 保存旧匹配组的备注和状态，以便重建后回填
    const oldGroups = await MatchGroup.findAll({ where: { task_id: taskId } });
    const oldRemarkMap = new Map();
    for (const og of oldGroups) {
      // 按版本号（优先）或标题建立索引
      const key = (og.version || '').trim().toLowerCase() || (og.merged_title || '').trim();
      if (key && (og.remark || og.status === 'manual_merged')) {
        oldRemarkMap.set(key, { remark: og.remark || '', status: og.status });
      }
    }

    // 执行匹配
    const groups = matchRecords(matchInput);

    // 清除旧匹配组
    await MatchGroup.destroy({ where: { task_id: taskId } });

    // 保存新匹配组（回填备注）
    const created = [];
    for (const g of groups) {
      const key = (g.version || '').trim().toLowerCase() || (g.merged_title || '').trim();
      const old = oldRemarkMap.get(key);
      if (old) {
        if (old.remark) g.remark = old.remark;
        if (old.status === 'manual_merged') g.status = old.status;
      }
      const mg = await MatchGroup.create({ ...g, task_id: taskId });
      created.push(mg);
    }

    res.json({ code: 0, data: created, message: `生成了 ${created.length} 个匹配组` });
  } catch (err) { next(err); }
});

/* PUT /api/report/:id — 更新匹配组（备注等） */
router.put('/:id', async (req, res, next) => {
  try {
    const mg = await MatchGroup.findByPk(req.params.id);
    if (!mg) return res.status(404).json({ code: 1, message: '匹配组不存在' });
    const textFields = ['merged_title', 'version', 'remark', 'status'];
    textFields.forEach(f => { if (req.body[f] !== undefined) mg[f] = req.body[f]; });
    if (req.body.product_managers !== undefined) mg.product_managers = normalizeNameArray(req.body.product_managers);
    let buckets = roleBucketsFromGroup(mg);
    if (req.body.role_buckets !== undefined) {
      buckets = normalizeRoleBuckets(req.body.role_buckets);
    } else {
      if (req.body.ai_developers !== undefined) buckets[ROLE_AI_DEV] = normalizeRoleArray(req.body.ai_developers);
      else if (req.body.frontend !== undefined || req.body.backend !== undefined) {
        buckets[ROLE_AI_DEV] = [
          ...normalizeRoleArray(req.body.frontend ?? mg.frontend),
          ...normalizeRoleArray(req.body.backend ?? mg.backend)
        ];
      }
      if (req.body.ai_quality !== undefined) buckets[ROLE_AI_QUALITY] = normalizeRoleArray(req.body.ai_quality);
      else if (req.body.test_role !== undefined) buckets[ROLE_AI_QUALITY] = normalizeRoleArray(req.body.test_role);
      if (req.body.voip !== undefined) buckets[ROLE_VOIP] = normalizeRoleArray(req.body.voip);
    }
    applyRoleBuckets(mg, await canonicalizeRoleBuckets(buckets));
    await mg.save();
    res.json({ code: 0, data: parseMatchGroup(mg) });
  } catch (err) { next(err); }
});

/* POST /api/report/manual-row — 手动添加行 */
router.post('/manual-row', async (req, res, next) => {
  try {
    const { task_id, merged_title, version, product_managers, frontend, backend, voip, test_role, ai_developers, ai_quality, role_buckets, remark } = req.body;
    if (!task_id) return res.status(400).json({ code: 1, message: 'task_id 必填' });
    const initialBuckets = role_buckets !== undefined ? normalizeRoleBuckets(role_buckets) : {
      [ROLE_AI_DEV]: [
        ...normalizeRoleArray(ai_developers ?? frontend),
        ...(ai_developers !== undefined ? [] : normalizeRoleArray(backend))
      ],
      [ROLE_VOIP]: normalizeRoleArray(voip),
      [ROLE_AI_QUALITY]: normalizeRoleArray(ai_quality ?? test_role)
    };
    const canonical = await canonicalizeRoleBuckets(initialBuckets);
    const values = applyRoleBuckets({
      id: uuidv4(), task_id,
      merged_title: merged_title || '',
      version: version || '',
      product_managers: normalizeNameArray(product_managers),
      remark: remark || '',
      confidence: 1,
      status: 'manual_merged'
    }, canonical);
    const mg = await MatchGroup.create(values);
    res.json({ code: 0, data: parseMatchGroup(mg) });
  } catch (err) { next(err); }
});

/* POST /api/report/import — v2.0.0 批量导入 MatchGroup（覆盖逻辑） */
router.post('/import', async (req, res, next) => {
  try {
    const { task_id, rows } = req.body;
    if (!task_id) return res.status(400).json({ code: 1, message: 'task_id 必填' });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ code: 1, message: 'rows 须为非空数组' });

    let created = 0, updated = 0;
    const importRoleByName = new Map((await Staff.findAll({ attributes: ['name', 'role'] }))
      .map(item => [item.name, normalizeStaffRole(item.role, '')]));

    for (const row of rows) {
      // 覆盖规则：已存在相同需求名称或相同版本号的 MatchGroup 则覆盖
      let existing = null;
      const conditions = [];
      if (row.merged_title) conditions.push({ merged_title: row.merged_title, task_id });
      if (row.version) conditions.push({ version: row.version, task_id });

      if (conditions.length > 0) {
        existing = await MatchGroup.findOne({ where: { [Op.or]: conditions } });
      }

      // 构建角色 JSON 数组
      const buildRoleArray = (name, hours) => {
        if (!name && !hours) return [];
        const names = name ? name.split(/[,，、\s]+/).filter(Boolean) : [''];
        const avgHours = hours ? (hours / names.length) : 0;
        return names.map(n => ({ staffName: n, hours: avgHours }));
      };

      let importedBuckets = normalizeRoleBuckets(row.role_buckets);
      if (!Object.keys(importedBuckets).length) {
        importedBuckets = {};
        for (const role of getRoleDefinitions()) {
          importedBuckets[role.key] = buildRoleArray(row[`${role.key}_name`], row[`${role.key}_hours`]);
        }
        const usesCanonicalAiDevFields = row.ai_dev_name !== undefined || row.ai_dev_hours !== undefined;
        if (!importedBuckets[ROLE_AI_DEV]?.length) {
          importedBuckets[ROLE_AI_DEV] = [
            ...buildRoleArray(row.ai_dev_name ?? row.frontend_name, row.ai_dev_hours ?? row.frontend_hours),
            ...(usesCanonicalAiDevFields ? [] : buildRoleArray(row.backend_name, row.backend_hours))
          ];
        }
        if (!importedBuckets[ROLE_VOIP]?.length) importedBuckets[ROLE_VOIP] = buildRoleArray(row.voip_name, row.voip_hours);
        if (!importedBuckets[ROLE_AI_QUALITY]?.length) importedBuckets[ROLE_AI_QUALITY] = buildRoleArray(row.ai_quality_name ?? row.test_name, row.ai_quality_hours ?? row.test_hours);
      }
      const canonical = await canonicalizeRoleBuckets(importedBuckets, importRoleByName);

      const data = applyRoleBuckets({
        merged_title: row.merged_title || '',
        version: row.version || '',
        product_managers: normalizeNameArray(row.product_managers),
        remark: row.remark || ''
      }, canonical);

      if (existing) {
        // 覆盖保存
        Object.assign(existing, data);
        await existing.save();
        updated++;
      } else {
        // 新增行（manual_merged，可编辑/删除）
        await MatchGroup.create({
          id: uuidv4(),
          task_id,
          ...data,
          confidence: 1,
          status: 'manual_merged'
        });
        created++;
      }
    }

    res.json({ code: 0, message: `导入成功：新增 ${created} 条，覆盖 ${updated} 条` });
  } catch (err) { next(err); }
});

/* DELETE /api/report/:id — 删除手动添加行 */
router.delete('/:id', async (req, res, next) => {
  try {
    const mg = await MatchGroup.findByPk(req.params.id);
    if (!mg) return res.status(404).json({ code: 1, message: '匹配组不存在' });
    if (mg.status !== 'manual_merged') return res.status(403).json({ code: 1, message: '非手动行不可删除' });
    await mg.destroy();
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

module.exports = router;
