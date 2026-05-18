const { v4: uuidv4 } = require('uuid');
const { DataTypes, Op } = require('sequelize');
const { sequelize, AutoTaskRule, AutoTaskRunLog, AutoTaskMessage, CollectionTask, Staff } = require('../models');
const { createPreferredTask } = require('./TaskService');
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
let schedulerTimer = null;
let ticking = false;

async function ensureColumn(tableName, columnName, definition) {
  const table = await sequelize.getQueryInterface().describeTable(tableName);
  if (!table[columnName]) {
    await sequelize.getQueryInterface().addColumn(tableName, columnName, definition);
  }
}

async function ensureAutoTaskTables() {
  await AutoTaskRule.sync();
  await AutoTaskRunLog.sync();
  await AutoTaskMessage.sync();
  await ensureColumn('staff', 'phone', { type: DataTypes.STRING(30), allowNull: true });
  await ensureColumn('auto_task_rules', 'dingtalk_recipients', { type: DataTypes.TEXT, allowNull: true });
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

function defaultWebhookName(index) {
  return `钉钉群webhook机器人${String(index + 1).padStart(2, '0')}`;
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
  return raw
    .map((item, index) => {
      if (typeof item === 'string') {
        return { name: defaultWebhookName(index), url: item.trim() };
      }
      return {
        name: String(item?.name || defaultWebhookName(index)).trim() || defaultWebhookName(index),
        url: String(item?.url || item?.webhook || item?.value || '').trim()
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
  if (!config.enabled) return { enabled: false, atAll: false, mobiles: [] };
  if (config.at_mode === 'all') return { enabled: true, atAll: true, mobiles: [] };
  const phones = [];
  if (config.staff_ids.length > 0) {
    const staffRows = await Staff.findAll({
      where: { id: { [Op.in]: config.staff_ids } },
      attributes: ['phone']
    });
    for (const staff of staffRows) {
      if (isValidPhone(staff.phone)) phones.push(String(staff.phone).trim());
    }
  }
  for (const item of config.extra) {
    if (item.selected && isValidPhone(item.phone)) phones.push(item.phone);
  }
  return { enabled: true, atAll: false, mobiles: [...new Set(phones)] };
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
  const scheduleType = payload.schedule_type || existing?.schedule_type || 'weekly';
  const executeTime = payload.execute_time || existing?.execute_time || '09:00:00';
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

  const monthDays = toIntList(payload.month_days ?? existing?.month_days, 1, 31);
  const weekDays = toIntList(payload.week_days ?? existing?.week_days, 1, 7);
  const scheduleYear = payload.schedule_year ?? existing?.schedule_year ?? new Date().getFullYear();
  const webhooks = normalizeWebhookConfigs(
    payload.dingtalk_webhooks ?? payload.dingtalk_webhook ?? existing?.dingtalk_webhook
  );

  if (scheduleType === 'monthly' && monthDays.length === 0) {
    const err = new Error('按月日期执行时至少选择一个日期');
    err.status = 400;
    throw err;
  }
  if (scheduleType === 'weekly' && weekDays.length === 0) {
    const err = new Error('按星期执行时至少选择一个星期');
    err.status = 400;
    throw err;
  }

  return {
    name: payload.name ?? existing?.name ?? '自动生成任务规则',
    enabled: payload.enabled ?? existing?.enabled ?? true,
    schedule_type: scheduleType,
    schedule_year: scheduleType === 'monthly' ? Number(scheduleYear) : null,
    month_days: scheduleType === 'monthly' ? monthDays : [],
    week_days: scheduleType === 'weekly' ? weekDays : [],
    execute_time: executeTime,
    notify_enabled: payload.notify_enabled ?? existing?.notify_enabled ?? true,
    dingtalk_webhook: JSON.stringify(webhooks),
    dingtalk_message: payload.dingtalk_message ?? existing?.dingtalk_message ?? '',
    dingtalk_recipients: JSON.stringify(normalizeRecipientConfig(
      payload.dingtalk_recipients ?? existing?.dingtalk_recipients
    ))
  };
}

function partsFromYmd(ymd) {
  const [year, month, day] = String(ymd).split('-').map(Number);
  return { year, month, day, date: ymd };
}

function isRuleDateMatched(rule, parts) {
  if (rule.schedule_type === 'monthly') {
    const monthDays = toIntList(rule.month_days, 1, 31);
    return Number(rule.schedule_year) === parts.year && monthDays.includes(parts.day);
  }
  const weekDays = toIntList(rule.week_days, 1, 7);
  return weekDays.includes(getWeekdayNumber(parts.date));
}

function isRuleDue(rule, now = new Date()) {
  if (!rule.enabled) return null;
  const parts = getBeijingParts(now);
  if (!isRuleDateMatched(rule, parts)) return null;
  const scheduledAt = getBeijingScheduledAt(parts, rule.execute_time);
  return now >= scheduledAt ? scheduledAt : null;
}

function getNextRunAt(rule, now = new Date()) {
  if (!rule.enabled) return null;
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
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(text);
        } else {
          reject(new Error(`webhook 返回 HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
        }
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

async function sendDingTalkWebhook(rule) {
  const webhooks = normalizeWebhookConfigs(rule.dingtalk_webhooks ?? rule.dingtalk_webhook);
  const content = String(rule.dingtalk_message || '').trim();
  if (!webhooks.length) throw new Error('webhook 地址为空');
  if (!content) throw new Error('消息内容为空');
  const atConfig = await resolveAtConfig(rule.dingtalk_recipients);
  const atText = atConfig.atAll ? '@所有人' : atConfig.mobiles.map(phone => `@${phone}`).join(' ');
  const cardText = [
    `### ${DINGTALK_CARD_TITLE}`,
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
          title: DINGTALK_CARD_TITLE,
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

async function runRuleOnce(rule) {
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

  if (!rule.notify_enabled) {
    return {
      ok: true,
      task_created: true,
      task: result.task,
      notify_status: 'skipped',
      message: `${result.message}，通知开关未开启`
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

async function executeRule(rule, scheduledAt) {
  const [log, created] = await AutoTaskRunLog.findOrCreate({
    where: { rule_id: rule.id, scheduled_at: scheduledAt },
    defaults: {
      id: uuidv4(),
      rule_id: rule.id,
      scheduled_at: scheduledAt,
      status: 'running',
      message: '执行中',
      notify_status: 'not_required'
    }
  });
  if (!created) return null;

  try {
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

    if (!rule.notify_enabled) {
      await log.update({
        status: 'success',
        message: result.message,
        created_task_id: result.task.id,
        notify_status: 'skipped'
      });
      await recordAutoTaskMessage(rule.id, 'success', 'auto_run', `${result.message}，通知开关未开启`);
      return log;
    }

    try {
      await sendDingTalkWebhook(rule);
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
      const scheduledAt = isRuleDue(rule, now);
      if (scheduledAt) {
        await executeRule(rule, scheduledAt);
      }
    }
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
  console.log('[auto-task] 自动任务调度器已启动');
  return schedulerTimer;
}

module.exports = {
  createNextWeeklyTask,
  ensureAutoTaskTables,
  getNextRunAt,
  normalizeRulePayload,
  normalizeRecipientConfig,
  normalizeWebhookConfigs,
  normalizeWebhookList,
  recordAutoTaskMessage,
  runRuleOnce,
  sendDingTalkWebhook,
  schedulerTick,
  startAutoTaskScheduler,
  SKIP_MESSAGE
};
