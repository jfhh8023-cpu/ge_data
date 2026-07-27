const { DataTypes } = require('sequelize');
const { sequelize } = require('../models');

const ROLE_AI_DEV = 'ai_dev';
const ROLE_AI_QUALITY = 'ai_quality';
const ROLE_FRONTEND = 'frontend';
const ROLE_BACKEND = 'backend';
const ROLE_TEST = 'test';

const STAFF_ROLE_VALUES = [
  ROLE_AI_DEV,
  ROLE_AI_QUALITY,
  ROLE_FRONTEND,
  ROLE_BACKEND,
  ROLE_TEST
];

const STAFF_ROLE_OPTIONS = [
  { value: ROLE_AI_DEV, label: 'AI开发工程师' },
  { value: ROLE_AI_QUALITY, label: 'AI质量工程师' }
];

const ROLE_LABEL = {
  [ROLE_AI_DEV]: 'AI开发工程师',
  [ROLE_AI_QUALITY]: 'AI质量工程师',
  [ROLE_FRONTEND]: 'AI开发工程师',
  [ROLE_BACKEND]: 'AI开发工程师',
  [ROLE_TEST]: 'AI质量工程师'
};

function normalizeStaffRole(role, fallback = ROLE_AI_DEV) {
  const value = String(role || '').trim();
  if ([ROLE_AI_DEV, ROLE_FRONTEND, ROLE_BACKEND].includes(value)) return ROLE_AI_DEV;
  if ([ROLE_AI_QUALITY, ROLE_TEST].includes(value)) return ROLE_AI_QUALITY;
  return fallback;
}

function isAiDevelopmentRole(role) {
  return normalizeStaffRole(role) === ROLE_AI_DEV;
}

function createRoleSummary() {
  return {
    [ROLE_AI_DEV]: 0,
    [ROLE_AI_QUALITY]: 0
  };
}

function addRoleHours(summary, role, hours) {
  const key = normalizeStaffRole(role);
  if (summary[key] === undefined) summary[key] = 0;
  summary[key] += Number(hours || 0);
  return key;
}

function withRoleAliases(summary = {}) {
  const aiDev = Number(summary[ROLE_AI_DEV] || summary[ROLE_FRONTEND] || 0)
    + Number(summary[ROLE_BACKEND] || 0);
  const aiQuality = Number(summary[ROLE_AI_QUALITY] || summary[ROLE_TEST] || 0);
  return {
    [ROLE_AI_DEV]: aiDev,
    [ROLE_AI_QUALITY]: aiQuality,
    [ROLE_FRONTEND]: aiDev,
    [ROLE_BACKEND]: 0,
    [ROLE_TEST]: aiQuality
  };
}

function decorateRolePayload(row) {
  const raw = row?.role;
  const normalized = normalizeStaffRole(raw);
  return {
    role: normalized,
    legacy_role: raw && raw !== normalized ? raw : undefined,
    role_label: ROLE_LABEL[normalized]
  };
}

async function ensureStaffRoleSchema() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable('staff');
  if (!table.role) return;

  await queryInterface.changeColumn('staff', 'role', {
    type: DataTypes.ENUM(...STAFF_ROLE_VALUES),
    allowNull: false
  });

  await sequelize.query(`
    UPDATE staff
    SET role = CASE
      WHEN role IN ('frontend', 'backend') THEN 'ai_dev'
      WHEN role = 'test' THEN 'ai_quality'
      ELSE role
    END
  `);
}

module.exports = {
  ROLE_AI_DEV,
  ROLE_AI_QUALITY,
  ROLE_FRONTEND,
  ROLE_BACKEND,
  ROLE_TEST,
  STAFF_ROLE_VALUES,
  STAFF_ROLE_OPTIONS,
  ROLE_LABEL,
  normalizeStaffRole,
  isAiDevelopmentRole,
  createRoleSummary,
  addRoleHours,
  withRoleAliases,
  decorateRolePayload,
  ensureStaffRoleSchema
};
