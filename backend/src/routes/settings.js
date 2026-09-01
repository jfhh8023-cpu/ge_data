/**
 * Settings routes — v3.1.0
 * 自动任务配置与需求工时统计全量备份下载
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { QueryTypes } = require('sequelize');
const {
  sequelize,
  AutoTaskRule,
  AutoTaskRunLog,
  AutoTaskMessage,
  AutoTaskChildNotification,
  DutyScheduleException,
  DutyScheduleSwap,
  DutySpecialNotificationLog
} = require('../models');
const {
  deactivateChildNotifications,
  getNextRunAtAsync,
  normalizeChildNotificationPayload,
  normalizeDutyConfig,
  normalizeRulePayload,
  normalizeRecipientConfig,
  normalizeWebhookConfigs,
  normalizeWebhookList,
  runRuleOnce,
  serializeChildNotificationAsync,
  sendDingTalkWebhook,
  testChildNotification
} = require('../services/AutoTaskService');
const { buildReportBackup } = require('../services/ReportBackupService');
const { safeParseJsonArray } = require('../utils/parseJson');

const HISTORY_PAGE_SIZES = new Set([10, 20, 50, 100, 200, 300, 500, 1000]);

function normalizeHistoryPagination(query = {}) {
  const requestedPage = Number(query.page);
  const requestedPageSize = Number(query.page_size);
  return {
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: HISTORY_PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 20
  };
}

async function serializeRule(rule, childNotifications = []) {
  const plain = rule.toJSON ? rule.toJSON() : rule;
  const dingtalkWebhooks = normalizeWebhookConfigs(plain.dingtalk_webhook);
  const dingtalkRecipients = normalizeRecipientConfig(plain.dingtalk_recipients);
  const nextRunAt = await getNextRunAtAsync({
    ...plain,
    month_days: safeParseJsonArray(plain.month_days),
    week_days: safeParseJsonArray(plain.week_days)
  });
  return {
    ...plain,
    month_days: safeParseJsonArray(plain.month_days),
    week_days: safeParseJsonArray(plain.week_days),
    dingtalk_webhooks: dingtalkWebhooks,
    dingtalk_recipients: dingtalkRecipients,
    duty_config: normalizeDutyConfig(plain.duty_config),
    child_notifications: await Promise.all(
      childNotifications.map(child => serializeChildNotificationAsync(child, plain))
    ),
    next_run_at: nextRunAt ? nextRunAt.toISOString() : null
  };
}

async function serializeRuleWithChildren(rule) {
  const children = await AutoTaskChildNotification.findAll({
    where: { rule_id: rule.id },
    order: [['created_at', 'ASC']]
  });
  return serializeRule(rule, children);
}

async function createRuleMessage(ruleId, level, action, message) {
  if (!ruleId || !message) return null;
  return AutoTaskMessage.create({
    id: uuidv4(),
    rule_id: ruleId,
    level,
    action,
    message,
    created_at: new Date()
  });
}

async function deleteMessageById(messageId, ruleId = null) {
  if (String(messageId).startsWith('run_')) {
    const id = String(messageId).slice(4);
    const where = ruleId ? { id, rule_id: ruleId } : { id };
    return AutoTaskRunLog.destroy({ where });
  }
  const where = ruleId ? { id: messageId, rule_id: ruleId } : { id: messageId };
  return AutoTaskMessage.destroy({ where });
}

/* GET /api/settings/auto-tasks */
router.get('/auto-tasks', async (req, res, next) => {
  try {
    const rules = await AutoTaskRule.findAll({ order: [['created_at', 'DESC']] });
    const logs = await AutoTaskRunLog.findAll({ order: [['created_at', 'DESC']], limit: 100 });
    const messages = await AutoTaskMessage.findAll({ order: [['created_at', 'DESC']], limit: 300 });
    const childNotifications = await AutoTaskChildNotification.findAll({ order: [['created_at', 'ASC']] });
    const childrenByRule = new Map();
    childNotifications.forEach(child => {
      if (!childrenByRule.has(child.rule_id)) childrenByRule.set(child.rule_id, []);
      childrenByRule.get(child.rule_id).push(child);
    });
    res.json({
      code: 0,
      data: {
        rules: await Promise.all(rules.map(rule => serializeRule(rule, childrenByRule.get(rule.id) || []))),
        logs,
        messages
      }
    });
  } catch (err) { next(err); }
});

/* GET /api/settings/auto-tasks/:id/history?page=1&page_size=20 */
router.get('/auto-tasks/:id/history', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id, { attributes: ['id'] });
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });

    const { page: requestedPage, pageSize } = normalizeHistoryPagination(req.query);
    const [messageCount, runCount] = await Promise.all([
      AutoTaskMessage.count({ where: { rule_id: rule.id } }),
      AutoTaskRunLog.count({ where: { rule_id: rule.id } })
    ]);
    const total = messageCount + runCount;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    const page = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;
    const offset = (page - 1) * pageSize;
    const items = total === 0 ? [] : await sequelize.query(`
      SELECT
        id,
        rule_id,
        NULL AS status,
        level,
        action,
        message,
        created_at,
        NULL AS scheduled_at,
        NULL AS attempt_count,
        NULL AS last_attempt_at,
        NULL AS next_retry_at,
        NULL AS notify_error,
        'message' AS source
      FROM auto_task_messages
      WHERE rule_id = :ruleId
      UNION ALL
      SELECT
        CONCAT('run_', id) AS id,
        rule_id,
        status,
        CASE
          WHEN status = 'success' THEN 'success'
          WHEN status = 'skipped' THEN 'warning'
          WHEN status IN ('failed', 'notify_failed') THEN 'error'
          ELSE 'info'
        END AS level,
        'auto_run' AS action,
        message,
        COALESCE(created_at, scheduled_at) AS created_at,
        scheduled_at,
        attempt_count,
        last_attempt_at,
        next_retry_at,
        notify_error,
        'run' AS source
      FROM auto_task_run_logs
      WHERE rule_id = :ruleId
      ORDER BY created_at DESC, id DESC
      LIMIT :limit OFFSET :offset
    `, {
      replacements: { ruleId: rule.id, limit: pageSize, offset },
      type: QueryTypes.SELECT
    });

    res.json({
      code: 0,
      data: {
        items,
        page,
        page_size: pageSize,
        total,
        total_pages: totalPages
      }
    });
  } catch (err) { next(err); }
});

/* POST /api/settings/auto-tasks */
router.post('/auto-tasks', async (req, res, next) => {
  try {
    const payload = normalizeRulePayload(req.body);
    const rule = await AutoTaskRule.create({
      id: uuidv4(),
      ...payload,
      created_at: new Date(),
      updated_at: new Date()
    });
    await createRuleMessage(rule.id, 'success', 'create', '规则创建成功');
    res.json({ code: 0, data: await serializeRuleWithChildren(rule), message: '编辑成功' });
  } catch (err) { next(err); }
});

/* PUT /api/settings/auto-tasks/:id */
router.put('/auto-tasks/:id', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    const payload = normalizeRulePayload(req.body, rule);
    await rule.update({ ...payload, updated_at: new Date() });
    if (!payload.enabled || !payload.notify_enabled || payload.action_mode === 'run_only' || payload.task_type !== 'task_create_notify') {
      await deactivateChildNotifications(rule.id);
    }
    await createRuleMessage(rule.id, 'success', 'update', '规则保存成功');
    res.json({ code: 0, data: await serializeRuleWithChildren(rule), message: '编辑成功' });
  } catch (err) { next(err); }
});

/* PATCH /api/settings/auto-tasks/:id/status */
router.patch('/auto-tasks/:id/status', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    rule.enabled = req.body.enabled === true;
    rule.updated_at = new Date();
    await rule.save();
    if (!rule.enabled) await deactivateChildNotifications(rule.id);
    await createRuleMessage(rule.id, 'success', 'status', rule.enabled ? '规则已启用' : '规则已停用');
    res.json({ code: 0, data: await serializeRuleWithChildren(rule), message: '编辑成功' });
  } catch (err) { next(err); }
});

/* POST /api/settings/auto-tasks/:id/child-notifications */
router.post('/auto-tasks/:id/child-notifications', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    const payload = normalizeChildNotificationPayload(req.body, null, rule);
    const child = await AutoTaskChildNotification.create({
      id: uuidv4(),
      rule_id: rule.id,
      ...payload,
      activation_token: null,
      status: 'inactive',
      created_at: new Date(),
      updated_at: new Date()
    });
    await createRuleMessage(rule.id, 'success', 'child_notify', '子通知已新增');
    res.json({ code: 0, data: await serializeChildNotificationAsync(child, rule), message: '子通知已保存' });
  } catch (err) { next(err); }
});

/* PUT /api/settings/auto-tasks/:id/child-notifications/:childId */
router.put('/auto-tasks/:id/child-notifications/:childId', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    const child = await AutoTaskChildNotification.findOne({
      where: { id: req.params.childId, rule_id: rule.id }
    });
    if (!child) return res.status(404).json({ code: 1, message: '子通知不存在' });
    const payload = normalizeChildNotificationPayload(req.body, child, rule);
    const wasEnabled = child.enabled === true;
    const nextEnabled = payload.enabled === true;
    const lifecycleReset = wasEnabled !== nextEnabled;
    await child.update({
      ...payload,
      ...(lifecycleReset ? {
        activation_token: null,
        activation_scheduled_at: null,
        activated_at: null,
        status: 'inactive',
        last_error: null,
        attempt_count: 0,
        last_attempt_at: null,
        next_retry_at: null
      } : {}),
      updated_at: new Date()
    });
    await createRuleMessage(rule.id, 'success', 'child_notify', '子通知已保存');
    res.json({ code: 0, data: await serializeChildNotificationAsync(child, rule), message: '子通知已保存' });
  } catch (err) { next(err); }
});

/* PATCH /api/settings/auto-tasks/:id/child-notifications/:childId/status */
router.patch('/auto-tasks/:id/child-notifications/:childId/status', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    const child = await AutoTaskChildNotification.findOne({
      where: { id: req.params.childId, rule_id: rule.id }
    });
    if (!child) return res.status(404).json({ code: 1, message: '子通知不存在' });
    await child.update({
      enabled: req.body.enabled === true,
      activation_token: null,
      activation_scheduled_at: null,
      activated_at: null,
      status: 'inactive',
      last_error: null,
      attempt_count: 0,
      last_attempt_at: null,
      next_retry_at: null,
      updated_at: new Date()
    });
    await createRuleMessage(rule.id, 'success', 'child_notify', child.enabled ? '子通知已启用，等待主通知触发' : '子通知已停用');
    res.json({ code: 0, data: await serializeChildNotificationAsync(child, rule), message: '子通知状态已更新' });
  } catch (err) { next(err); }
});

/* POST /api/settings/auto-tasks/:id/child-notifications/:childId/test-notify */
router.post('/auto-tasks/:id/child-notifications/:childId/test-notify', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    const child = await AutoTaskChildNotification.findOne({
      where: { id: req.params.childId, rule_id: rule.id }
    });
    if (!child) return res.status(404).json({ code: 1, message: '子通知不存在' });
    const result = await testChildNotification(child, rule);
    res.json({ code: 0, data: result, message: '子通知测试发送成功' });
  } catch (err) { next(err); }
});

/* DELETE /api/settings/auto-tasks/:id/child-notifications/:childId */
router.delete('/auto-tasks/:id/child-notifications/:childId', async (req, res, next) => {
  try {
    const count = await AutoTaskChildNotification.destroy({
      where: { id: req.params.childId, rule_id: req.params.id }
    });
    if (count === 0) return res.status(404).json({ code: 1, message: '子通知不存在' });
    await createRuleMessage(req.params.id, 'success', 'child_notify', '子通知已删除');
    res.json({ code: 0, message: '子通知已删除' });
  } catch (err) { next(err); }
});

/* POST /api/settings/auto-tasks/:id/messages */
router.post('/auto-tasks/:id/messages', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ code: 1, message: '提示内容不能为空' });
    const level = ['success', 'warning', 'error', 'info'].includes(req.body.level) ? req.body.level : 'info';
    const action = String(req.body.action || 'info').slice(0, 50);
    const row = await createRuleMessage(rule.id, level, action, message);
    res.json({ code: 0, data: row, message: '已记录' });
  } catch (err) { next(err); }
});

/* DELETE /api/settings/auto-tasks/messages/:messageId */
router.delete('/auto-tasks/messages/:messageId', async (req, res, next) => {
  try {
    await deleteMessageById(req.params.messageId);
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

/* DELETE /api/settings/auto-tasks/:id/messages */
router.delete('/auto-tasks/:id/messages', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length > 0) {
      for (const id of ids) {
        await deleteMessageById(id, rule.id);
      }
    } else {
      await AutoTaskMessage.destroy({ where: { rule_id: rule.id } });
      await AutoTaskRunLog.destroy({ where: { rule_id: rule.id } });
    }
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

/* DELETE /api/settings/auto-tasks/:id */
router.delete('/auto-tasks/:id', async (req, res, next) => {
  try {
    await AutoTaskChildNotification.destroy({ where: { rule_id: req.params.id } });
    await DutySpecialNotificationLog.destroy({ where: { rule_id: req.params.id } });
    await DutyScheduleSwap.destroy({ where: { rule_id: req.params.id } });
    await DutyScheduleException.destroy({ where: { rule_id: req.params.id } });
    await AutoTaskMessage.destroy({ where: { rule_id: req.params.id } });
    await AutoTaskRunLog.destroy({ where: { rule_id: req.params.id } });
    const count = await AutoTaskRule.destroy({ where: { id: req.params.id } });
    if (count === 0) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    res.json({ code: 0, message: '已删除' });
  } catch (err) { next(err); }
});

/* GET /api/settings/auto-tasks/logs */
router.get('/auto-tasks/logs', async (req, res, next) => {
  try {
    const logs = await AutoTaskRunLog.findAll({ order: [['created_at', 'DESC']], limit: 50 });
    res.json({ code: 0, data: logs });
  } catch (err) { next(err); }
});

/* POST /api/settings/auto-tasks/:id/test-run */
router.post('/auto-tasks/:id/test-run', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    const result = await runRuleOnce(rule);
    await createRuleMessage(rule.id, result.ok ? 'success' : 'error', 'test_run', result.message);
    res.json({
      code: result.ok ? 0 : 1,
      data: result,
      message: result.message
    });
  } catch (err) { next(err); }
});

/* POST /api/settings/auto-tasks/test-notify */
router.post('/auto-tasks/test-notify', async (req, res, next) => {
  try {
    const webhooks = normalizeWebhookList(req.body.dingtalk_webhooks ?? req.body.dingtalk_webhook);
    let message = String(req.body.dingtalk_message || '').trim();
    const ruleId = req.body.rule_id;
    if (webhooks.length === 0) {
      await createRuleMessage(ruleId, 'warning', 'validate', '请至少配置一个钉钉 webhook');
      return res.status(400).json({ code: 1, message: '请至少配置一个钉钉 webhook' });
    }
    if (!message) {
      await createRuleMessage(ruleId, 'warning', 'validate', '请填写通知内容');
      return res.status(400).json({ code: 1, message: '请填写通知内容' });
    }

    // v3.3.0 名句搭配：值班通知场景（"测试发送 webhook"/"单条值班通知发送"）也注入名句，
    // 与定时调度 executeDutyEvent 行为一致，共享同一个候选队列与去重历史。
    const isDutyContext =
      ruleId &&
      String(req.body.task_type || '') === 'duty_notify' &&
      (req.body.test_source === 'duty_today_test' || req.body.test_source === 'duty_preview_line');
    if (isDutyContext) {
      try {
        const { consumeQuotes } = require('../services/AutoTaskService').__internals || {};
        const consume = consumeQuotes || require('../services/QuoteService').consumeQuotes;
        const quotes = await consume(ruleId, 1);
        if (quotes.length && quotes[0]) {
          message = `${quotes[0]}\n${message}`;
        }
      } catch (quoteErr) {
        console.warn(`[duty-quote] /test-notify 规则 ${ruleId} 名句注入失败：${quoteErr.message}`);
      }
    }

    const result = await sendDingTalkWebhook({
      task_type: req.body.task_type,
      dingtalk_webhooks: req.body.dingtalk_webhooks ?? req.body.dingtalk_webhook,
      dingtalk_message: message,
      dingtalk_recipients: req.body.dingtalk_recipients
    });
    const isDutyLineSend = req.body.test_source === 'duty_preview_line';
    const action = isDutyLineSend ? 'duty_line_send' : 'test_notify';
    const successMessage = isDutyLineSend ? '单条值班通知发送成功' : '测试发送成功';
    await createRuleMessage(ruleId, 'success', action, successMessage);
    res.json({ code: 0, data: result, message: successMessage });
  } catch (err) {
    const isDutyLineSend = req.body?.test_source === 'duty_preview_line';
    const action = isDutyLineSend ? 'duty_line_send' : 'test_notify';
    const errorPrefix = isDutyLineSend ? '单条值班通知发送失败' : '测试发送失败';
    await createRuleMessage(req.body?.rule_id, 'error', action, `${errorPrefix}：${err.message}`);
    res.status(400).json({ code: 1, message: `${errorPrefix}：${err.message}` });
  }
});

/* GET /api/settings/report-backup?format=xlsx|md */
router.get('/report-backup', async (req, res, next) => {
  try {
    const { filename, mime, buffer } = await buildReportBackup(req.query.format);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.end(buffer);
  } catch (err) { next(err); }
});

module.exports = router;
