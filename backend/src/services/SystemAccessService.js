/**
 * SystemAccessService — 系统启用开关（REQ-074）
 *
 * 关闭系统后：填写工时页面返回 blocked（reason: system_disabled），
 * 填写页的草稿 / 提交 / 编辑态写入接口一律 403。
 */
const SystemSetting = require('../models/SystemSetting');

const SETTING_KEY = 'system_access';
const SYSTEM_DISABLED_REASON = 'system_disabled';
const DEFAULT_DISABLED_MESSAGE = '系统维护中，暂停填写工时，请稍后再试。';
const MAX_MESSAGE_LENGTH = 2000;

function normalizeAccess(raw) {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  const enabled = parsed && typeof parsed === 'object' ? parsed.enabled !== false : true;
  const message = parsed && typeof parsed === 'object' && typeof parsed.message === 'string'
    ? parsed.message
    : '';
  return { enabled, message };
}

async function ensureSystemSettingTable() {
  await SystemSetting.sync();
}

async function getSystemAccess() {
  const row = await SystemSetting.findByPk(SETTING_KEY);
  const access = normalizeAccess(row?.setting_value);
  return { ...access, updated_at: row?.updated_at || null };
}

async function updateSystemAccess(payload = {}) {
  const enabled = payload.enabled !== false;
  const message = String(payload.message ?? '').trim();
  if (!enabled && !message) {
    const err = new Error('关闭系统时请填写展示内容');
    err.status = 400;
    throw err;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    const err = new Error(`展示内容不能超过 ${MAX_MESSAGE_LENGTH} 字`);
    err.status = 400;
    throw err;
  }
  const value = JSON.stringify({ enabled, message });
  const now = new Date();
  const [row, created] = await SystemSetting.findOrCreate({
    where: { setting_key: SETTING_KEY },
    defaults: { setting_key: SETTING_KEY, setting_value: value, updated_at: now }
  });
  if (!created) await row.update({ setting_value: value, updated_at: now });
  return getSystemAccess();
}

function buildDisabledPayload(access) {
  return {
    blocked: true,
    reason: SYSTEM_DISABLED_REASON,
    message: String(access?.message || '').trim() || DEFAULT_DISABLED_MESSAGE
  };
}

async function assertSystemEnabled() {
  const access = await getSystemAccess();
  if (access.enabled) return access;
  const err = new Error(buildDisabledPayload(access).message);
  err.status = 403;
  err.reason = SYSTEM_DISABLED_REASON;
  throw err;
}

module.exports = {
  SETTING_KEY,
  SYSTEM_DISABLED_REASON,
  DEFAULT_DISABLED_MESSAGE,
  MAX_MESSAGE_LENGTH,
  normalizeAccess,
  ensureSystemSettingTable,
  getSystemAccess,
  updateSystemAccess,
  buildDisabledPayload,
  assertSystemEnabled
};
