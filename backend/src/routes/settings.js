/**
 * Settings routes — v3.1.0
 * 自动任务配置与需求工时统计全量备份下载
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { AutoTaskRule, AutoTaskRunLog, AutoTaskMessage } = require('../models');
const {
  getNextRunAt,
  normalizeDutyConfig,
  normalizeRulePayload,
  normalizeRecipientConfig,
  normalizeWebhookConfigs,
  normalizeWebhookList,
  runRuleOnce,
  sendDingTalkWebhook
} = require('../services/AutoTaskService');
const { buildReportBackup } = require('../services/ReportBackupService');
const { safeParseJsonArray } = require('../utils/parseJson');

function serializeRule(rule) {
  const plain = rule.toJSON ? rule.toJSON() : rule;
  const dingtalkWebhooks = normalizeWebhookConfigs(plain.dingtalk_webhook);
  const dingtalkRecipients = normalizeRecipientConfig(plain.dingtalk_recipients);
  const nextRunAt = getNextRunAt({
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
    next_run_at: nextRunAt ? nextRunAt.toISOString() : null
  };
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
    res.json({
      code: 0,
      data: {
        rules: rules.map(serializeRule),
        logs,
        messages
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
    res.json({ code: 0, data: serializeRule(rule), message: '编辑成功' });
  } catch (err) { next(err); }
});

/* PUT /api/settings/auto-tasks/:id */
router.put('/auto-tasks/:id', async (req, res, next) => {
  try {
    const rule = await AutoTaskRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ code: 1, message: '自动任务规则不存在' });
    const payload = normalizeRulePayload(req.body, rule);
    await rule.update({ ...payload, updated_at: new Date() });
    await createRuleMessage(rule.id, 'success', 'update', '规则保存成功');
    res.json({ code: 0, data: serializeRule(rule), message: '编辑成功' });
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
    await createRuleMessage(rule.id, 'success', 'status', rule.enabled ? '规则已启用' : '规则已停用');
    res.json({ code: 0, data: serializeRule(rule), message: '编辑成功' });
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
    const message = String(req.body.dingtalk_message || '').trim();
    const ruleId = req.body.rule_id;
    if (webhooks.length === 0) {
      await createRuleMessage(ruleId, 'warning', 'validate', '请至少配置一个钉钉 webhook');
      return res.status(400).json({ code: 1, message: '请至少配置一个钉钉 webhook' });
    }
    if (!message) {
      await createRuleMessage(ruleId, 'warning', 'validate', '请填写通知内容');
      return res.status(400).json({ code: 1, message: '请填写通知内容' });
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
