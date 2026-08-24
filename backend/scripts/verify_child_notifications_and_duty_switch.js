const assert = require('assert');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

process.env.ALLOW_LOCAL_WEBHOOK_TEST = '1';

const {
  sequelize,
  AutoTaskRule,
  AutoTaskChildNotification,
  AutoTaskMessage,
  AutoTaskRunLog
} = require('../src/models');
const {
  activateChildNotifications,
  childNotificationFallbackMatch,
  deactivateChildNotifications,
  ensureAutoTaskTables,
  getDutyItemForParts,
  getDueDutyEvents,
  getNextChildRunAt,
  normalizeChildNotificationPayload,
  normalizeDutyConfig,
  normalizeRulePayload,
  processDueChildNotifications,
  recoverChildNotificationsFromParentEvidence,
  schedulerTick,
  testChildNotification
} = require('../src/services/AutoTaskService');
const { getBeijingParts, getWeekdayNumber } = require('../src/utils/beijingTime');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dutyItem(staffId) {
  return {
    enabled: true,
    staff_ids: [staffId],
    start_time: '09:15:00',
    end_time: '20:00:00',
    send_mode: 'start_only',
    start_message: 'local duty test',
    end_message: ''
  };
}

function weeklyMap(staffId) {
  return Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), dutyItem(staffId)]));
}

function parts(ymd) {
  const [year, month, day] = ymd.split('-').map(Number);
  return { year, month, day, date: ymd };
}

function childLifecycleSnapshot(child) {
  const normalizeDate = value => value ? new Date(value).toISOString() : null;
  return {
    activation_token: child.activation_token ?? null,
    status: child.status,
    next_run_at: normalizeDate(child.next_run_at),
    last_sent_at: normalizeDate(child.last_sent_at)
  };
}

async function main() {
  await ensureAutoTaskTables();
  const ruleId = uuidv4();
  const scheduledRuleId = uuidv4();
  const childIds = [];
  const received = [];
  const receiver = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      received.push({ ...payload, __test_url: req.url });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url === '/fail'
        ? { errcode: 310000, errmsg: 'isolated failure' }
        : { errcode: 0, errmsg: 'ok' }));
    });
  });

  try {
    await new Promise((resolve, reject) => {
      receiver.once('error', reject);
      receiver.listen(0, '127.0.0.1', resolve);
    });
    const port = receiver.address().port;
    const now = new Date();
    const fallbackNow = new Date('2026-08-09T12:00:00+08:00');
    const fallbackRule = {
      enabled: true,
      task_type: 'task_create_notify',
      action_mode: 'run_and_notify',
      schedule_type: 'weekly',
      week_days: [5],
      month_days: [],
      execute_time: '10:00:00',
      notify_enabled: true
    };
    const fallbackWithoutLog = childNotificationFallbackMatch(fallbackRule, null, fallbackNow);
    assert.strictEqual(fallbackWithoutLog.matched, true, 'enabled parent with a valid countdown under six days must match fallback');
    assert.strictEqual(fallbackWithoutLog.source, 'countdown');
    const fallbackWithSuccessLog = childNotificationFallbackMatch(fallbackRule, {
      scheduled_at: new Date('2026-08-07T10:00:00+08:00'),
      status: 'success',
      notify_status: 'success'
    }, fallbackNow);
    assert.strictEqual(fallbackWithSuccessLog.matched, true, 'a current-cycle success record must corroborate fallback');
    assert.strictEqual(fallbackWithSuccessLog.source, 'run_log');
    const fallbackWithFailedLog = childNotificationFallbackMatch(fallbackRule, {
      scheduled_at: new Date('2026-08-07T10:00:00+08:00'),
      status: 'notify_failed',
      notify_status: 'failed'
    }, fallbackNow);
    assert.strictEqual(fallbackWithFailedLog.matched, false, 'an explicit current-cycle failure must block countdown fallback');
    assert.strictEqual(fallbackWithFailedLog.reason, 'explicit_non_success_record');
    for (const blockingRecord of [
      { status: 'running', notify_status: 'not_required' },
      { status: 'skipped', notify_status: 'skipped' },
      { status: 'failed', notify_status: 'not_required' },
      { status: 'success', notify_status: 'failed' }
    ]) {
      const blocked = childNotificationFallbackMatch(fallbackRule, {
        scheduled_at: new Date('2026-08-07T10:00:00+08:00'),
        ...blockingRecord
      }, fallbackNow);
      assert.strictEqual(blocked.matched, false, `${blockingRecord.status}/${blockingRecord.notify_status} must block countdown fallback`);
      assert.strictEqual(blocked.reason, 'explicit_non_success_record');
    }
    const exactSixDayBoundary = childNotificationFallbackMatch({
      ...fallbackRule,
      week_days: [6],
      execute_time: '12:00:00'
    }, null, fallbackNow);
    assert.strictEqual(exactSixDayBoundary.remaining_ms, 6 * 24 * 60 * 60 * 1000);
    assert.strictEqual(exactSixDayBoundary.matched, false, 'exactly six full days must not match the strict fallback window');
    const successRecordOutsideFallbackWindow = childNotificationFallbackMatch({
      ...fallbackRule,
      week_days: [6],
      execute_time: '12:00:00'
    }, {
      scheduled_at: new Date('2026-08-08T12:00:00+08:00'),
      status: 'success',
      notify_status: 'success'
    }, fallbackNow);
    assert.strictEqual(successRecordOutsideFallbackWindow.matched, true, 'a real current-cycle success record must take priority over the fallback window');
    assert.strictEqual(successRecordOutsideFallbackWindow.source, 'run_log');
    assert.strictEqual(
      childNotificationFallbackMatch({ ...fallbackRule, notify_enabled: false }, null, fallbackNow).matched,
      false,
      'disabled parent notification must not match fallback'
    );
    assert.strictEqual(
      childNotificationFallbackMatch({ ...fallbackRule, enabled: false }, null, fallbackNow).matched,
      false,
      'disabled parent rule must not match fallback'
    );
    assert.strictEqual(
      childNotificationFallbackMatch({ ...fallbackRule, action_mode: 'run_only' }, null, fallbackNow).matched,
      false,
      'run-only parent rule must not match fallback'
    );
    const target = new Date(now.getTime() + 4000);
    const targetParts = getBeijingParts(target);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowParts = getBeijingParts(tomorrow);
    const webhook = {
      id: 'webhook_codex_receiver',
      name: 'local receiver',
      url: `http://127.0.0.1:${port}/mock`
    };
    const failingWebhook = {
      id: 'webhook_codex_failure',
      name: 'local failure receiver',
      url: `http://127.0.0.1:${port}/fail`
    };
    const rule = await AutoTaskRule.create({
      id: ruleId,
      name: 'Codex isolated child notification verification',
      enabled: true,
      task_type: 'task_create_notify',
      action_mode: 'run_and_notify',
      schedule_type: 'weekly',
      week_days: [getWeekdayNumber(tomorrowParts.date)],
      month_days: [],
      execute_time: '00:00:00',
      notify_enabled: true,
      dingtalk_webhook: JSON.stringify([webhook, failingWebhook]),
      dingtalk_message: 'isolated parent message',
      dingtalk_recipients: JSON.stringify({ enabled: false, at_mode: 'people', staff_ids: [], extra: [] }),
      duty_config: null,
      created_at: now,
      updated_at: now
    });

    const weeklyPayload = normalizeChildNotificationPayload({
      enabled: true,
      schedule_type: 'weekly',
      week_days: [getWeekdayNumber(targetParts.date)],
      month_days: [],
      execute_time: targetParts.time,
      message: 'isolated child message',
      webhook_target_mode: 'selected',
      webhook_ids: [webhook.id]
    }, null, rule);
    const weeklyChild = await AutoTaskChildNotification.create({
      id: uuidv4(),
      rule_id: rule.id,
      ...weeklyPayload,
      status: 'inactive',
      created_at: now,
      updated_at: now
    });
    childIds.push(weeklyChild.id);

    const lifecycleBeforeTest = childLifecycleSnapshot(weeklyChild);
    const testResult = await testChildNotification(weeklyChild, rule);
    await weeklyChild.reload();
    assert.strictEqual(received.length, 1, 'single-child test must send exactly one webhook request');
    assert.strictEqual(testResult.total, 1, 'single-child test must use only the selected webhook');
    assert.ok(received.some(item => item?.markdown?.text?.includes('isolated child message')));
    assert.ok(received[0]?.markdown?.title?.includes('子通知测试'));
    assert.deepStrictEqual(
      childLifecycleSnapshot(weeklyChild),
      lifecycleBeforeTest,
      'manual test must not mutate the formal child lifecycle'
    );
    received.length = 0;

    const schedulerTarget = new Date(Date.now() + 2000);
    const schedulerParts = getBeijingParts(schedulerTarget);
    const scheduledRule = await AutoTaskRule.create({
      id: scheduledRuleId,
      name: 'Codex isolated scheduled parent verification',
      enabled: true,
      task_type: 'task_create_notify',
      action_mode: 'notify_only',
      schedule_type: 'weekly',
      week_days: [getWeekdayNumber(schedulerParts.date)],
      month_days: [],
      execute_time: schedulerParts.time,
      notify_enabled: true,
      dingtalk_webhook: JSON.stringify([webhook]),
      dingtalk_message: 'isolated scheduled parent message',
      dingtalk_recipients: JSON.stringify({ enabled: false, at_mode: 'people', staff_ids: [], extra: [] }),
      duty_config: null,
      created_at: now,
      updated_at: now
    });
    const scheduledChild = await AutoTaskChildNotification.create({
      id: uuidv4(),
      rule_id: scheduledRule.id,
      ...normalizeChildNotificationPayload({
        enabled: true,
        schedule_type: 'weekly',
        week_days: [getWeekdayNumber(tomorrowParts.date)],
        month_days: [],
        execute_time: '09:45:00',
        message: 'isolated scheduled child message',
        webhook_target_mode: 'all',
        webhook_ids: []
      }, null, scheduledRule),
      status: 'inactive',
      created_at: now,
      updated_at: now
    });
    await sleep(Math.max(0, schedulerTarget.getTime() - Date.now()) + 350);
    await schedulerTick();
    let scheduledRunLog = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      scheduledRunLog = await AutoTaskRunLog.findOne({ where: { rule_id: scheduledRule.id } });
      if (scheduledRunLog && scheduledRunLog.status !== 'running') break;
      await sleep(100);
    }
    await scheduledChild.reload();
    assert.strictEqual(received.length, 1, 'one scheduled parent notification must be sent');
    assert.ok(received[0]?.markdown?.text?.includes('isolated scheduled parent message'));
    assert.strictEqual(scheduledRunLog?.status, 'success');
    assert.strictEqual(scheduledRunLog?.notify_status, 'success');
    assert.strictEqual(scheduledChild.status, 'pending', 'successful scheduled parent notification must activate its child');
    assert.ok(scheduledChild.activation_token);
    const scheduledPipelineStatus = scheduledChild.status;
    assert.strictEqual(await deactivateChildNotifications(scheduledRule.id), 1);
    await scheduledChild.reload();
    assert.strictEqual(scheduledChild.status, 'inactive');
    const scheduledDeactivatedStatus = scheduledChild.status;
    await AutoTaskChildNotification.destroy({ where: { rule_id: scheduledRule.id } });
    await AutoTaskMessage.destroy({ where: { rule_id: scheduledRule.id } });
    await AutoTaskRunLog.destroy({ where: { rule_id: scheduledRule.id } });
    await AutoTaskRule.destroy({ where: { id: scheduledRule.id } });
    received.length = 0;

    const monthlyPayload = normalizeChildNotificationPayload({
      enabled: true,
      schedule_type: 'monthly',
      week_days: [],
      month_days: [31],
      execute_time: '11:22:33',
      message: 'isolated month-end child',
      webhook_target_mode: 'all',
      webhook_ids: []
    }, null, rule);
    const monthlyChild = await AutoTaskChildNotification.create({
      id: uuidv4(),
      rule_id: rule.id,
      ...monthlyPayload,
      status: 'inactive',
      created_at: now,
      updated_at: now
    });
    childIds.push(monthlyChild.id);

    const failurePayload = normalizeChildNotificationPayload({
      enabled: true,
      schedule_type: 'weekly',
      week_days: [getWeekdayNumber(targetParts.date)],
      month_days: [],
      execute_time: targetParts.time,
      message: 'isolated failing child message',
      webhook_target_mode: 'selected',
      webhook_ids: [failingWebhook.id]
    }, null, rule);
    const failureChild = await AutoTaskChildNotification.create({
      id: uuidv4(),
      rule_id: rule.id,
      ...failurePayload,
      status: 'inactive',
      created_at: now,
      updated_at: now
    });
    childIds.push(failureChild.id);

    await rule.update({ enabled: false });
    assert.strictEqual(await activateChildNotifications(rule, now), 0, 'disabled parent must not arm children');
    await rule.update({ enabled: true, notify_enabled: false });
    assert.strictEqual(await activateChildNotifications(rule, now), 0, 'parent with notifications disabled must not arm children');
    await rule.update({ notify_enabled: true, action_mode: 'run_only' });
    assert.strictEqual(await activateChildNotifications(rule, now), 0, 'run-only parent must not arm children');
    await rule.update({ action_mode: 'run_and_notify' });

    assert.strictEqual(await activateChildNotifications(rule, now), 3, 'eligible parent activation must arm all enabled children');
    await weeklyChild.reload();
    await monthlyChild.reload();
    await failureChild.reload();
    assert.strictEqual(weeklyChild.status, 'pending');
    assert.strictEqual(monthlyChild.status, 'pending');
    assert.strictEqual(failureChild.status, 'pending');
    assert.ok(weeklyChild.activation_token);
    assert.strictEqual(weeklyChild.activation_token, monthlyChild.activation_token, 'one parent run must share one activation token');

    const waitMs = Math.max(0, target.getTime() - Date.now()) + 1800;
    await sleep(waitMs);
    await processDueChildNotifications(new Date());
    await sleep(500);
    await weeklyChild.reload();
    await failureChild.reload();
    assert.strictEqual(weeklyChild.status, 'sent');
    assert.strictEqual(failureChild.status, 'failed', 'webhook failure must mark the child failed for this activation');
    assert.ok(failureChild.last_error.includes('isolated failure'));
    assert.strictEqual(received.length, 2, 'one due success and one due failure must each attempt once');
    assert.ok(received.some(item => item?.markdown?.text?.includes('isolated child message')));
    assert.ok(received.some(item => item.__test_url === '/fail'));
    await processDueChildNotifications(new Date());
    await sleep(300);
    assert.strictEqual(received.length, 2, 'repeated scheduler ticks must not resend sent or failed children');

    const syntheticMonthly = {
      ...monthlyChild.toJSON(),
      enabled: true,
      status: 'pending',
      activation_token: 'synthetic-monthly-token',
      activation_scheduled_at: new Date('2027-01-01T00:00:00+08:00'),
      activated_at: new Date('2027-01-01T00:00:00+08:00'),
      updated_at: new Date('2026-08-09T00:00:00+08:00')
    };
    const nextMonthly = getNextChildRunAt(syntheticMonthly, rule, new Date('2027-02-01T00:00:00+08:00'));
    assert.strictEqual(getBeijingParts(nextMonthly).date, '2027-03-31', 'February must skip day 31 instead of clamping');

    assert.strictEqual(await deactivateChildNotifications(rule.id), 1, 'only the still-pending monthly child should be deactivated');
    await monthlyChild.reload();
    assert.strictEqual(monthlyChild.status, 'inactive');
    assert.strictEqual(monthlyChild.activation_token, null);
    await rule.update({ enabled: false });
    await rule.update({ enabled: true });
    const fallbackRecovered = await recoverChildNotificationsFromParentEvidence(new Date());
    const fallbackRecoveredAgain = await recoverChildNotificationsFromParentEvidence(new Date());
    await monthlyChild.reload();
    assert.strictEqual(fallbackRecovered, 1, 'countdown fallback must activate one eligible inactive child');
    assert.strictEqual(fallbackRecoveredAgain, 0, 'repeated fallback checks must not reactivate the same child');
    assert.strictEqual(monthlyChild.status, 'pending', 'eligible fallback must move the child into the normal pending lifecycle');
    const reenabledStatus = monthlyChild.status;

    const staleNow = new Date();
    await monthlyChild.update({
      enabled: true,
      activation_token: 'synthetic-stale-token',
      activation_scheduled_at: new Date(staleNow.getTime() - 2 * 60 * 1000),
      activated_at: new Date(staleNow.getTime() - 2 * 60 * 1000),
      status: 'sending',
      updated_at: new Date(staleNow.getTime() - 2 * 60 * 1000)
    }, { silent: true });
    await processDueChildNotifications(staleNow);
    await monthlyChild.reload();
    assert.strictEqual(monthlyChild.status, 'failed', 'stale sending child must not be retried after a process interruption');
    assert.ok(monthlyChild.last_error.includes('本轮不再自动重发'));

    const dutyConfig = normalizeDutyConfig({
      weekly: weeklyMap('LATEST'),
      weekly_mode: 'fixed',
      weekly_rotation: { end_weekday: 5, staff_ids: [], start_date: '2026-08-20' },
      weekly_versions: [
        {
          effective_date: '1900-01-01',
          weekly: weeklyMap('OLD'),
          weekly_mode: 'fixed',
          weekly_rotation: { end_weekday: 5, staff_ids: [], start_date: '2026-08-10' }
        },
        {
          effective_date: '2026-08-12',
          weekly: weeklyMap('IGNORED_IN_ROTATION'),
          weekly_mode: 'rotation',
          weekly_rotation: {
            end_weekday: 5,
            staff_ids: ['G', 'H', 'J', 'K', 'L', 'O', 'P'],
            start_date: '2026-08-12'
          }
        },
        {
          effective_date: '2026-08-20',
          weekly: weeklyMap('NEW_FIXED'),
          weekly_mode: 'fixed',
          weekly_rotation: { end_weekday: 5, staff_ids: [], start_date: '2026-08-20' }
        }
      ]
    });
    const dutyRule = { schedule_type: 'weekly', duty_config: dutyConfig };
    assert.deepStrictEqual(getDutyItemForParts(dutyRule, parts('2026-08-11')).staff_ids, ['OLD']);
    assert.deepStrictEqual(getDutyItemForParts(dutyRule, parts('2026-08-12')).staff_ids, ['G']);
    assert.deepStrictEqual(getDutyItemForParts(dutyRule, parts('2026-08-13')).staff_ids, ['H']);
    assert.deepStrictEqual(getDutyItemForParts(dutyRule, parts('2026-08-14')).staff_ids, ['J']);
    assert.deepStrictEqual(getDutyItemForParts(dutyRule, parts('2026-08-15')).staff_ids, []);
    assert.deepStrictEqual(getDutyItemForParts(dutyRule, parts('2026-08-17')).staff_ids, ['K']);
    assert.deepStrictEqual(getDutyItemForParts(dutyRule, parts('2026-08-20')).staff_ids, ['NEW_FIXED']);
    assert.strictEqual(dutyConfig.weekly_versions[1].weekly_rotation.start_date, '2026-08-12');

    const weekendEffectiveConfig = normalizeDutyConfig({
      weekly: weeklyMap('LATEST_WEEKEND'),
      weekly_mode: 'rotation',
      weekly_rotation: {
        end_weekday: 5,
        staff_ids: ['A', 'B'],
        start_date: '2026-08-15'
      },
      weekly_versions: [
        {
          effective_date: '1900-01-01',
          weekly: weeklyMap('OLD_WEEKEND'),
          weekly_mode: 'fixed',
          weekly_rotation: { end_weekday: 5, staff_ids: [], start_date: '2026-08-10' }
        },
        {
          effective_date: '2026-08-15',
          weekly: weeklyMap('IGNORED_WEEKEND'),
          weekly_mode: 'rotation',
          weekly_rotation: {
            end_weekday: 5,
            staff_ids: ['A', 'B'],
            start_date: '2026-08-15'
          }
        }
      ]
    });
    const weekendRule = { schedule_type: 'weekly', duty_config: weekendEffectiveConfig };
    assert.deepStrictEqual(getDutyItemForParts(weekendRule, parts('2026-08-14')).staff_ids, ['OLD_WEEKEND']);
    assert.deepStrictEqual(getDutyItemForParts(weekendRule, parts('2026-08-15')).staff_ids, []);
    assert.deepStrictEqual(getDutyItemForParts(weekendRule, parts('2026-08-16')).staff_ids, []);
    assert.deepStrictEqual(getDutyItemForParts(weekendRule, parts('2026-08-17')).staff_ids, ['A']);
    assert.deepStrictEqual(getDutyItemForParts(weekendRule, parts('2026-08-18')).staff_ids, ['B']);

    const startOnlyDutyConfig = normalizeDutyConfig({
      weekly: {
        5: {
          ...dutyItem('START_ONLY'),
          end_message: 'local duty end test'
        }
      }
    });
    const startOnlyDutyRule = {
      id: 'start-only-duty-test',
      enabled: true,
      task_type: 'duty_notify',
      schedule_type: 'weekly',
      duty_config: startOnlyDutyConfig,
      updated_at: new Date('2026-08-20T00:00:00+08:00')
    };
    const startOnlyStartEvents = getDueDutyEvents(
      startOnlyDutyRule,
      new Date('2026-08-21T09:15:30+08:00')
    );
    const startOnlyEndEvents = getDueDutyEvents(
      startOnlyDutyRule,
      new Date('2026-08-21T20:00:30+08:00')
    );
    assert.deepStrictEqual(startOnlyStartEvents.map(event => event.kind), ['start']);
    assert.deepStrictEqual(startOnlyEndEvents, [], 'start_only must never generate a due end event');

    const startAndEndDutyRule = {
      ...startOnlyDutyRule,
      id: 'start-and-end-duty-test',
      duty_config: normalizeDutyConfig({
        weekly: {
          5: {
            ...dutyItem('START_AND_END'),
            send_mode: 'start_and_end',
            end_message: 'local duty end test'
          }
        }
      })
    };
    const startAndEndEvents = getDueDutyEvents(
      startAndEndDutyRule,
      new Date('2026-08-21T20:00:30+08:00')
    );
    const startAndEndStartEvents = getDueDutyEvents(
      startAndEndDutyRule,
      new Date('2026-08-21T09:15:30+08:00')
    );
    assert.deepStrictEqual(startAndEndStartEvents.map(event => event.kind), ['start']);
    assert.deepStrictEqual(startAndEndEvents.map(event => event.kind), ['end']);
    assert.throws(() => normalizeRulePayload({
      task_type: 'duty_notify',
      schedule_type: 'weekly',
      duty_config: {
        weekly: {
          5: {
            ...dutyItem('INVALID_BOTH'),
            send_mode: 'start_and_end',
            end_message: ''
          }
        }
      }
    }), /请填写值班结束提醒/);
    assert.throws(() => normalizeRulePayload({
      task_type: 'duty_notify',
      schedule_type: 'weekly',
      duty_config: {
        weekly_mode: 'rotation',
        weekly_rotation: {
          end_weekday: 5,
          staff_ids: ['ROTATION_STAFF'],
          start_date: '2026-08-17'
        },
        weekly: {
          5: {
            ...dutyItem('ROTATION_TEMPLATE'),
            enabled: false,
            send_mode: 'start_and_end',
            end_message: ''
          }
        }
      }
    }), /请填写值班结束提醒/);

    process.stdout.write(JSON.stringify({
      ok: true,
      child_notifications: {
        armed: 3,
        blocked_parent_modes: 3,
        scheduled_parent_requests: 1,
        scheduled_parent_status: scheduledRunLog.status,
        scheduled_pipeline_status: scheduledPipelineStatus,
        scheduled_deactivated_status: scheduledDeactivatedStatus,
        isolated_test_requests: 1,
        webhook_requests: received.length,
        duplicate_requests: 0,
        failed_delivery_status: failureChild.status,
        reenabled_status: reenabledStatus,
        month_31_next_date: getBeijingParts(nextMonthly).date,
        disabled_pending_status: 'inactive',
        stale_sending_status: monthlyChild.status,
        fallback_without_log: fallbackWithoutLog.source,
        fallback_with_success_log: fallbackWithSuccessLog.source,
        fallback_failed_log_blocked: !fallbackWithFailedLog.matched,
        fallback_exact_six_days_blocked: !exactSixDayBoundary.matched,
        success_log_prioritized_outside_window: successRecordOutsideFallbackWindow.matched,
        fallback_recovered: fallbackRecovered,
        fallback_duplicate_recovered: fallbackRecoveredAgain
      },
      duty_switch: {
        before_effective: 'OLD',
        effective_day: 'G',
        next_week_monday: 'K',
        second_switch: 'NEW_FIXED',
        weekend_effective_day: 'unassigned',
        next_workday_after_weekend: 'A'
      },
      duty_send_mode: {
        start_only_start_events: startOnlyStartEvents.map(event => event.kind),
        start_only_end_events: startOnlyEndEvents.map(event => event.kind),
        start_and_end_start_events: startAndEndStartEvents.map(event => event.kind),
        start_and_end_end_events: startAndEndEvents.map(event => event.kind)
      }
    }, null, 2));
  } finally {
    for (const cleanupRuleId of [ruleId, scheduledRuleId]) {
      await AutoTaskChildNotification.destroy({ where: { rule_id: cleanupRuleId } });
      await AutoTaskMessage.destroy({ where: { rule_id: cleanupRuleId } });
      await AutoTaskRunLog.destroy({ where: { rule_id: cleanupRuleId } });
      await AutoTaskRule.destroy({ where: { id: cleanupRuleId } });
    }
    await new Promise(resolve => receiver.close(resolve));
    await sequelize.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
