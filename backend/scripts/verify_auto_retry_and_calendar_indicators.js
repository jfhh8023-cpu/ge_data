const assert = require('assert');
const http = require('http');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

process.env.ALLOW_LOCAL_WEBHOOK_TEST = '1';

const {
  sequelize,
  AutoTaskChildNotification,
  AutoTaskMessage,
  AutoTaskRule,
  AutoTaskRunLog,
  DutyScheduleException,
  DutySpecialNotificationLog
} = require('../src/models');
const {
  ensureAutoTaskTables,
  executeChildNotification,
  executeDutyEvent,
  executeRule,
  processDueRunRetries,
  processDueSpecialDutyNotifications
} = require('../src/services/AutoTaskService');
const { ensureDutyCalendarTables } = require('../src/services/DutyCalendarService');

const TEST_PREFIX = 'CODEX-RETRY-20260901';
const FIVE_MINUTES_MS = 5 * 60 * 1000;

function webhookConfig(port) {
  return JSON.stringify([{
    id: 'local_retry_webhook',
    name: '本地重试验证webhook',
    url: `http://127.0.0.1:${port}/retry`
  }]);
}

function recipientsConfig() {
  return JSON.stringify({ enabled: false, at_all: false, staff_ids: [] });
}

function assertFiveMinuteRetry(row) {
  assert.ok(row.next_retry_at, '失败后必须生成下一次重试时间');
  const base = new Date(row.last_attempt_at).getTime();
  const retry = new Date(row.next_retry_at).getTime();
  assert.ok(Math.abs(retry - base - FIVE_MINUTES_MS) < 1000, '重试间隔必须为 5 分钟');
}

async function startReceiver() {
  const received = [];
  const responseCodes = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url, body: Buffer.concat(chunks).toString('utf8') });
      const status = responseCodes.length ? responseCodes.shift() : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(status === 200
        ? JSON.stringify({ errcode: 0, errmsg: 'ok' })
        : JSON.stringify({ errcode: 500001, errmsg: 'controlled failure' }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    received,
    responseCodes,
    port: server.address().port
  };
}

async function createRule(port, overrides = {}) {
  const now = new Date();
  return AutoTaskRule.create({
    id: uuidv4(),
    name: `${TEST_PREFIX}-${uuidv4().slice(0, 8)}`,
    enabled: true,
    task_type: 'task_create_notify',
    action_mode: 'run_and_notify',
    schedule_type: 'weekly',
    schedule_year: now.getFullYear(),
    month_days: [],
    week_days: [1],
    execute_time: '09:00:00',
    notify_enabled: true,
    dingtalk_webhook: webhookConfig(port),
    dingtalk_message: `${TEST_PREFIX} 自动通知`,
    dingtalk_recipients: recipientsConfig(),
    duty_config: JSON.stringify({}),
    created_at: new Date('2026-01-01T00:00:00+08:00'),
    updated_at: new Date('2026-01-01T00:00:00+08:00'),
    ...overrides
  });
}

async function cleanup(ruleIds) {
  if (!ruleIds.length) return;
  await DutySpecialNotificationLog.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
  await DutyScheduleException.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
  await AutoTaskChildNotification.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
  await AutoTaskRunLog.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
  await AutoTaskMessage.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
  await AutoTaskRule.destroy({ where: { id: { [Op.in]: ruleIds } } });
}

async function main() {
  await ensureAutoTaskTables();
  await ensureDutyCalendarTables();
  const receiver = await startReceiver();
  const ruleIds = [];
  const evidence = {};
  try {
    const idempotentRule = await createRule(receiver.port);
    ruleIds.push(idempotentRule.id);
    receiver.responseCodes.push(500, 200);
    let createCalls = 0;
    const fakeTaskId = uuidv4();
    const createTask = async () => {
      createCalls += 1;
      return { created: true, task: { id: fakeTaskId }, message: '模拟任务已创建' };
    };
    const scheduledAt = new Date('2026-09-01T09:00:00+08:00');
    let log = await executeRule(idempotentRule, scheduledAt, { createTask });
    assert.strictEqual(log.status, 'notify_failed');
    assert.strictEqual(log.attempt_count, 1);
    assert.strictEqual(log.created_task_id, fakeTaskId);
    assertFiveMinuteRetry(log);
    assert.strictEqual(createCalls, 1);

    const beforeRetry = new Date(new Date(log.next_retry_at).getTime() - 1000);
    assert.strictEqual(
      await processDueRunRetries(beforeRetry, new Map([[idempotentRule.id, idempotentRule]]), { createTask }),
      0
    );
    const dueRetry = new Date(new Date(log.next_retry_at).getTime() + 1);
    assert.strictEqual(
      await processDueRunRetries(dueRetry, new Map([[idempotentRule.id, idempotentRule]]), { createTask }),
      1
    );
    await log.reload();
    assert.strictEqual(log.status, 'success');
    assert.strictEqual(log.attempt_count, 2);
    assert.strictEqual(log.created_task_id, fakeTaskId);
    assert.strictEqual(createCalls, 1, '任务创建成功后，通知重试不得再次调用任务创建');
    assert.strictEqual(await executeRule(idempotentRule, scheduledAt, { createTask }), null);
    assert.strictEqual(await AutoTaskRunLog.count({ where: { rule_id: idempotentRule.id } }), 1);
    evidence.task_idempotency = { attempts: log.attempt_count, create_calls: createCalls };

    const maxRetryRule = await createRule(receiver.port, { action_mode: 'notify_only' });
    ruleIds.push(maxRetryRule.id);
    receiver.responseCodes.push(500, 500, 500);
    log = await executeRule(maxRetryRule, new Date('2026-09-01T09:10:00+08:00'));
    for (let expected = 2; expected <= 3; expected += 1) {
      assertFiveMinuteRetry(log);
      const retryAt = new Date(new Date(log.next_retry_at).getTime() + 1);
      await processDueRunRetries(retryAt, new Map([[maxRetryRule.id, maxRetryRule]]));
      await log.reload();
      assert.strictEqual(log.attempt_count, expected);
    }
    assert.strictEqual(log.status, 'notify_failed');
    assert.strictEqual(log.next_retry_at, null);
    const requestsAtLimit = receiver.received.length;
    await processDueRunRetries(new Date('2027-01-01T00:00:00+08:00'), new Map([[maxRetryRule.id, maxRetryRule]]));
    assert.strictEqual(receiver.received.length, requestsAtLimit);
    evidence.max_attempts = { attempts: log.attempt_count, exhausted: log.next_retry_at === null };

    const executionRule = await createRule(receiver.port, { action_mode: 'run_only', notify_enabled: false });
    ruleIds.push(executionRule.id);
    let executionCalls = 0;
    const retryingCreateTask = async () => {
      executionCalls += 1;
      if (executionCalls === 1) throw new Error('controlled task creation failure');
      return { created: true, task: { id: uuidv4() }, message: '规则重试创建成功' };
    };
    log = await executeRule(executionRule, new Date('2026-09-01T09:20:00+08:00'), {
      createTask: retryingCreateTask
    });
    assert.strictEqual(log.status, 'failed');
    assertFiveMinuteRetry(log);
    await processDueRunRetries(
      new Date(new Date(log.next_retry_at).getTime() + 1),
      new Map([[executionRule.id, executionRule]]),
      { createTask: retryingCreateTask }
    );
    await log.reload();
    assert.strictEqual(log.status, 'success');
    assert.strictEqual(log.attempt_count, 2);
    assert.strictEqual(executionCalls, 2);
    assert.ok(log.created_task_id);
    evidence.rule_execution_retry = { attempts: log.attempt_count, create_calls: executionCalls };

    const dutyRule = await createRule(receiver.port, {
      task_type: 'duty_notify',
      action_mode: 'notify_only',
      duty_config: JSON.stringify({ weekly: {}, monthly: {} })
    });
    ruleIds.push(dutyRule.id);
    receiver.responseCodes.push(500, 500);
    const dutyEvents = [
      {
        kind: 'start',
        scheduledAt: new Date('2026-09-01T09:30:00+08:00'),
        message: `${TEST_PREFIX} 值班开始提醒`,
        staff_ids: []
      },
      {
        kind: 'end',
        scheduledAt: new Date('2026-09-01T18:30:00+08:00'),
        message: `${TEST_PREFIX} 值班结束提醒`,
        staff_ids: []
      }
    ];
    const firstDutyRequestIndex = receiver.received.length;
    for (const event of dutyEvents) await executeDutyEvent(dutyRule, event);
    const dutyLogs = await AutoTaskRunLog.findAll({
      where: { rule_id: dutyRule.id },
      order: [['scheduled_at', 'ASC']]
    });
    assert.strictEqual(dutyLogs.length, 2);
    dutyLogs.forEach(item => {
      assert.strictEqual(item.status, 'notify_failed');
      assert.strictEqual(item.attempt_count, 1);
      assertFiveMinuteRetry(item);
    });
    receiver.responseCodes.push(200, 200);
    const dutyRetryAt = new Date(Math.max(...dutyLogs.map(item => new Date(item.next_retry_at).getTime())) + 1);
    assert.strictEqual(
      await processDueRunRetries(dutyRetryAt, new Map([[dutyRule.id, dutyRule]])),
      2
    );
    for (const item of dutyLogs) {
      await item.reload();
      assert.strictEqual(item.status, 'success');
      assert.strictEqual(item.attempt_count, 2);
    }
    const dutyRequests = receiver.received.slice(firstDutyRequestIndex);
    assert.strictEqual(dutyRequests.length, 4);
    const dutyBodyCounts = new Map();
    dutyRequests.forEach(request => {
      dutyBodyCounts.set(request.body, (dutyBodyCounts.get(request.body) || 0) + 1);
    });
    assert.strictEqual(dutyBodyCounts.size, 2, '开始和结束提醒必须各自使用独立快照');
    dutyBodyCounts.forEach(count => assert.strictEqual(count, 2, '每条值班提醒应为首次发送一次、重试一次'));
    evidence.duty_notification_retry = {
      start_attempts: dutyLogs[0].attempt_count,
      end_attempts: dutyLogs[1].attempt_count,
      retry_payload_reused: true
    };

    const childRule = await createRule(receiver.port);
    ruleIds.push(childRule.id);
    const child = await AutoTaskChildNotification.create({
      id: uuidv4(),
      rule_id: childRule.id,
      enabled: true,
      schedule_type: 'weekly',
      month_days: [],
      week_days: [1],
      execute_time: '10:00:00',
      message: `${TEST_PREFIX} 子通知`,
      webhook_target_mode: 'all',
      webhook_ids: JSON.stringify([]),
      activation_token: uuidv4(),
      activation_scheduled_at: scheduledAt,
      activated_at: scheduledAt,
      status: 'pending',
      attempt_count: 0,
      created_at: scheduledAt,
      updated_at: scheduledAt
    });
    receiver.responseCodes.push(500, 200);
    const childFirstAttemptAt = new Date('2026-09-01T10:00:30+08:00');
    await executeChildNotification(
      child,
      childRule,
      new Date('2026-09-01T10:00:00+08:00'),
      { now: childFirstAttemptAt }
    );
    await child.reload();
    assert.strictEqual(child.status, 'failed');
    assertFiveMinuteRetry(child);
    await executeChildNotification(
      child,
      childRule,
      new Date(child.last_scheduled_at),
      { retry: true, now: new Date(new Date(child.next_retry_at).getTime() + 1) }
    );
    await child.reload();
    assert.strictEqual(child.status, 'sent');
    assert.strictEqual(child.attempt_count, 2);
    evidence.child_retry = { attempts: child.attempt_count, status: child.status };

    const specialRule = await createRule(receiver.port, {
      task_type: 'duty_notify',
      action_mode: 'notify_only',
      duty_config: JSON.stringify({ weekly: {}, monthly: {} })
    });
    ruleIds.push(specialRule.id);
    const exception = await DutyScheduleException.create({
      id: uuidv4(),
      rule_id: specialRule.id,
      calendar_date: '2026-09-01',
      skip_staff_ids: JSON.stringify([]),
      notice_enabled: true,
      notice_time: '11:00:00',
      notice_message: `${TEST_PREFIX} 特殊日期通知`,
      notice_at_mode: 'none',
      notice_staff_ids: JSON.stringify([]),
      notice_webhook_ids: JSON.stringify([]),
      status: 'active',
      revision: 1,
      created_at: new Date('2026-08-01T00:00:00+08:00'),
      updated_at: new Date('2026-08-01T00:00:00+08:00')
    });
    receiver.responseCodes.push(500, 200);
    await processDueSpecialDutyNotifications(new Date('2026-09-01T11:00:30+08:00'), {
      ruleIds: [specialRule.id]
    });
    const specialLog = await DutySpecialNotificationLog.findOne({ where: { exception_id: exception.id } });
    assert.strictEqual(specialLog.status, 'failed');
    assertFiveMinuteRetry(specialLog);
    await processDueSpecialDutyNotifications(new Date(new Date(specialLog.next_retry_at).getTime() + 1), {
      ruleIds: [specialRule.id]
    });
    await specialLog.reload();
    assert.strictEqual(specialLog.status, 'success');
    assert.strictEqual(specialLog.attempt_count, 2);
    evidence.special_notice_retry = { attempts: specialLog.attempt_count, status: specialLog.status };

    console.log(JSON.stringify({ ok: true, evidence, webhook_requests: receiver.received.length }, null, 2));
  } finally {
    await cleanup(ruleIds);
    await new Promise(resolve => receiver.server.close(resolve));
    await sequelize.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
