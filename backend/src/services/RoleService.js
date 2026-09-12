const { DataTypes, Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const sequelize = require('../config/database');
const StaffRole = require('../models/StaffRole');
const Staff = require('../models/Staff');
const MatchGroup = require('../models/MatchGroup');

const ROLE_AI_DEV = 'ai_dev';
const ROLE_VOIP = 'voip';
const ROLE_AI_QUALITY = 'ai_quality';
const ROLE_EMBEDDED = 'embedded';
const ROLE_AI_PM = 'ai_pm';
const ROLE_FRONTEND = 'frontend';
const ROLE_BACKEND = 'backend';
const ROLE_TEST = 'test';

const LEGACY_ROLE_ALIASES = {
  [ROLE_FRONTEND]: ROLE_AI_DEV,
  [ROLE_BACKEND]: ROLE_AI_DEV,
  [ROLE_TEST]: ROLE_AI_QUALITY
};

const DEFAULT_ROLE_DEFINITIONS = [
  { key: ROLE_AI_DEV, name: 'AI开发工程师', short_name: 'AI开发', color: '#165DFF', sort_order: 10, is_system: true, is_active: true },
  { key: ROLE_VOIP, name: 'VOIP工程师', short_name: 'VOIP', color: '#00B42A', sort_order: 20, is_system: true, is_active: true },
  { key: ROLE_AI_QUALITY, name: 'AI质量工程师', short_name: 'AI质量', color: '#FF7D00', sort_order: 30, is_system: true, is_active: true },
  { key: ROLE_EMBEDDED, name: '嵌入式工程师', short_name: '嵌入式', color: '#14B8A6', sort_order: 40, is_system: true, is_active: true },
  { key: ROLE_AI_PM, name: 'AI产品经理', short_name: 'AI产品', color: '#722ED1', sort_order: 50, is_system: true, is_active: true }
];

let roleCache = new Map(DEFAULT_ROLE_DEFINITIONS.map(item => [item.key, { ...item }]));

function normalizeStaffRole(role, fallback = ROLE_AI_DEV) {
  const value = String(role || '').trim();
  if (!value) return fallback;
  return LEGACY_ROLE_ALIASES[value] || value;
}

function roleDefinitionPayload(role) {
  const plain = role?.toJSON ? role.toJSON() : { ...role };
  return {
    key: plain.key,
    name: plain.name,
    short_name: plain.short_name,
    color: plain.color,
    sort_order: Number(plain.sort_order || 0),
    is_system: Boolean(plain.is_system),
    is_active: plain.is_active !== false
  };
}

function roleSort(a, b) {
  return Number(a.sort_order || 0) - Number(b.sort_order || 0)
    || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
}

async function refreshRoleCache() {
  const roles = await StaffRole.findAll({ order: [['sort_order', 'ASC'], ['created_at', 'ASC']] });
  roleCache = new Map(roles.map(role => {
    const payload = roleDefinitionPayload(role);
    return [payload.key, payload];
  }));
  return getRoleDefinitions();
}

function getRoleDefinitions({ includeInactive = false } = {}) {
  return [...roleCache.values()]
    .filter(role => includeInactive || role.is_active)
    .sort(roleSort)
    .map(role => ({ ...role }));
}

function getRoleDefinition(role) {
  return roleCache.get(normalizeStaffRole(role, '')) || null;
}

function getRoleLabel(role, compact = false) {
  const definition = getRoleDefinition(role);
  if (!definition) return String(role || '').trim() || '-';
  return compact ? definition.short_name : definition.name;
}

function getRoleColor(role) {
  return getRoleDefinition(role)?.color || '#86909C';
}

async function isValidStaffRole(role) {
  const key = normalizeStaffRole(role, '');
  if (!key) return false;
  const cached = roleCache.get(key);
  if (cached) return cached.is_active;
  const found = await StaffRole.findOne({ where: { key, is_active: true } });
  if (!found) return false;
  const payload = roleDefinitionPayload(found);
  roleCache.set(payload.key, payload);
  return true;
}

function isAiDevelopmentRole(role) {
  return normalizeStaffRole(role) === ROLE_AI_DEV;
}

function isVoipRole(role) {
  return normalizeStaffRole(role) === ROLE_VOIP;
}

function createRoleSummary() {
  return Object.fromEntries(getRoleDefinitions().map(role => [role.key, 0]));
}

function addRoleHours(summary, role, hours) {
  const key = normalizeStaffRole(role);
  if (summary[key] === undefined) summary[key] = 0;
  summary[key] += Number(hours || 0);
  return key;
}

function withRoleAliases(summary = {}) {
  const result = {};
  for (const role of getRoleDefinitions()) {
    result[role.key] = Number(summary[role.key] || 0);
  }
  for (const [key, value] of Object.entries(summary)) {
    const normalized = normalizeStaffRole(key, key);
    if (!roleCache.has(normalized) && !Object.prototype.hasOwnProperty.call(LEGACY_ROLE_ALIASES, key)) continue;
    if (result[normalized] === undefined) result[normalized] = Number(value || 0);
  }
  if (summary[ROLE_AI_DEV] === undefined) {
    result[ROLE_AI_DEV] = Number(summary[ROLE_FRONTEND] || 0) + Number(summary[ROLE_BACKEND] || 0);
  }
  if (summary[ROLE_AI_QUALITY] === undefined) {
    result[ROLE_AI_QUALITY] = Number(summary[ROLE_TEST] || 0);
  }
  result[ROLE_FRONTEND] = result[ROLE_AI_DEV] || 0;
  result[ROLE_BACKEND] = 0;
  result[ROLE_TEST] = result[ROLE_AI_QUALITY] || 0;
  return result;
}

function decorateRolePayload(row) {
  const raw = row?.role;
  const normalized = normalizeStaffRole(raw);
  return {
    role: normalized,
    legacy_role: raw && raw !== normalized ? raw : undefined,
    role_label: getRoleLabel(normalized),
    role_short_label: getRoleLabel(normalized, true),
    role_color: getRoleColor(normalized)
  };
}

function validateRoleInput(input = {}, { partial = false } = {}) {
  const result = {};
  if (!partial || input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 30) {
      const err = new Error('角色名称长度须为 2-30 个字符');
      err.status = 400;
      throw err;
    }
    result.name = name;
  }
  if (!partial || input.short_name !== undefined) {
    const shortName = String(input.short_name || '').trim();
    if (shortName.length < 1 || shortName.length > 12) {
      const err = new Error('角色简称长度须为 1-12 个字符');
      err.status = 400;
      throw err;
    }
    result.short_name = shortName;
  }
  if (!partial || input.color !== undefined) {
    const color = String(input.color || '').trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(color)) {
      const err = new Error('角色颜色须为 #RRGGBB 格式');
      err.status = 400;
      throw err;
    }
    result.color = color;
  }
  return result;
}

async function assertUniqueRoleName(name, excludeKey = null) {
  const where = { name };
  if (excludeKey) where.key = { [Op.ne]: excludeKey };
  if (await StaffRole.findOne({ where })) {
    const err = new Error('角色名称已存在');
    err.status = 409;
    throw err;
  }
}

async function createStaffRole(input) {
  const values = validateRoleInput(input);
  await assertUniqueRoleName(values.name);
  const maxOrder = Math.max(0, ...getRoleDefinitions({ includeInactive: true }).map(role => role.sort_order || 0));
  const role = await StaffRole.create({
    key: `custom_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
    ...values,
    sort_order: maxOrder + 10,
    is_system: false,
    is_active: true,
    updated_at: new Date()
  });
  await refreshRoleCache();
  return roleDefinitionPayload(role);
}

async function updateStaffRole(key, input) {
  const normalizedKey = normalizeStaffRole(key, '');
  const role = await StaffRole.findByPk(normalizedKey);
  if (!role) {
    const err = new Error('角色不存在');
    err.status = 404;
    throw err;
  }
  const values = validateRoleInput(input, { partial: true });
  if (values.name) await assertUniqueRoleName(values.name, normalizedKey);
  Object.assign(role, values, { updated_at: new Date() });
  await role.save();
  await refreshRoleCache();
  return roleDefinitionPayload(role);
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  let text = typeof value === 'string' ? value.trim() : '';
  for (let i = 0; i < 2 && text; i += 1) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'string') text = parsed;
      else break;
    } catch {
      break;
    }
  }
  return [];
}

function normalizeRoleEntries(value) {
  return parseArray(value).map(item => ({
    staffName: String(item?.staffName || item?.name || '').trim(),
    hours: Number(item?.hours || 0)
  })).filter(item => item.staffName || item.hours > 0);
}

function addEntriesToBucket(buckets, role, entries) {
  const key = normalizeStaffRole(role);
  if (!buckets[key]) buckets[key] = [];
  for (const entry of normalizeRoleEntries(entries)) {
    const existing = buckets[key].find(item => item.staffName === entry.staffName);
    if (existing) existing.hours += entry.hours;
    else buckets[key].push(entry);
  }
}

async function migrateMatchGroupRoleBuckets() {
  const groups = await MatchGroup.findAll({
    where: { role_buckets: { [Op.is]: null } },
    attributes: ['id', 'frontend', 'backend', 'voip', 'test_role', 'role_buckets']
  });
  if (!groups.length) return 0;
  const staff = await Staff.findAll({ attributes: ['name', 'role'] });
  const roleByName = new Map(staff.map(item => [item.name, normalizeStaffRole(item.role)]));
  let migrated = 0;
  for (const group of groups) {
    const buckets = {};
    const sources = [
      [ROLE_AI_DEV, group.frontend],
      [ROLE_AI_DEV, group.backend],
      [ROLE_VOIP, group.voip],
      [ROLE_AI_QUALITY, group.test_role]
    ];
    for (const [fallbackRole, value] of sources) {
      for (const entry of normalizeRoleEntries(value)) {
        addEntriesToBucket(buckets, roleByName.get(entry.staffName) || fallbackRole, [entry]);
      }
    }
    group.role_buckets = buckets;
    await group.save({ fields: ['role_buckets'] });
    migrated += 1;
  }
  return migrated;
}

async function ensureStaffRoleSchema() {
  await StaffRole.sync();
  for (const definition of DEFAULT_ROLE_DEFINITIONS) {
    const [role] = await StaffRole.findOrCreate({
      where: { key: definition.key },
      defaults: { ...definition, updated_at: new Date() }
    });
    if (!role.is_system) {
      role.is_system = true;
      role.updated_at = new Date();
      await role.save();
    }
    // 只迁移历史旧名称，不覆盖管理员在角色配置中做过的全局改名/配色。
    if (definition.key === ROLE_EMBEDDED && role.name === '嵌入式软件工程师') {
      role.name = definition.name;
      role.updated_at = new Date();
      await role.save();
    }
  }

  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable('staff');
  if (table.role) {
    const roleColumnType = String(table.role.type || '').toUpperCase();
    if (!roleColumnType.startsWith('VARCHAR(50)')) {
      await queryInterface.changeColumn('staff', 'role', {
        type: DataTypes.STRING(50),
        allowNull: false
      });
    }
    await sequelize.query(`
      UPDATE staff
      SET role = CASE
        WHEN role IN ('frontend', 'backend') THEN 'ai_dev'
        WHEN role = 'test' THEN 'ai_quality'
        ELSE role
      END
    `);
  }
  await refreshRoleCache();
}

async function ensureMatchGroupRoleSchema() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable('match_groups');
  if (!table.voip) {
    await queryInterface.addColumn('match_groups', 'voip', {
      type: DataTypes.JSON,
      allowNull: true
    });
  }
  if (!table.role_buckets) {
    await queryInterface.addColumn('match_groups', 'role_buckets', {
      type: DataTypes.JSON,
      allowNull: true
    });
  }
  await migrateMatchGroupRoleBuckets();
}

module.exports = {
  ROLE_AI_DEV,
  ROLE_VOIP,
  ROLE_AI_QUALITY,
  ROLE_EMBEDDED,
  ROLE_AI_PM,
  ROLE_FRONTEND,
  ROLE_BACKEND,
  ROLE_TEST,
  DEFAULT_ROLE_DEFINITIONS,
  normalizeStaffRole,
  isAiDevelopmentRole,
  isVoipRole,
  createRoleSummary,
  addRoleHours,
  withRoleAliases,
  decorateRolePayload,
  getRoleDefinitions,
  getRoleDefinition,
  getRoleLabel,
  getRoleColor,
  isValidStaffRole,
  createStaffRole,
  updateStaffRole,
  normalizeRoleEntries,
  addEntriesToBucket,
  ensureStaffRoleSchema,
  ensureMatchGroupRoleSchema
};
