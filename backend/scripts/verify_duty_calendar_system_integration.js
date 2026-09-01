const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

process.env.ALLOW_LOCAL_WEBHOOK_TEST = '1';

const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const {
  sequelize,
  AutoTaskChildNotification,
  AutoTaskMessage,
  AutoTaskRule,
  AutoTaskRunLog,
  DutyCalendarRevision,
  DutyScheduleException,
  DutyScheduleSwap,
  DutySpecialNotificationLog,
  Staff
} = require('../src/models');
const dutyCalendarService = require('../src/services/DutyCalendarService');
const {
  childNotificationFallbackMatchAsync,
  executeChildNotification,
  executeRule,
  getDueChildScheduledAtAsync,
  getDueRuleScheduledAtAsync,
  getNextChildRunAtAsync,
  getNextRunAtAsync,
  processDueSpecialDutyNotifications
} = require('../src/services/AutoTaskService');

const API_BASE = process.env.DUTY_TEST_API_BASE || 'http://127.0.0.1:3001';
const RUN_PREFIX = 'CODEX-DUTY-SYSTEM-20260822';
const TEST_DIR = path.resolve(__dirname, '../../docs/@test/duty_calendar_20260821');
const STATUS_FILE = path.join(TEST_DIR, 'duty_calendar_status.md');
const RESULTS_FILE = path.join(TEST_DIR, 'duty_calendar_results.jsonl');
const TEST_YEAR = 2026;
const PARENT_SOURCE_DATE = '2026-10-01';
const PARENT_TARGET_DATE = '2026-10-08';
const CHILD_SOURCE_DATE = '2026-10-05';
const CHILD_TARGET_DATE = '2026-10-08';

const state = {
  pass: 10,
  current: 'H-011',
  dutyRuleId: '',
  parentRuleId: '',
  childId: '',
  revisionIds: [],
  cleanupComplete: false
};

function beijingTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date).replaceAll('/', '-');
}

function writeStatus(status, note) {
  const body = `# 节假日跳过与排班例外实时测试状态

更新时间：${beijingTimestamp()} +08:00

状态：${status}

当前用例：${state.current}

进度：${state.pass} / 16

| 结果 | 数量 |
| --- | ---: |
| PASS | ${state.pass} |
| ISSUE | 0 |
| FAIL | 0 |
| BLOCKER | 0 |

## 测试数据

- 规则前缀：\`${RUN_PREFIX}\`
- 自动值班规则：${state.dutyRuleId || '尚未创建'}
- 自动任务规则：${state.parentRuleId || '尚未创建'}
- 子通知：${state.childId || '尚未创建'}
- 新增修订数：${state.revisionIds.length}
- 本机 webhook：仅使用 \`127.0.0.1\`
- 清理状态：${state.cleanupComplete ? '已完成' : '执行中或待执行'}

## 最近进展

${note}

## 继续点

- ${status === 'READY_FOR_FINAL_GATE' ? '执行 H-016 构建、旧回归、浏览器、安全和最终数据守恒检查。' : state.current}
`;
  fs.writeFileSync(STATUS_FILE, body, 'utf8');
}

function appendResult(id, evidence, assertions) {
  fs.appendFileSync(RESULTS_FILE, `${JSON.stringify({
    id,
    status: 'PASS',
    time: `${beijingTimestamp()} +08:00`,
    evidence,
    assertions
  })}\n`, 'utf8');
}

async function runCase(id, handler) {
  state.current = id;
  writeStatus('RUNNING_SYSTEM_INTEGRATION', `正在执行 ${id}。`);
  const result = await handler();
  state.pass += 1;
  appendResult(id, result.evidence, result.assertions);
  writeStatus('RUNNING_SYSTEM_INTEGRATION', `${id} PASS：${result.assertions.join('；')}。`);
  return result.evidence;
}

async function api(method, pathname, body) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

function webhookJson(port) {
  return JSON.stringify([{
    id: `${RUN_PREFIX}-webhook`,
    name: '本机隔离 webhook',
    url: `http://127.0.0.1:${port}/robot/send`
  }]);
}

function recipientsJson() {
  return JSON.stringify({ enabled: false, at_mode: 'people', staff_ids: [], extra: [] });
}

function dutyItem(staffId, label) {
  return {
    enabled: true,
    staff_ids: [staffId],
    start_time: '09:15:00',
    end_time: '20:00:00',
    send_mode: 'start_only',
    start_message: `${RUN_PREFIX} ${label}`,
    end_message: ''
  };
}

function dutyConfig(staffId) {
  const weekly = {};
  for (let day = 1; day <= 5; day += 1) weekly[String(day)] = dutyItem(staffId, `星期${day}`);
  return JSON.stringify({
    weekly,
    monthly: {},
    weekly_mode: 'fixed',
    weekly_rotation: { staff_ids: [staffId], end_weekday: 5, start_date: PARENT_SOURCE_DATE },
    weekly_versions: []
  });
}

async function startReceiver() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        payload = {};
      }
      received.push({ path: req.url, payload });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, received, port: server.address().port };
}

async function closeReceiver(server) {
  if (!server?.listening) return;
  await new Promise(resolve => server.close(resolve));
}

async function baselineSnapshot() {
  const revisions = await DutyCalendarRevision.findAll({
    where: { calendar_year: TEST_YEAR },
    order: [['revision_no', 'ASC']]
  });
  return {
    revisionRows: revisions.map(row => ({ id: row.id, is_active: Boolean(row.is_active) })),
    revisions: revisions.length,
    rules: await AutoTaskRule.count({ where: { name: { [Op.like]: `${RUN_PREFIX}%` } } }),
    children: await AutoTaskChildNotification.count({ where: { message: { [Op.like]: `${RUN_PREFIX}%` } } }),
    exceptions: await DutyScheduleException.count(),
    swaps: await DutyScheduleSwap.count(),
    specialLogs: await DutySpecialNotificationLog.count(),
    runLogs: await AutoTaskRunLog.count(),
    messages: await AutoTaskMessage.count()
  };
}

async function cleanup(baseline) {
  const ruleIds = [state.dutyRuleId, state.parentRuleId].filter(Boolean);
  if (ruleIds.length > 0) {
    await DutySpecialNotificationLog.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
    await DutyScheduleSwap.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
    await DutyScheduleException.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
    await AutoTaskChildNotification.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
    await AutoTaskRunLog.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
    await AutoTaskMessage.destroy({ where: { rule_id: { [Op.in]: ruleIds } } });
    await AutoTaskRule.destroy({ where: { id: { [Op.in]: ruleIds } } });
  }
  if (state.revisionIds.length > 0) {
    await DutyCalendarRevision.destroy({ where: { id: { [Op.in]: state.revisionIds } } });
  }
  for (const row of baseline.revisionRows) {
    await DutyCalendarRevision.update({ is_active: row.is_active }, { where: { id: row.id } });
  }
  dutyCalendarService.invalidateResolverCache();

  const after = await baselineSnapshot();
  assert.strictEqual(after.revisions, baseline.revisions, '年度修订必须恢复基线');
  assert.strictEqual(after.rules, baseline.rules, '临时规则必须清零');
  assert.strictEqual(after.children, baseline.children, '临时子通知必须清零');
  assert.strictEqual(after.exceptions, baseline.exceptions, '日期例外必须恢复基线');
  assert.strictEqual(after.swaps, baseline.swaps, '换班必须恢复基线');
  assert.strictEqual(after.specialLogs, baseline.specialLogs, '特殊日志必须恢复基线');
  assert.strictEqual(after.runLogs, baseline.runLogs, '执行日志必须恢复基线');
  assert.strictEqual(after.messages, baseline.messages, '消息记录必须恢复基线');
  state.cleanupComplete = true;
  return after;
}

async function main() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  writeStatus('RUNNING_SYSTEM_INTEGRATION', '已在创建测试数据前写入状态。');
  await dutyCalendarService.ensureDutyCalendarTables();
  const baseline = await baselineSnapshot();
  const receiver = await startReceiver();

  try {
    const staff = await Staff.findOne({
      where: { employment_status: { [Op.ne]: 'resigned' } },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
    });
    assert.ok(staff, '至少需要一名非离职研发人员');
    const now = new Date();

    const dutyRule = await AutoTaskRule.create({
      id: uuidv4(),
      name: `${RUN_PREFIX}-自动值班`,
      enabled: true,
      task_type: 'duty_notify',
      action_mode: 'notify_only',
      schedule_type: 'weekly',
      schedule_year: null,
      month_days: [],
      week_days: [1, 2, 3, 4, 5],
      execute_time: '09:00:00',
      notify_enabled: true,
      dingtalk_webhook: webhookJson(receiver.port),
      dingtalk_message: `${RUN_PREFIX} duty`,
      dingtalk_recipients: recipientsJson(),
      duty_config: dutyConfig(staff.id),
      created_at: now,
      updated_at: now
    });
    state.dutyRuleId = dutyRule.id;

    const parentRule = await AutoTaskRule.create({
      id: uuidv4(),
      name: `${RUN_PREFIX}-自动任务`,
      enabled: true,
      task_type: 'task_create_notify',
      action_mode: 'run_and_notify',
      schedule_type: 'monthly',
      schedule_year: TEST_YEAR,
      month_days: [1],
      week_days: [],
      execute_time: '09:00:00',
      notify_enabled: true,
      dingtalk_webhook: webhookJson(receiver.port),
      dingtalk_message: `${RUN_PREFIX} 主通知`,
      dingtalk_recipients: recipientsJson(),
      duty_config: null,
      created_at: now,
      updated_at: now
    });
    state.parentRuleId = parentRule.id;

    const child = await AutoTaskChildNotification.create({
      id: uuidv4(),
      rule_id: parentRule.id,
      enabled: true,
      schedule_type: 'monthly',
      month_days: [5],
      week_days: [],
      execute_time: '10:00:00',
      message: `${RUN_PREFIX} 子通知`,
      webhook_target_mode: 'all',
      webhook_ids: '[]',
      activation_token: null,
      status: 'inactive',
      created_at: now,
      updated_at: now
    });
    state.childId = child.id;

    const initialCalendar = await api('GET', `/api/settings/duty-calendar?year=${TEST_YEAR}&rule_id=${dutyRule.id}`);
    assert.strictEqual(initialCalendar.status, 200);
    const manualSave = await api('PUT', `/api/settings/duty-calendar/${TEST_YEAR}`, {
      rule_id: dutyRule.id,
      revision_no: initialCalendar.payload.data.revision_no,
      effective_from: PARENT_SOURCE_DATE,
      manual_overrides: {
        [PARENT_SOURCE_DATE]: 'manual_skip',
        [CHILD_SOURCE_DATE]: 'manual_skip'
      },
      exceptions: [{
        calendar_date: PARENT_SOURCE_DATE,
        skip_staff_ids: [],
        notice_enabled: true,
        notice_time: '12:00:00',
        notice_message: `${RUN_PREFIX} 特殊日期通知`,
        notice_at_mode: 'none',
        notice_staff_ids: [],
        status: 'active'
      }],
      swaps: []
    });
    assert.strictEqual(manualSave.status, 200, JSON.stringify(manualSave.payload));
    state.revisionIds.push(manualSave.payload.data.revision.id);
    dutyCalendarService.invalidateResolverCache();

    await runCase('H-011', async () => {
      const manualDay = await dutyCalendarService.getGlobalCalendarDay(PARENT_SOURCE_DATE);
      const weekendDay = await dutyCalendarService.getGlobalCalendarDay('2026-10-03');
      const officialSnapshot = dutyCalendarService.loadOfficialHolidaySnapshot(2026);
      const officialDay = dutyCalendarService.deriveCalendarDay('2026-01-01', {
        official_days: officialSnapshot.days,
        manual_overrides: {}
      });
      const nextWorkDate = await dutyCalendarService.getNextGlobalWorkDate(PARENT_SOURCE_DATE);
      assert.strictEqual(manualDay.effective_skipped, true);
      assert.strictEqual(manualDay.override_mode, 'manual_skip');
      assert.strictEqual(weekendDay.effective_skipped, true);
      assert.strictEqual(weekendDay.is_weekend, true);
      assert.strictEqual(officialDay.is_official_holiday, true);
      assert.strictEqual(officialDay.effective_skipped, true);
      assert.strictEqual(nextWorkDate, PARENT_TARGET_DATE);
      return {
        evidence: {
          manual_skip: manualDay.effective_skipped,
          weekend_skip: weekendDay.effective_skipped,
          official_holiday_skip: officialDay.effective_skipped,
          next_work_date: nextWorkDate
        },
        assertions: ['手动停排生效', '周末默认停排生效', '法定节假日识别生效', '连续停排后定位首个工作日']
      };
    });

    await runCase('H-012', async () => {
      const skippedDuty = await dutyCalendarService.resolveDutyDate(dutyRule, PARENT_SOURCE_DATE);
      const carriedDuty = await dutyCalendarService.resolveDutyDate(dutyRule, PARENT_TARGET_DATE);
      assert.strictEqual(skippedDuty.whole_day_skipped, true);
      assert.strictEqual(skippedDuty.events.length, 0);
      assert.strictEqual(carriedDuty.source_date, PARENT_SOURCE_DATE);
      assert.deepStrictEqual(carriedDuty.final_staff_ids, [String(staff.id)]);

      const noticeNow = new Date(`${PARENT_SOURCE_DATE}T12:00:30+08:00`);
      await processDueSpecialDutyNotifications(noticeNow, { ruleIds: [dutyRule.id] });
      await processDueSpecialDutyNotifications(noticeNow, { ruleIds: [dutyRule.id] });
      const noticeLogs = await DutySpecialNotificationLog.findAll({ where: { rule_id: dutyRule.id } });
      assert.strictEqual(noticeLogs.length, 1);
      assert.strictEqual(noticeLogs[0].status, 'success');
      assert.strictEqual(receiver.received.length, 1);
      return {
        evidence: {
          skipped_duty_events: skippedDuty.events.length,
          carried_source_date: carriedDuty.source_date,
          special_notice_requests: receiver.received.length,
          special_notice_logs: noticeLogs.length
        },
        assertions: ['停排日不发送正常值班通知', '值班单元顺延到下一有效日', '特殊日期通知在停排日独立发送一次']
      };
    });

    await runCase('H-013', async () => {
      const referenceNow = new Date('2026-09-30T09:00:00+08:00');
      const nextRun = await getNextRunAtAsync(parentRule, referenceNow);
      assert.strictEqual(nextRun.toISOString(), new Date(`${PARENT_TARGET_DATE}T09:00:00+08:00`).toISOString());
      assert.strictEqual(await getDueRuleScheduledAtAsync(parentRule, new Date(`${PARENT_SOURCE_DATE}T09:00:30+08:00`)), null);
      const due = await getDueRuleScheduledAtAsync(parentRule, new Date(`${PARENT_TARGET_DATE}T09:00:30+08:00`));
      assert.strictEqual(due.toISOString(), new Date(`${PARENT_TARGET_DATE}T09:00:00+08:00`).toISOString());

      const fakeTaskId = uuidv4();
      const log = await executeRule(parentRule, due, {
        createTask: async () => ({
          created: true,
          task: { id: fakeTaskId },
          message: `${RUN_PREFIX} 已模拟创建下一周任务`
        })
      });
      assert.strictEqual(log.status, 'success');
      assert.strictEqual(log.notify_status, 'success');
      assert.strictEqual(log.created_task_id, fakeTaskId);
      assert.strictEqual(receiver.received.length, 2);
      const activatedChild = await AutoTaskChildNotification.findByPk(child.id);
      assert.strictEqual(activatedChild.status, 'pending');
      assert.ok(activatedChild.activation_token);
      return {
        evidence: {
          source_date: PARENT_SOURCE_DATE,
          deferred_run_at: nextRun.toISOString(),
          source_due: false,
          target_due: due.toISOString(),
          run_status: log.status,
          notify_status: log.notify_status,
          child_status: activatedChild.status
        },
        assertions: ['自动任务在停排日不执行', '自动任务顺延后只执行一次', '任务创建与主通知链路成功', '主通知成功后激活子通知']
      };
    });

    await runCase('H-014', async () => {
      const activatedChild = await AutoTaskChildNotification.findByPk(child.id);
      const parent = await AutoTaskRule.findByPk(parentRule.id);
      const nextChild = await getNextChildRunAtAsync(
        activatedChild,
        parent,
        new Date(`${PARENT_TARGET_DATE}T09:05:00+08:00`)
      );
      assert.strictEqual(nextChild.toISOString(), new Date(`${CHILD_TARGET_DATE}T10:00:00+08:00`).toISOString());
      assert.strictEqual(await getDueChildScheduledAtAsync(
        activatedChild,
        parent,
        new Date(`${CHILD_SOURCE_DATE}T10:00:30+08:00`)
      ), null);
      const dueChild = await getDueChildScheduledAtAsync(
        activatedChild,
        parent,
        new Date(`${CHILD_TARGET_DATE}T10:00:30+08:00`)
      );
      assert.strictEqual(dueChild.toISOString(), new Date(`${CHILD_TARGET_DATE}T10:00:00+08:00`).toISOString());
      const sentStatus = await executeChildNotification(activatedChild, parent, dueChild);
      assert.strictEqual(sentStatus, 'sent');
      assert.strictEqual(receiver.received.length, 3);

      const weeklyFallbackRule = {
        ...parent.toJSON(),
        schedule_type: 'weekly',
        schedule_year: null,
        month_days: [],
        week_days: [1]
      };
      const fallback = await childNotificationFallbackMatchAsync(weeklyFallbackRule, {
        scheduled_at: new Date(`${PARENT_TARGET_DATE}T09:00:00+08:00`),
        status: 'success',
        notify_status: 'success'
      }, new Date(`${PARENT_TARGET_DATE}T10:00:00+08:00`));
      assert.strictEqual(fallback.matched, true);
      assert.strictEqual(fallback.source, 'run_log');
      return {
        evidence: {
          child_source_date: CHILD_SOURCE_DATE,
          child_deferred_run_at: nextChild.toISOString(),
          child_send_status: sentStatus,
          fallback_source: fallback.source,
          webhook_requests: receiver.received.length
        },
        assertions: ['子通知在停排日不发送', '子通知倒计时显示顺延后时间', '子通知在下一有效日发送一次', '前置条件使用日历感知的主任务周期']
      };
    });

    await runCase('H-015', async () => {
      const forceSave = await api('PUT', `/api/settings/duty-calendar/${TEST_YEAR}`, {
        rule_id: dutyRule.id,
        revision_no: manualSave.payload.data.revision_no,
        effective_from: PARENT_SOURCE_DATE,
        manual_overrides: {
          [PARENT_SOURCE_DATE]: 'force_work',
          [CHILD_SOURCE_DATE]: 'manual_skip'
        },
        exceptions: manualSave.payload.data.exceptions,
        swaps: []
      });
      assert.strictEqual(forceSave.status, 200);
      state.revisionIds.push(forceSave.payload.data.revision.id);
      dutyCalendarService.invalidateResolverCache();

      const forceDay = await dutyCalendarService.getGlobalCalendarDay(PARENT_SOURCE_DATE);
      assert.strictEqual(forceDay.effective_skipped, false);
      assert.strictEqual(forceDay.override_mode, 'force_work');
      const nextRun = await getNextRunAtAsync(parentRule, new Date('2026-09-30T09:00:00+08:00'));
      assert.strictEqual(nextRun.toISOString(), new Date(`${PARENT_SOURCE_DATE}T09:00:00+08:00`).toISOString());

      const settings = await api('GET', '/api/settings/auto-tasks');
      assert.strictEqual(settings.status, 200);
      const serializedParent = settings.payload.data.rules.find(rule => rule.id === parentRule.id);
      assert.ok(serializedParent);
      const serializedNextRun = await getNextRunAtAsync(parentRule, new Date());
      assert.strictEqual(serializedParent.next_run_at, serializedNextRun.toISOString());
      const serializedChild = serializedParent.child_notifications.find(item => item.id === child.id);
      assert.ok(serializedChild);
      assert.strictEqual(serializedChild.status, 'sent');
      return {
        evidence: {
          force_work_active: !forceDay.effective_skipped,
          service_next_run_at: nextRun.toISOString(),
          api_next_run_at: serializedParent.next_run_at,
          child_api_status: serializedChild.status,
          restart_required: false
        },
        assertions: ['取消默认停排后原计划日期立即恢复', '服务层与设置API下一次执行时间一致', '保存后无需重启即可刷新主/子状态']
      };
    });

    const after = await cleanup(baseline);
    state.current = 'H-016';
    writeStatus('READY_FOR_FINAL_GATE', `H-011 至 H-015 全部通过；测试数据已清理，2026 修订 ${after.revisions}、临时规则 ${after.rules}、临时子通知 ${after.children}。`);
    process.stdout.write(JSON.stringify({
      ok: true,
      passed: state.pass,
      next_case: 'H-016',
      receiver_requests: receiver.received.length,
      cleanup: after
    }, null, 2));
  } finally {
    try {
      if (!state.cleanupComplete) await cleanup(baseline);
    } finally {
      await closeReceiver(receiver.server);
      await sequelize.close();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
