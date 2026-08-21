const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { DataTypes, Op } = require('sequelize');
const {
  sequelize,
  AutoTaskRule,
  AutoTaskRunLog,
  AutoTaskMessage,
  AutoTaskChildNotification,
  CollectionTask,
  Staff
} = require('../models');
const { createPreferredTask } = require('./TaskService');
const { isNonResigned } = require('./PersonStatusService');
const {
  addDays,
  dateFromYmd,
  dateToYmd,
  getBeijingDate,
  getBeijingParts,
  getBeijingScheduledAt,
  getIsoWeekInfo,
  getIsoWeekMonday,
  getMonday,
  getWeekdayNumber
} = require('../utils/beijingTime');

const SKIP_MESSAGE = '该任务已存在或无法新增超过下一周的新收集任务，若仍需新增，请手动处理';
const DINGTALK_CARD_TITLE = '语音产研进度维护通知：';
const DINGTALK_DUTY_CARD_TITLE = '今日语音业务线值班通知：';
const TASK_TYPE_CREATE_NOTIFY = 'task_create_notify';
const TASK_TYPE_DUTY_NOTIFY = 'duty_notify';
const ACTION_MODES = new Set(['run_and_notify', 'run_only', 'notify_only']);
const TASK_TYPES = new Set([TASK_TYPE_CREATE_NOTIFY, TASK_TYPE_DUTY_NOTIFY]);
const DUTY_SEND_MODES = new Set(['start_only', 'start_and_end']);
const WEEKLY_DUTY_MODE_FIXED = 'fixed';
const WEEKLY_DUTY_MODE_ROTATION = 'rotation';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHILD_FALLBACK_WINDOW_MS = 6 * DAY_MS;
const STALE_RUNNING_LOG_MS = 60 * 1000;
const SCHEDULE_TRIGGER_GRACE_MS = 60 * 1000;
const CHILD_STATUS_INACTIVE = 'inactive';
const CHILD_STATUS_PENDING = 'pending';
const CHILD_STATUS_SENDING = 'sending';
const CHILD_STATUS_SENT = 'sent';
const CHILD_STATUS_FAILED = 'failed';
let schedulerTimer = null;
let ticking = false;

async function ensureColumn(tableName, columnName, definition) {
  const table = await sequelize.getQueryInterface().describeTable(tableName);
  if (!table[columnName]) {
    await sequelize.getQueryInterface().addColumn(tableName, columnName, definition);
  }
}

async function tableExists(tableName) {
  const tables = await sequelize.getQueryInterface().showAllTables();
  return tables
    .map(item => (typeof item === 'string' ? item : (item.tableName || item.table_name)))
    .includes(tableName);
}

async function ensureRunLogEventIndex() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const indexes = await queryInterface.showIndex('auto_task_run_logs');
    const indexNames = new Set(indexes.map(index => index.name));
    for (const name of ['uniq_rule_scheduled', 'auto_task_run_logs_rule_id_scheduled_at']) {
      if (indexNames.has(name)) {
        await queryInterface.removeIndex('auto_task_run_logs', name);
      }
    }
    const refreshedIndexes = await queryInterface.showIndex('auto_task_run_logs');
    const hasEventIndex = refreshedIndexes.some(index => index.name === 'uniq_rule_scheduled_event');
    if (!hasEventIndex) {
      await queryInterface.addIndex('auto_task_run_logs', ['rule_id', 'scheduled_at', 'event_type'], {
        name: 'uniq_rule_scheduled_event',
        unique: true
      });
    }
  } catch (err) {
    console.warn('[auto-task] 校验执行日志事件索引失败', err.message);
  }
}

async function ensureAutoTaskTables() {
  await AutoTaskRule.sync();
  await AutoTaskMessage.sync();
  await AutoTaskChildNotification.sync();
  if (await tableExists('auto_task_run_logs')) {
    await ensureColumn('auto_task_run_logs', 'event_type', {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'auto_task'
    });
  }
  await AutoTaskRunLog.sync();
  await ensureColumn('staff', 'phone', { type: DataTypes.STRING(30), allowNull: true });
  await ensureColumn('auto_task_rules', 'action_mode', {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'run_and_notify'
  });
  await ensureColumn('auto_task_rules', 'task_type', {
    type: DataTypes.STRING(40),
    allowNull: false,
    defaultValue: TASK_TYPE_CREATE_NOTIFY
  });
  await ensureColumn('auto_task_rules', 'dingtalk_recipients', { type: DataTypes.TEXT, allowNull: true });
  await ensureColumn('auto_task_rules', 'duty_config', { type: DataTypes.TEXT, allowNull: true });
  await ensureRunLogEventIndex();
  // v3.3.0 名句搭配
  const { Quote, QuoteConfig } = require('../models');
  await Quote.sync();
  await QuoteConfig.sync();
}

function toIntList(value, min, max) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      raw = Array.isArray(parsed) ? parsed : raw;
    } catch {
      // fall through to comma split below
    }
  }
  raw = Array.isArray(raw)
    ? raw
    : (raw === null || raw === undefined || raw === '' ? [] : String(raw).split(','));
  return [...new Set(raw
    .map(v => Number(v))
    .filter(v => Number.isInteger(v) && v >= min && v <= max))]
    .sort((a, b) => a - b);
}

function toStringList(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      raw = Array.isArray(parsed) ? parsed : raw;
    } catch {
      // fall through to comma split below
    }
  }
  raw = Array.isArray(raw)
    ? raw
    : (raw === null || raw === undefined || raw === '' ? [] : String(raw).split(','));
  return [...new Set(raw.map(item => String(item || '').trim()).filter(Boolean))];
}

function defaultWebhookName(index) {
  return `钉钉群webhook机器人${String(index + 1).padStart(2, '0')}`;
}

function stableWebhookId(url, index = 0) {
  const source = String(url || `webhook-${index + 1}`).trim();
  return `webhook_${crypto.createHash('sha1').update(source).digest('hex').slice(0, 20)}`;
}

function normalizeWebhookConfigs(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      raw = Array.isArray(parsed) ? parsed : raw;
    } catch {
      // keep original string
    }
  }
  if (!Array.isArray(raw)) raw = raw ? [raw] : [];
  const seen = new Set();
  const seenIds = new Set();
  return raw
    .map((item, index) => {
      if (typeof item === 'string') {
        const url = item.trim();
        const id = stableWebhookId(url, index);
        seenIds.add(id);
        return { id, name: defaultWebhookName(index), url };
      }
      const url = String(item?.url || item?.webhook || item?.value || '').trim();
      let id = String(item?.id || stableWebhookId(url, index)).trim().slice(0, 80);
      if (!id || seenIds.has(id)) id = stableWebhookId(url, index);
      seenIds.add(id);
      return {
        id,
        name: String(item?.name || defaultWebhookName(index)).trim() || defaultWebhookName(index),
        url
      };
    })
    .filter(item => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
}

function normalizeWebhookList(value) {
  return normalizeWebhookConfigs(value).map(item => item.url);
}

function normalizeNoticeContent(content) {
  const normalized = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized
    .split('\n')
    .map(line => {
      const text = line.trimEnd();
      return text ? `${text}  ` : '';
    })
    .join('\n');
}

function isValidPhone(phone) {
  return /^\d{5,20}$/.test(String(phone || '').trim());
}

function normalizeActionMode(value) {
  const mode = String(value || '').trim();
  return ACTION_MODES.has(mode) ? mode : 'run_and_notify';
}

function normalizeTaskType(value) {
  const type = String(value || '').trim();
  return TASK_TYPES.has(type) ? type : TASK_TYPE_CREATE_NOTIFY;
}

function normalizeNotifyEnabled(actionMode, value) {
  if (actionMode === 'run_only') return false;
  if (actionMode === 'notify_only') return true;
  return value !== false;
}

function normalizeTime(value, fallback = '09:00:00') {
  const text = String(value || '').trim();
  if (/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(text)) return text;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return `${text}:00`;
  return fallback;
}

function normalizeDutyItem(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const staffIds = Array.isArray(source.staff_ids) ? source.staff_ids : [];
  const sendMode = DUTY_SEND_MODES.has(source.send_mode) ? source.send_mode : 'start_only';
  return {
    enabled: source.enabled === true,
    staff_ids: [...new Set(staffIds.map(id => String(id || '').trim()).filter(Boolean))],
    start_time: normalizeTime(source.start_time, '09:00:00'),
    end_time: normalizeTime(source.end_time, '18:30:00'),
    send_mode: sendMode,
    start_message: String(source.start_message || '').trim(),
    end_message: String(source.end_message || '').trim()
  };
}

function normalizeDutyDayMap(value, min, max) {
  const result = {};
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  for (const [key, item] of Object.entries(source)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < min || day > max) continue;
    result[String(day)] = normalizeDutyItem(item);
  }
  return result;
}

function createDefaultDutyItem() {
  return normalizeDutyItem({
    enabled: false,
    staff_ids: [],
    start_time: '09:00:00',
    end_time: '18:30:00',
    send_mode: 'start_only',
    start_message: '请关注线上告警和待处理反馈。',
    end_message: '请同步今日值班处理结果。'
  });
}

function normalizeWeeklyDutyMode(value) {
  return value === WEEKLY_DUTY_MODE_ROTATION ? WEEKLY_DUTY_MODE_ROTATION : WEEKLY_DUTY_MODE_FIXED;
}

function normalizeWeeklyRotationConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const endWeekday = Number(source.end_weekday);
  const rawStartDate = String(source.start_date || '').slice(0, 10);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(rawStartDate)
    ? rawStartDate
    : dateToYmd(getMonday(getBeijingDate()));
  const staffIds = Array.isArray(source.staff_ids) ? source.staff_ids : [];
  return {
    end_weekday: Number.isInteger(endWeekday) && endWeekday >= 1 && endWeekday <= 7 ? endWeekday : 5,
    staff_ids: [...new Set(staffIds.map(id => String(id || '').trim()).filter(Boolean))],
    start_date: startDate
  };
}

function normalizeWeeklyDutyVersion(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const effectiveDate = String(source.effective_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return null;
  return {
    effective_date: effectiveDate,
    weekly: normalizeDutyDayMap(source.weekly, 1, 7),
    weekly_mode: normalizeWeeklyDutyMode(source.weekly_mode),
    weekly_rotation: normalizeWeeklyRotationConfig(source.weekly_rotation)
  };
}

function normalizeWeeklyDutyVersions(value) {
  if (!Array.isArray(value)) return [];
  const versionsByDate = new Map();
  value.forEach(item => {
    const normalized = normalizeWeeklyDutyVersion(item);
    if (normalized) versionsByDate.set(normalized.effective_date, normalized);
  });
  return [...versionsByDate.values()]
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
}

function normalizeDutyConfig(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const weekly = normalizeDutyDayMap(source.weekly, 1, 7);
  const weeklyMode = normalizeWeeklyDutyMode(source.weekly_mode);
  const weeklyRotation = normalizeWeeklyRotationConfig(source.weekly_rotation);
  const weeklyVersions = normalizeWeeklyDutyVersions(source.weekly_versions);
  if (weeklyVersions.length > 0 && weeklyVersions[0].effective_date !== '1900-01-01') {
    weeklyVersions.unshift({
      effective_date: '1900-01-01',
      weekly,
      weekly_mode: weeklyMode,
      weekly_rotation: weeklyRotation
    });
  }
  return {
    weekly,
    monthly: normalizeDutyDayMap(source.monthly, 1, 31),
    weekly_mode: weeklyMode,
    weekly_rotation: weeklyRotation,
    weekly_versions: weeklyVersions
  };
}

function resolveWeeklyDutyProfile(dutyConfig, ymd) {
  const config = dutyConfig && typeof dutyConfig === 'object'
    ? dutyConfig
    : normalizeDutyConfig(dutyConfig);
  let profile = {
    weekly: normalizeDutyDayMap(config.weekly, 1, 7),
    weekly_mode: normalizeWeeklyDutyMode(config.weekly_mode),
    weekly_rotation: normalizeWeeklyRotationConfig(config.weekly_rotation)
  };
  for (const version of normalizeWeeklyDutyVersions(config.weekly_versions)) {
    if (version.effective_date > ymd) break;
    profile = version;
  }
  return profile;
}

function dutyItemHasStart(item) {
  return Boolean(item?.enabled && item.staff_ids?.length && String(item.start_message || '').trim());
}

function dutyItemHasEnd(item) {
  return Boolean(
    item?.enabled &&
    item.send_mode === 'start_and_end' &&
    item.staff_ids?.length &&
    String(item.end_message || '').trim()
  );
}

function configuredDutyKeys(dayMap, includeEnd = false) {
  return Object.entries(dayMap)
    .filter(([, item]) => dutyItemHasStart(item) || (includeEnd && dutyItemHasEnd(item)))
    .map(([key]) => Number(key))
    .sort((a, b) => a - b);
}

function rotationRangeKeys(rotation) {
  const config = normalizeWeeklyRotationConfig(rotation);
  return Array.from({ length: config.end_weekday }, (_, index) => index + 1);
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function rotationSequenceIndex(rotation, ymd) {
  const config = normalizeWeeklyRotationConfig(rotation);
  if (!config.staff_ids.length) return -1;
  const current = dateFromYmd(ymd);
  const anchor = dateFromYmd(config.start_date);
  const diffDays = Math.floor((current.getTime() - anchor.getTime()) / DAY_MS);
  if (diffDays < 0) return -1;
  const fullWeeks = Math.floor(diffDays / 7);
  let slotCount = fullWeeks * config.end_weekday;
  for (let offset = fullWeeks * 7; offset <= diffDays; offset++) {
    if (getWeekdayNumber(addDays(anchor, offset)) <= config.end_weekday) slotCount += 1;
  }
  return slotCount > 0 ? positiveModulo(slotCount - 1, config.staff_ids.length) : -1;
}

function rotationStaffIdForDate(rotation, ymd) {
  const config = normalizeWeeklyRotationConfig(rotation);
  if (!config.staff_ids.length || getWeekdayNumber(ymd) > config.end_weekday) return '';
  const index = rotationSequenceIndex(config, ymd);
  return index >= 0 ? (config.staff_ids[index] || '') : '';
}

function resolveWeeklyRotationDutyItem(dutyProfile, ymd) {
  const weekday = getWeekdayNumber(ymd);
  const baseItem = normalizeDutyItem(dutyProfile.weekly[String(weekday)] || createDefaultDutyItem());
  const staffId = rotationStaffIdForDate(dutyProfile.weekly_rotation, ymd);
  return normalizeDutyItem({
    ...baseItem,
    staff_ids: staffId ? [staffId] : [],
    enabled: Boolean(staffId && String(baseItem.start_message || '').trim())
  });
}

function configuredWeeklyDutyKeys(dutyConfig) {
  const today = dateToYmd(getBeijingDate());
  const profile = resolveWeeklyDutyProfile(dutyConfig, today);
  if (profile.weekly_mode !== WEEKLY_DUTY_MODE_ROTATION) {
    return configuredDutyKeys(profile.weekly, true);
  }
  if (!profile.weekly_rotation.staff_ids.length) return [];
  return rotationRangeKeys(profile.weekly_rotation).filter(key => {
    const baseItem = normalizeDutyItem(profile.weekly[String(key)] || createDefaultDutyItem());
    return String(baseItem.start_message || '').trim() ||
      (baseItem.send_mode === 'start_and_end' && String(baseItem.end_message || '').trim());
  });
}

function normalizeRecipientConfig(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const staffIds = Array.isArray(source.staff_ids) ? source.staff_ids : [];
  const extra = Array.isArray(source.extra) ? source.extra : [];
  return {
    enabled: source.enabled === true,
    at_mode: source.at_mode === 'all' ? 'all' : 'people',
    staff_ids: [...new Set(staffIds.map(id => String(id || '').trim()).filter(Boolean))],
    extra: extra.map((item, index) => ({
      id: String(item?.id || `extra_${index + 1}`),
      name: String(item?.name || '').trim(),
      role: String(item?.role || '').trim(),
      phone: String(item?.phone || '').trim(),
      selected: item?.selected !== false
    })).filter(item => item.name && item.role && isValidPhone(item.phone))
  };
}

async function resolveAtConfig(value) {
  const config = normalizeRecipientConfig(value);
  if (!config.enabled) return { enabled: false, atAll: false, mobiles: [], missing: [] };
  if (config.at_mode === 'all') return { enabled: true, atAll: true, mobiles: [], missing: [] };
  const phones = [];
  const missing = [];
  if (config.staff_ids.length > 0) {
    const result = await resolveStaffPhoneDetails(config.staff_ids);
    phones.push(...result.mobiles);
    missing.push(...result.missing);
  }
  for (const item of config.extra) {
    if (item.selected && isValidPhone(item.phone)) phones.push(item.phone);
  }
  return { enabled: true, atAll: false, mobiles: [...new Set(phones)], missing: [...new Set(missing)] };
}

function normalizeStaffIdentifiers(staffIds = []) {
  return [...new Set((Array.isArray(staffIds) ? staffIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean))];
}

async function resolveStaffPhones(staffIds = []) {
  const result = await resolveStaffPhoneDetails(staffIds);
  return result.mobiles;
}

async function resolveStaffPhoneDetails(staffIds = []) {
  const ids = normalizeStaffIdentifiers(staffIds);
  if (ids.length === 0) return { mobiles: [], missing: [] };
  const staffRows = await Staff.findAll({
    where: {
      [Op.or]: [
        { id: { [Op.in]: ids } },
        { phone: { [Op.in]: ids } },
        { name: { [Op.in]: ids } }
      ]
    },
    attributes: ['id', 'name', 'phone', 'employment_status', 'is_active']
  });
  const phones = [];
  const missing = [];
  for (const id of ids) {
    const matched = staffRows.find(staff =>
      String(staff.id || '').trim() === id ||
      String(staff.phone || '').trim() === id ||
      String(staff.name || '').trim() === id
    );
    if (matched && !isNonResigned(matched)) {
      continue;
    }
    if (!matched && isValidPhone(id)) {
      phones.push(id);
      continue;
    }
    const phone = String(matched?.phone || '').trim();
    if (isValidPhone(phone)) {
      phones.push(phone);
    } else {
      missing.push(String(matched?.name || id).trim());
    }
  }
  return { mobiles: [...new Set(phones)], missing: [...new Set(missing)] };
}

async function resolveStaffAtConfig(staffIds = []) {
  const ids = normalizeStaffIdentifiers(staffIds);
  if (ids.length === 0) return { enabled: false, atAll: false, mobiles: [], missing: [] };
  const result = await resolveStaffPhoneDetails(ids);
  return {
    enabled: result.mobiles.length > 0 || result.missing.length > 0,
    atAll: false,
    mobiles: [...new Set(result.mobiles)],
    missing: [...new Set(result.missing)]
  };
}

async function recordAutoTaskMessage(ruleId, level, action, message) {
  if (!ruleId || !message) return null;
  try {
    return await AutoTaskMessage.create({
      id: uuidv4(),
      rule_id: ruleId,
      level,
      action,
      message,
      created_at: new Date()
    });
  } catch (err) {
    console.error('[auto-task] 写入提示历史失败', err.message);
    return null;
  }
}

function normalizeRulePayload(payload, existing = null) {
  const taskType = normalizeTaskType(payload.task_type ?? existing?.task_type);
  const scheduleType = payload.schedule_type || existing?.schedule_type || 'weekly';
  const executeTime = payload.execute_time || existing?.execute_time || '09:00:00';
  const dutyConfig = normalizeDutyConfig(payload.duty_config ?? existing?.duty_config);
  const actionMode = taskType === TASK_TYPE_DUTY_NOTIFY
    ? 'notify_only'
    : normalizeActionMode(payload.action_mode ?? existing?.action_mode);
  const notifyEnabled = taskType === TASK_TYPE_DUTY_NOTIFY
    ? true
    : normalizeNotifyEnabled(
      actionMode,
      payload.notify_enabled ?? existing?.notify_enabled ?? true
    );
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(executeTime)) {
    const err = new Error('执行时间格式必须为 HH:mm:ss');
    err.status = 400;
    throw err;
  }
  if (!['monthly', 'weekly'].includes(scheduleType)) {
    const err = new Error('调度类型不合法');
    err.status = 400;
    throw err;
  }

  const monthDays = taskType === TASK_TYPE_DUTY_NOTIFY
    ? (configuredDutyKeys(dutyConfig.monthly, true).length ? configuredDutyKeys(dutyConfig.monthly, true) : Array.from({ length: 31 }, (_, i) => i + 1))
    : toIntList(payload.month_days ?? existing?.month_days, 1, 31);
  const weekDays = taskType === TASK_TYPE_DUTY_NOTIFY
    ? (configuredWeeklyDutyKeys(dutyConfig).length ? configuredWeeklyDutyKeys(dutyConfig) : Array.from({ length: 7 }, (_, i) => i + 1))
    : toIntList(payload.week_days ?? existing?.week_days, 1, 7);
  const scheduleYear = payload.schedule_year ?? existing?.schedule_year ?? new Date().getFullYear();
  const webhooks = normalizeWebhookConfigs(
    payload.dingtalk_webhooks ?? payload.dingtalk_webhook ?? existing?.dingtalk_webhook
  );

  if (taskType !== TASK_TYPE_DUTY_NOTIFY && scheduleType === 'monthly' && monthDays.length === 0) {
    const err = new Error('按月日期执行时至少选择一个日期');
    err.status = 400;
    throw err;
  }
  if (taskType !== TASK_TYPE_DUTY_NOTIFY && scheduleType === 'weekly' && weekDays.length === 0) {
    const err = new Error('按星期执行时至少选择一个星期');
    err.status = 400;
    throw err;
  }

  return {
    name: payload.name ?? existing?.name ?? (taskType === TASK_TYPE_DUTY_NOTIFY ? '自动值班通知' : '自动生成任务规则'),
    enabled: payload.enabled ?? existing?.enabled ?? true,
    task_type: taskType,
    action_mode: actionMode,
    schedule_type: scheduleType,
    schedule_year: scheduleType === 'monthly' ? Number(scheduleYear) : null,
    month_days: scheduleType === 'monthly' ? monthDays : [],
    week_days: scheduleType === 'weekly' ? weekDays : [],
    execute_time: executeTime,
    notify_enabled: notifyEnabled,
    dingtalk_webhook: JSON.stringify(webhooks),
    dingtalk_message: payload.dingtalk_message ?? existing?.dingtalk_message ?? '',
    dingtalk_recipients: JSON.stringify(normalizeRecipientConfig(
      payload.dingtalk_recipients ?? existing?.dingtalk_recipients
    )),
    duty_config: JSON.stringify(dutyConfig)
  };
}

function normalizeChildNotificationPayload(payload, existing = null, parentRule = null) {
  if (parentRule && normalizeTaskType(parentRule.task_type) !== TASK_TYPE_CREATE_NOTIFY) {
    const err = new Error('仅自动任务创建并通知规则支持子通知');
    err.status = 400;
    throw err;
  }
  const scheduleType = payload.schedule_type ?? existing?.schedule_type ?? 'weekly';
  if (!['monthly', 'weekly'].includes(scheduleType)) {
    const err = new Error('子通知计划类型不合法');
    err.status = 400;
    throw err;
  }
  const rawExecuteTime = String(payload.execute_time ?? existing?.execute_time ?? '09:00:00').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(rawExecuteTime)) {
    const err = new Error('子通知执行时间格式必须为 HH:mm:ss');
    err.status = 400;
    throw err;
  }
  const executeTime = rawExecuteTime;
  const weekDays = toIntList(payload.week_days ?? existing?.week_days, 1, 7);
  const monthDays = toIntList(payload.month_days ?? existing?.month_days, 1, 31);
  if (scheduleType === 'weekly' && weekDays.length === 0) {
    const err = new Error('子通知按星期执行时至少选择一个星期');
    err.status = 400;
    throw err;
  }
  if (scheduleType === 'monthly' && monthDays.length === 0) {
    const err = new Error('子通知按月执行时至少选择一个日期');
    err.status = 400;
    throw err;
  }
  const message = String(payload.message ?? existing?.message ?? '').trim();
  if (!message) {
    const err = new Error('子通知内容不能为空');
    err.status = 400;
    throw err;
  }
  if (message.length > 10000) {
    const err = new Error('子通知内容不能超过 10000 个字符');
    err.status = 400;
    throw err;
  }

  const targetMode = (payload.webhook_target_mode ?? existing?.webhook_target_mode) === 'selected'
    ? 'selected'
    : 'all';
  const selectedWebhookIds = toStringList(payload.webhook_ids ?? existing?.webhook_ids);
  const parentWebhooks = normalizeWebhookConfigs(parentRule?.dingtalk_webhook);
  const allowedWebhookIds = new Set(parentWebhooks.map(item => item.id));
  const webhookIds = selectedWebhookIds.filter(id => allowedWebhookIds.has(id));
  if (parentRule && parentWebhooks.length === 0) {
    const err = new Error('请先为主通知保存至少一个有效 webhook');
    err.status = 400;
    throw err;
  }
  if (targetMode === 'selected' && webhookIds.length === 0) {
    const err = new Error('指定 webhook 模式下至少选择一个当前主通知连接');
    err.status = 400;
    throw err;
  }

  return {
    enabled: payload.enabled ?? existing?.enabled ?? true,
    schedule_type: scheduleType,
    month_days: scheduleType === 'monthly' ? monthDays : [],
    week_days: scheduleType === 'weekly' ? weekDays : [],
    execute_time: executeTime,
    message,
    webhook_target_mode: targetMode,
    webhook_ids: JSON.stringify(targetMode === 'selected' ? webhookIds : [])
  };
}

function partsFromYmd(ymd) {
  const [year, month, day] = String(ymd).split('-').map(Number);
  return { year, month, day, date: ymd };
}

function isChildNotificationParentActive(rule) {
  return Boolean(
    rule &&
    rule.enabled &&
    normalizeTaskType(rule.task_type) === TASK_TYPE_CREATE_NOTIFY &&
    normalizeActionMode(rule.action_mode) !== 'run_only' &&
    rule.notify_enabled
  );
}

function isChildNotificationDateMatched(child, parts) {
  if (child.schedule_type === 'monthly') {
    return toIntList(child.month_days, 1, 31).includes(parts.day);
  }
  return toIntList(child.week_days, 1, 7).includes(getWeekdayNumber(parts.date));
}

function childActivationTime(child) {
  const raw = child?.activation_scheduled_at || child?.activated_at;
  const value = raw ? new Date(raw).getTime() : NaN;
  return Number.isNaN(value) ? null : value;
}

function childTouchedTime(child) {
  const raw = child?.updated_at || child?.created_at;
  const value = raw ? new Date(raw).getTime() : NaN;
  return Number.isNaN(value) ? 0 : value;
}

function isChildNotificationPending(child, parentRule) {
  return Boolean(
    child?.enabled &&
    child?.activation_token &&
    child?.status === CHILD_STATUS_PENDING &&
    isChildNotificationParentActive(parentRule)
  );
}

function getNextChildRunAt(child, parentRule, now = new Date()) {
  if (!isChildNotificationPending(child, parentRule)) return null;
  const activationTime = childActivationTime(child);
  if (activationTime === null) return null;
  const today = getBeijingDate(now);
  const nowTime = now.getTime();
  for (let offset = 0; offset <= 400; offset++) {
    const candidate = addDays(today, offset);
    const ymd = dateToYmd(candidate);
    const parts = partsFromYmd(ymd);
    if (!isChildNotificationDateMatched(child, parts)) continue;
    const runAt = getBeijingScheduledAt(parts, normalizeTime(child.execute_time));
    const runTime = runAt.getTime();
    if (runTime < activationTime || runTime < childTouchedTime(child)) continue;
    if (runTime > nowTime || nowTime - runTime <= SCHEDULE_TRIGGER_GRACE_MS) return runAt;
  }
  return null;
}

function getDueChildScheduledAt(child, parentRule, now = new Date()) {
  if (!isChildNotificationPending(child, parentRule)) return null;
  const parts = getBeijingParts(now);
  if (!isChildNotificationDateMatched(child, parts)) return null;
  const scheduledAt = getBeijingScheduledAt(parts, normalizeTime(child.execute_time));
  const scheduledTime = scheduledAt.getTime();
  const activationTime = childActivationTime(child);
  if (activationTime === null || scheduledTime < activationTime || scheduledTime < childTouchedTime(child)) return null;
  return isScheduleEventTriggerable({ updated_at: new Date(0), created_at: new Date(0) }, scheduledAt, now)
    ? scheduledAt
    : null;
}

function serializeChildNotification(child, parentRule, now = new Date()) {
  const plain = child?.toJSON ? child.toJSON() : child;
  const parentActive = isChildNotificationParentActive(parentRule);
  let displayStatus = plain.enabled ? plain.status : CHILD_STATUS_INACTIVE;
  if (!parentActive || !plain.activation_token) displayStatus = CHILD_STATUS_INACTIVE;
  const nextRunAt = getNextChildRunAt({ ...plain, status: displayStatus }, parentRule, now);
  return {
    ...plain,
    month_days: toIntList(plain.month_days, 1, 31),
    week_days: toIntList(plain.week_days, 1, 7),
    webhook_ids: toStringList(plain.webhook_ids),
    status: displayStatus,
    next_run_at: nextRunAt ? nextRunAt.toISOString() : null
  };
}

async function activateChildNotifications(rule, activationScheduledAt) {
  if (!isChildNotificationParentActive(rule)) return 0;
  const token = uuidv4();
  const now = new Date();
  const [count] = await AutoTaskChildNotification.update({
    activation_token: token,
    activation_scheduled_at: activationScheduledAt,
    activated_at: now,
    status: CHILD_STATUS_PENDING,
    last_scheduled_at: null,
    last_error: null,
    updated_at: now
  }, {
    where: { rule_id: rule.id, enabled: true }
  });
  if (count > 0) {
    await recordAutoTaskMessage(rule.id, 'success', 'child_notify', `已激活 ${count} 条子通知`);
  }
  return count;
}

async function activateChildNotificationsSafely(rule, activationScheduledAt) {
  try {
    return await activateChildNotifications(rule, activationScheduledAt);
  } catch (err) {
    console.error('[auto-task] 子通知激活失败:', rule.id, err.message);
    await recordAutoTaskMessage(rule.id, 'error', 'child_notify', `主通知已发送，但子通知激活失败：${err.message}`);
    return 0;
  }
}

async function deactivateChildNotifications(ruleId) {
  if (!ruleId) return 0;
  const [count] = await AutoTaskChildNotification.update({
    activation_token: null,
    activation_scheduled_at: null,
    activated_at: null,
    status: CHILD_STATUS_INACTIVE,
    last_error: null,
    updated_at: new Date()
  }, {
    where: {
      rule_id: ruleId,
      status: { [Op.in]: [CHILD_STATUS_PENDING, CHILD_STATUS_SENDING] }
    }
  });
  return count;
}

function childTargetWebhooks(child, parentRule) {
  const webhooks = normalizeWebhookConfigs(parentRule.dingtalk_webhook);
  if (child.webhook_target_mode !== 'selected') return webhooks;
  const selectedIds = new Set(toStringList(child.webhook_ids));
  const selected = webhooks.filter(item => selectedIds.has(item.id));
  if (selected.length === 0) throw new Error('子通知选择的 webhook 已不存在，请重新配置');
  return selected;
}

async function testChildNotification(child, parentRule) {
  const content = String(child?.message || '').trim();
  if (!content) {
    const err = new Error('子通知内容不能为空');
    err.status = 400;
    throw err;
  }
  const webhooks = childTargetWebhooks(child, parentRule);
  const atConfig = await resolveAtConfig(parentRule.dingtalk_recipients);
  return sendDingTalkCard(webhooks, content, atConfig, `${DINGTALK_CARD_TITLE}（子通知测试）`);
}

async function executeChildNotification(child, parentRule, scheduledAt) {
  const token = String(child.activation_token || '');
  if (!token) return null;
  const claimedAt = new Date();
  const [claimed] = await AutoTaskChildNotification.update({
    status: CHILD_STATUS_SENDING,
    last_scheduled_at: scheduledAt,
    last_error: null,
    updated_at: claimedAt
  }, {
    where: {
      id: child.id,
      rule_id: parentRule.id,
      enabled: true,
      status: CHILD_STATUS_PENDING,
      activation_token: token
    }
  });
  if (claimed !== 1) return null;

  try {
    const webhooks = childTargetWebhooks(child, parentRule);
    const atConfig = await resolveAtConfig(parentRule.dingtalk_recipients);
    await sendDingTalkCard(webhooks, String(child.message || '').trim(), atConfig, `${DINGTALK_CARD_TITLE}（子通知）`);
    const sentAt = new Date();
    await AutoTaskChildNotification.update({
      status: CHILD_STATUS_SENT,
      last_sent_at: sentAt,
      last_error: null,
      updated_at: sentAt
    }, {
      where: { id: child.id, activation_token: token, status: CHILD_STATUS_SENDING }
    });
    await recordAutoTaskMessage(parentRule.id, 'success', 'child_notify', '子通知发送成功');
    return CHILD_STATUS_SENT;
  } catch (err) {
    await AutoTaskChildNotification.update({
      status: CHILD_STATUS_FAILED,
      last_error: err.message,
      updated_at: new Date()
    }, {
      where: { id: child.id, activation_token: token, status: CHILD_STATUS_SENDING }
    });
    await recordAutoTaskMessage(parentRule.id, 'error', 'child_notify', `子通知发送失败：${err.message}`);
    return CHILD_STATUS_FAILED;
  }
}

async function processDueChildNotifications(now = new Date()) {
  await recoverChildNotificationsFromParentEvidence(now);

  const staleBefore = new Date(now.getTime() - STALE_RUNNING_LOG_MS);
  await AutoTaskChildNotification.update({
    status: CHILD_STATUS_FAILED,
    last_error: '服务在发送过程中中断，本轮不再自动重发，等待下一次主通知激活',
    updated_at: now
  }, {
    where: {
      status: CHILD_STATUS_SENDING,
      updated_at: { [Op.lt]: staleBefore }
    }
  });

  const children = await AutoTaskChildNotification.findAll({
    where: { enabled: true, status: CHILD_STATUS_PENDING }
  });
  if (children.length === 0) return 0;
  const ruleIds = [...new Set(children.map(child => child.rule_id))];
  const parentRules = await AutoTaskRule.findAll({ where: { id: { [Op.in]: ruleIds } } });
  const ruleMap = new Map(parentRules.map(rule => [rule.id, rule]));
  let executed = 0;
  for (const child of children) {
    const parentRule = ruleMap.get(child.rule_id);
    const scheduledAt = getDueChildScheduledAt(child, parentRule, now);
    if (!scheduledAt) continue;
    await executeChildNotification(child, parentRule, scheduledAt);
    executed += 1;
  }
  return executed;
}

function isRuleDateMatched(rule, parts) {
  if (normalizeTaskType(rule.task_type) === TASK_TYPE_DUTY_NOTIFY) {
    const item = getDutyItemForParts(rule, parts);
    return dutyItemHasStart(item) || dutyItemHasEnd(item);
  }
  if (rule.schedule_type === 'monthly') {
    const monthDays = toIntList(rule.month_days, 1, 31);
    return Number(rule.schedule_year) === parts.year && monthDays.includes(parts.day);
  }
  const weekDays = toIntList(rule.week_days, 1, 7);
  return weekDays.includes(getWeekdayNumber(parts.date));
}

function getRuleTouchedAt(rule) {
  const raw = rule?.updated_at || rule?.created_at;
  const value = raw ? new Date(raw).getTime() : NaN;
  return Number.isNaN(value) ? 0 : value;
}

function isScheduleEventTriggerable(rule, scheduledAt, now = new Date()) {
  const scheduledTime = scheduledAt instanceof Date ? scheduledAt.getTime() : new Date(scheduledAt).getTime();
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isNaN(scheduledTime) || Number.isNaN(nowTime)) return false;
  if (scheduledTime > nowTime) return false;
  if (nowTime - scheduledTime > SCHEDULE_TRIGGER_GRACE_MS) return false;
  return getRuleTouchedAt(rule) <= scheduledTime;
}

function isRuleDue(rule, now = new Date()) {
  if (!rule.enabled) return null;
  const parts = getBeijingParts(now);
  if (!isRuleDateMatched(rule, parts)) return null;
  const scheduledAt = getBeijingScheduledAt(parts, rule.execute_time);
  return isScheduleEventTriggerable(rule, scheduledAt, now) ? scheduledAt : null;
}

function getDutyItemForParts(rule, parts) {
  const dutyConfig = normalizeDutyConfig(rule.duty_config);
  if (rule.schedule_type === 'monthly') {
    if (rule.schedule_year && Number(rule.schedule_year) !== parts.year) return null;
    return dutyConfig.monthly[String(parts.day)] || null;
  }
  const profile = resolveWeeklyDutyProfile(dutyConfig, parts.date);
  if (profile.weekly_mode === WEEKLY_DUTY_MODE_ROTATION) {
    return resolveWeeklyRotationDutyItem(profile, parts.date);
  }
  return profile.weekly[String(getWeekdayNumber(parts.date))] || null;
}

function buildDutyEventsForParts(rule, parts) {
  const item = getDutyItemForParts(rule, parts);
  if (!item?.enabled) return [];
  const events = [];
  if (dutyItemHasStart(item)) {
    events.push({
      kind: 'start',
      scheduledAt: getBeijingScheduledAt(parts, item.start_time),
      message: item.start_message,
      staff_ids: item.staff_ids
    });
  }
  if (dutyItemHasEnd(item)) {
    events.push({
      kind: 'end',
      scheduledAt: getBeijingScheduledAt(parts, item.end_time),
      message: item.end_message,
      staff_ids: item.staff_ids
    });
  }
  return events;
}

function getDueDutyEvents(rule, now = new Date()) {
  if (!rule.enabled) return [];
  const parts = getBeijingParts(now);
  return buildDutyEventsForParts(rule, parts)
    .filter(event => isScheduleEventTriggerable(rule, event.scheduledAt, now));
}

function getNextRunAt(rule, now = new Date()) {
  if (!rule.enabled) return null;
  if (normalizeTaskType(rule.task_type) === TASK_TYPE_DUTY_NOTIFY) {
    const today = getBeijingDate(now);
    for (let offset = 0; offset <= 400; offset++) {
      const candidate = addDays(today, offset);
      const ymd = dateToYmd(candidate);
      const parts = partsFromYmd(ymd);
      const nextEvent = buildDutyEventsForParts(rule, parts)
        .map(event => event.scheduledAt)
        .filter(runAt => runAt > now)
        .sort((a, b) => a - b)[0];
      if (nextEvent) return nextEvent;
    }
    return null;
  }
  const today = getBeijingDate(now);
  for (let offset = 0; offset <= 400; offset++) {
    const candidate = addDays(today, offset);
    const ymd = dateToYmd(candidate);
    const parts = partsFromYmd(ymd);
    if (!isRuleDateMatched(rule, parts)) continue;
    const runAt = new Date(`${ymd}T${rule.execute_time}+08:00`);
    if (runAt > now) return runAt;
  }
  return null;
}

function getPreviousRunAt(rule, now = new Date()) {
  const today = getBeijingDate(now);
  const nowTime = now.getTime();
  for (let offset = 0; offset <= 400; offset++) {
    const candidate = addDays(today, -offset);
    const ymd = dateToYmd(candidate);
    const parts = partsFromYmd(ymd);
    if (!isRuleDateMatched(rule, parts)) continue;
    const runAt = getBeijingScheduledAt(parts, normalizeTime(rule.execute_time));
    if (runAt.getTime() < nowTime) return runAt;
  }
  return null;
}

function childNotificationFallbackMatch(rule, latestRun = null, now = new Date()) {
  const result = {
    matched: false,
    source: null,
    reason: 'parent_inactive',
    next_run_at: null,
    activation_scheduled_at: null,
    remaining_ms: null
  };
  if (!isChildNotificationParentActive(rule)) return result;

  const nextRunAt = getNextRunAt(rule, now);
  if (!nextRunAt) return { ...result, reason: 'missing_next_run' };
  const remainingMs = nextRunAt.getTime() - now.getTime();
  const withCountdown = {
    ...result,
    next_run_at: nextRunAt,
    remaining_ms: remainingMs
  };
  const previousRunAt = getPreviousRunAt(rule, now);
  const latestScheduledAt = latestRun?.scheduled_at ? new Date(latestRun.scheduled_at) : null;
  const latestScheduledTime = latestScheduledAt?.getTime();
  const previousRunTime = previousRunAt?.getTime();
  const isCurrentCycleRecord = Boolean(
    latestRun &&
    previousRunAt &&
    !Number.isNaN(latestScheduledTime) &&
    Math.abs(latestScheduledTime - previousRunTime) <= SCHEDULE_TRIGGER_GRACE_MS
  );

  if (isCurrentCycleRecord) {
    if (latestRun.status === 'success' && latestRun.notify_status === 'success') {
      return {
        ...withCountdown,
        matched: true,
        source: 'run_log',
        reason: 'scheduled_success_record',
        activation_scheduled_at: latestScheduledAt
      };
    }
    return {
      ...withCountdown,
      reason: 'explicit_non_success_record',
      activation_scheduled_at: previousRunAt
    };
  }

  if (remainingMs <= 0 || remainingMs >= CHILD_FALLBACK_WINDOW_MS) {
    return { ...withCountdown, reason: 'outside_six_day_window' };
  }

  return {
    ...withCountdown,
    matched: true,
    source: 'countdown',
    reason: 'enabled_countdown_under_six_days',
    activation_scheduled_at: previousRunAt || now
  };
}

async function recoverChildNotificationsFromParentEvidence(now = new Date()) {
  const inactiveChildren = await AutoTaskChildNotification.findAll({
    where: {
      enabled: true,
      status: CHILD_STATUS_INACTIVE,
      activation_token: null
    },
    attributes: ['rule_id']
  });
  const ruleIds = [...new Set(inactiveChildren.map(child => child.rule_id))];
  if (ruleIds.length === 0) return 0;

  const rules = await AutoTaskRule.findAll({ where: { id: { [Op.in]: ruleIds } } });
  let recovered = 0;
  for (const rule of rules) {
    try {
      const latestRun = await AutoTaskRunLog.findOne({
        where: {
          rule_id: rule.id,
          event_type: 'auto_task',
          scheduled_at: { [Op.lte]: now }
        },
        order: [['scheduled_at', 'DESC']]
      });
      const match = childNotificationFallbackMatch(rule, latestRun, now);
      if (!match.matched) continue;

      const token = uuidv4();
      const [count] = await AutoTaskChildNotification.update({
        activation_token: token,
        activation_scheduled_at: match.activation_scheduled_at,
        activated_at: now,
        status: CHILD_STATUS_PENDING,
        last_scheduled_at: null,
        last_error: null,
        updated_at: now
      }, {
        where: {
          rule_id: rule.id,
          enabled: true,
          status: CHILD_STATUS_INACTIVE,
          activation_token: null
        }
      });
      if (count > 0) {
        recovered += count;
        const evidence = match.source === 'run_log'
          ? '主任务历史成功记录佐证'
          : '主通知已开启且下次执行倒计时小于6天';
        await recordAutoTaskMessage(rule.id, 'success', 'child_notify_recovery', `${evidence}，补激活 ${count} 条子通知`);
      }
    } catch (err) {
      console.error('[auto-task] 子通知兜底激活失败:', rule.id, err.message);
    }
  }
  return recovered;
}

async function createNextWeeklyTask() {
  const weeklyTasks = await CollectionTask.findAll({
    where: {
      time_dimension: 'week',
      week_number: { [Op.ne]: null }
    },
    attributes: ['id', 'year', 'week_number', 'start_date', 'end_date']
  });

  const beijingToday = getBeijingDate();
  const currentWeekMonday = getMonday(beijingToday);
  const maxAllowedMonday = addDays(currentWeekMonday, 7);
  const maxAllowedTime = maxAllowedMonday.getTime();

  let latestTask = null;
  let latestMonday = null;
  for (const task of weeklyTasks) {
    if (!task.year || !task.week_number) continue;
    const monday = getIsoWeekMonday(task.year, task.week_number);
    if (!latestMonday || monday > latestMonday) {
      latestTask = task;
      latestMonday = monday;
    }
  }

  let candidateMonday = latestTask ? addDays(latestMonday, 7) : currentWeekMonday;

  while (candidateMonday.getTime() <= maxAllowedTime) {
    const weekInfo = getIsoWeekInfo(candidateMonday);
    const nextStart = candidateMonday;
    const nextEnd = addDays(nextStart, 6);
    const nextStartStr = dateToYmd(nextStart);
    const nextEndStr = dateToYmd(nextEnd);

    const existing = await CollectionTask.findOne({
      where: {
        time_dimension: 'week',
        [Op.or]: [
          { year: weekInfo.year, week_number: weekInfo.week },
          { start_date: nextStartStr, end_date: nextEndStr }
        ]
      }
    });

    if (existing) {
      candidateMonday = addDays(candidateMonday, 7);
      continue;
    }

    const task = await createPreferredTask({
      title: `语音业务线-${weekInfo.year}年第${weekInfo.week}周工时统计`,
      time_dimension: 'week',
      start_date: nextStartStr,
      end_date: nextEndStr,
      week_number: weekInfo.week,
      year: weekInfo.year
    });

    return {
      created: true,
      task,
      message: `已自动生成第${weekInfo.week}周任务`
    };
  }

  return { created: false, message: SKIP_MESSAGE };
}

function postJson(url, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('webhook 地址格式不正确'));
      return;
    }

    const client = parsed.protocol === 'https:' ? require('https') : require('http');
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      reject(new Error('webhook 地址必须以 http 或 https 开头'));
      return;
    }

    const data = Buffer.from(JSON.stringify(body));
    const req = client.request({
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`webhook 返回 HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          return;
        }

        try {
          const payload = JSON.parse(text);
          if (payload && Object.prototype.hasOwnProperty.call(payload, 'errcode') && Number(payload.errcode) !== 0) {
            const errmsg = payload.errmsg || payload.message || text;
            reject(new Error(`webhook 返回失败 errcode=${payload.errcode}: ${String(errmsg).slice(0, 200)}`));
            return;
          }
        } catch {
          // Some webhook providers return plain text on success.
        }
        resolve(text);
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('webhook 请求超时'));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendDingTalkCard(webhooks, content, atConfig, title = DINGTALK_CARD_TITLE) {
  if (!webhooks.length) throw new Error('webhook 地址为空');
  if (!content) throw new Error('消息内容为空');
  if (atConfig.enabled && !atConfig.atAll && Array.isArray(atConfig.missing) && atConfig.missing.length > 0) {
    throw new Error(`以下人员未找到可用于钉钉 @ 的手机号：${atConfig.missing.join('、')}，请检查团队人员手机号配置`);
  }
  if (atConfig.enabled && !atConfig.atAll && atConfig.mobiles.length === 0) {
    throw new Error('未找到可用于钉钉 @ 的手机号，请检查团队人员手机号配置');
  }
  const atText = atConfig.atAll ? '@所有人' : atConfig.mobiles.map(phone => `@${phone}`).join(' ');
  const cardText = [
    `### ${title}`,
    '',
    normalizeNoticeContent(content),
    atText ? '' : null,
    atText || null
  ].filter(item => item !== null).join('\n');

  const errors = [];
  for (const webhook of webhooks) {
    try {
      const payload = {
        msgtype: 'markdown',
        markdown: {
          title,
          text: cardText
        }
      };
      if (atConfig.atAll) {
        payload.at = { isAtAll: true };
      } else if (atConfig.mobiles.length > 0) {
        payload.at = {
          atMobiles: atConfig.mobiles,
          isAtAll: false
        };
      }
      await postJson(webhook.url, payload);
    } catch (err) {
      errors.push(`${webhook.name}: ${err.message}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join('；'));
  }
  return { total: webhooks.length, success: webhooks.length };
}

async function sendDingTalkWebhook(rule) {
  const webhooks = normalizeWebhookConfigs(rule.dingtalk_webhooks ?? rule.dingtalk_webhook);
  const content = String(rule.dingtalk_message || '').trim();
  const atConfig = await resolveAtConfig(rule.dingtalk_recipients);
  const title = normalizeTaskType(rule.task_type) === TASK_TYPE_DUTY_NOTIFY
    ? DINGTALK_DUTY_CARD_TITLE
    : DINGTALK_CARD_TITLE;
  return sendDingTalkCard(webhooks, content, atConfig, title);
}

async function sendDutyWebhook(rule, event) {
  const webhooks = normalizeWebhookConfigs(rule.dingtalk_webhooks ?? rule.dingtalk_webhook);
  const content = String(event?.message || '').trim();
  const atConfig = await resolveStaffAtConfig(event?.staff_ids);
  return sendDingTalkCard(webhooks, content, atConfig, DINGTALK_DUTY_CARD_TITLE);
}

async function prepareRunLog(where, defaults) {
  const [log, created] = await AutoTaskRunLog.findOrCreate({ where, defaults });
  if (created) return log;
  if (log.status !== 'running') return null;

  const createdAt = new Date(log.created_at || 0).getTime();
  if (Number.isNaN(createdAt) || Date.now() - createdAt < STALE_RUNNING_LOG_MS) {
    return null;
  }

  await log.update({
    ...defaults,
    id: log.id,
    status: 'running',
    notify_status: 'not_required',
    notify_error: null,
    created_task_id: null,
    created_at: new Date()
  });
  return log;
}

async function runRuleOnce(rule) {
  if (normalizeTaskType(rule.task_type) === TASK_TYPE_DUTY_NOTIFY) {
    return {
      ok: false,
      task_created: false,
      task: null,
      notify_status: 'not_required',
      message: '自动值班通知仅支持测试发送 webhook，不生成任务'
    };
  }
  const actionMode = normalizeActionMode(rule.action_mode);
  if (actionMode === 'notify_only') {
    return {
      ok: false,
      task_created: false,
      task: null,
      notify_status: 'not_required',
      message: '当前任务仅通知，已禁止生成任务'
    };
  }

  const result = await createNextWeeklyTask();
  if (!result.created) {
    return {
      ok: true,
      task_created: false,
      task: null,
      notify_status: 'skipped',
      message: result.message || SKIP_MESSAGE
    };
  }

  if (actionMode === 'run_only' || !rule.notify_enabled) {
    return {
      ok: true,
      task_created: true,
      task: result.task,
      notify_status: 'skipped',
      message: actionMode === 'run_only' ? `${result.message}，仅执行规则未通知` : `${result.message}，通知开关未开启`
    };
  }

  try {
    const notifyResult = await sendDingTalkWebhook(rule);
    return {
      ok: true,
      task_created: true,
      task: result.task,
      notify_status: 'success',
      notify_result: notifyResult,
      message: `${result.message}，通知发送成功`
    };
  } catch (err) {
    return {
      ok: false,
      task_created: true,
      task: result.task,
      notify_status: 'failed',
      notify_error: err.message,
      message: `任务已创建，通知发送失败：${err.message}`
    };
  }
}

async function executeDutyEvent(rule, event) {
  const actionLabel = event.kind === 'end' ? '值班结束提醒' : '值班开始提醒';
  const eventType = event.kind === 'end' ? 'duty_end' : 'duty_start';
  const log = await prepareRunLog(
    { rule_id: rule.id, scheduled_at: event.scheduledAt, event_type: eventType },
    {
      id: uuidv4(),
      rule_id: rule.id,
      scheduled_at: event.scheduledAt,
      event_type: eventType,
      status: 'running',
      message: `${actionLabel}发送中`,
      notify_status: 'not_required'
    }
  );
  if (!log) return null;

  // v3.3.0 名句搭配：发送前消费一句名句并拼接到 message 前方
  let finalEvent = event;
  try {
    const { consumeQuotes } = require('./QuoteService');
    const quotes = await consumeQuotes(rule.id, 1);
    if (quotes.length && quotes[0]) {
      finalEvent = { ...event, message: `${quotes[0]}\n${event.message || ''}` };
    }
  } catch (quoteErr) {
    console.warn(`[duty-quote] 规则 ${rule.id} 名句注入失败：${quoteErr.message}`);
  }

  try {
    await sendDutyWebhook(rule, finalEvent);
    await log.update({
      status: 'success',
      message: `${actionLabel}发送成功`,
      notify_status: 'success'
    });
    await recordAutoTaskMessage(rule.id, 'success', 'duty_notify', `${actionLabel}发送成功`);
  } catch (err) {
    await log.update({
      status: 'notify_failed',
      message: `${actionLabel}发送失败`,
      notify_status: 'failed',
      notify_error: err.message
    });
    await recordAutoTaskMessage(rule.id, 'error', 'duty_notify', `${actionLabel}发送失败：${err.message}`);
  }
  return log;
}

async function executeRule(rule, scheduledAt) {
  const actionMode = normalizeActionMode(rule.action_mode);
  const log = await prepareRunLog(
    { rule_id: rule.id, scheduled_at: scheduledAt, event_type: 'auto_task' },
    {
      id: uuidv4(),
      rule_id: rule.id,
      scheduled_at: scheduledAt,
      event_type: 'auto_task',
      status: 'running',
      message: '执行中',
      notify_status: 'not_required'
    }
  );
  if (!log) return null;

  try {
    if (actionMode === 'notify_only') {
      try {
        await sendDingTalkWebhook(rule);
        await activateChildNotificationsSafely(rule, scheduledAt);
        await log.update({
          status: 'success',
          message: '仅通知模式，通知发送成功',
          notify_status: 'success'
        });
        await recordAutoTaskMessage(rule.id, 'success', 'auto_run', '仅通知模式，通知发送成功');
      } catch (notifyErr) {
        await log.update({
          status: 'notify_failed',
          message: '仅通知模式，通知发送失败',
          notify_status: 'failed',
          notify_error: notifyErr.message
        });
        await recordAutoTaskMessage(rule.id, 'error', 'auto_run', `仅通知模式，通知发送失败：${notifyErr.message}`);
      }
      return log;
    }

    const result = await createNextWeeklyTask();
    if (!result.created) {
      await log.update({
        status: 'skipped',
        message: result.message || SKIP_MESSAGE,
        notify_status: 'skipped'
      });
      await recordAutoTaskMessage(rule.id, 'warning', 'auto_run', result.message || SKIP_MESSAGE);
      return log;
    }

    if (actionMode === 'run_only' || !rule.notify_enabled) {
      await log.update({
        status: 'success',
        message: result.message,
        created_task_id: result.task.id,
        notify_status: 'skipped'
      });
      await recordAutoTaskMessage(
        rule.id,
        'success',
        'auto_run',
        actionMode === 'run_only' ? `${result.message}，仅执行规则未通知` : `${result.message}，通知开关未开启`
      );
      return log;
    }

    try {
      await sendDingTalkWebhook(rule);
      await activateChildNotificationsSafely(rule, scheduledAt);
      await log.update({
        status: 'success',
        message: result.message,
        created_task_id: result.task.id,
        notify_status: 'success'
      });
      await recordAutoTaskMessage(rule.id, 'success', 'auto_run', `${result.message}，通知发送成功`);
    } catch (notifyErr) {
      await log.update({
        status: 'notify_failed',
        message: '任务已创建，通知发送失败',
        created_task_id: result.task.id,
        notify_status: 'failed',
        notify_error: notifyErr.message
      });
      await recordAutoTaskMessage(rule.id, 'error', 'auto_run', `任务已创建，通知发送失败：${notifyErr.message}`);
    }
    return log;
  } catch (err) {
    await log.update({
      status: 'failed',
      message: err.message || '自动任务执行失败',
      notify_status: 'not_required'
    });
    await recordAutoTaskMessage(rule.id, 'error', 'auto_run', err.message || '自动任务执行失败');
    return log;
  }
}

async function schedulerTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    const rules = await AutoTaskRule.findAll({ where: { enabled: true } });
    for (const rule of rules) {
      try {
        if (normalizeTaskType(rule.task_type) === TASK_TYPE_DUTY_NOTIFY) {
          const events = getDueDutyEvents(rule, now);
          for (const event of events) {
            try {
              await executeDutyEvent(rule, event);
            } catch (eventErr) {
              console.error('[auto-task] 自动值班通知事件执行失败:', rule.id, event.kind, eventErr.message);
              await recordAutoTaskMessage(rule.id, 'error', 'duty_notify', `值班通知事件执行失败：${eventErr.message}`);
            }
          }
          continue;
        }
        const scheduledAt = isRuleDue(rule, now);
        if (scheduledAt) {
          await executeRule(rule, scheduledAt);
        }
      } catch (ruleErr) {
        console.error('[auto-task] 自动任务规则执行失败:', rule.id, ruleErr.message);
        await recordAutoTaskMessage(rule.id, 'error', 'auto_run', `自动任务规则执行失败：${ruleErr.message}`);
      }
    }
    await processDueChildNotifications(new Date());
  } catch (err) {
    console.error('[auto-task] 调度检查失败:', err.message);
  } finally {
    ticking = false;
  }
}

function startAutoTaskScheduler() {
  if (schedulerTimer) return schedulerTimer;
  schedulerTimer = setInterval(schedulerTick, 1000);
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
  setTimeout(() => {
    schedulerTick().catch(err => {
      console.error('[auto-task] 调度器启动后立即检查失败:', err.message);
    });
  }, 0);
  console.log('[auto-task] 自动任务调度器已启动');
  return schedulerTimer;
}

module.exports = {
  activateChildNotifications,
  createNextWeeklyTask,
  deactivateChildNotifications,
  ensureAutoTaskTables,
  getDutyItemForParts,
  getDueDutyEvents,
  getNextChildRunAt,
  getNextRunAt,
  normalizeChildNotificationPayload,
  normalizeDutyConfig,
  normalizeRulePayload,
  normalizeRecipientConfig,
  normalizeWebhookConfigs,
  normalizeWebhookList,
  processDueChildNotifications,
  recordAutoTaskMessage,
  recoverChildNotificationsFromParentEvidence,
  resolveWeeklyDutyProfile,
  runRuleOnce,
  serializeChildNotification,
  sendDingTalkWebhook,
  schedulerTick,
  startAutoTaskScheduler,
  testChildNotification,
  childNotificationFallbackMatch,
  SKIP_MESSAGE
};
