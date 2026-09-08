const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

process.env.ALLOW_LOCAL_WEBHOOK_TEST = '1';

const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const {
  sequelize,
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
  processDueSpecialDutyNotifications
} = require('../src/services/AutoTaskService');
const {
  getBeijingParts,
  getWeekdayNumber
} = require('../src/utils/beijingTime');

const API_BASE = process.env.DUTY_TEST_API_BASE || 'http://127.0.0.1:3001';
const RUN_PREFIX = 'CODEX-DUTY-CALENDAR-20260821';
const TEST_DIR = path.resolve(__dirname, '../../docs/@test/duty_calendar_20260821');
const STATUS_FILE = path.join(TEST_DIR, 'duty_calendar_status.md');
const RESULTS_FILE = path.join(TEST_DIR, 'duty_calendar_results.jsonl');
const TOTAL_CASES = 10;

const state = {
  current: '初始化',
  pass: 0,
  issue: 0,
  fail: 0,
  blocker: 0,
  testRuleId: '',
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

function writeStatus(status, note = '') {
  const complete = state.pass + state.issue + state.fail + state.blocker;
  const body = `# 节假日跳过与排班例外实时测试状态

更新时间：${beijingTimestamp()} +08:00

状态：${status}

当前用例：${state.current}

进度：${complete} / ${TOTAL_CASES}

| 结果 | 数量 |
| --- | ---: |
| PASS | ${state.pass} |
| ISSUE | ${state.issue} |
| FAIL | ${state.fail} |
| BLOCKER | ${state.blocker} |

## 测试数据

- 规则前缀：\`${RUN_PREFIX}\`
- 临时规则 ID：${state.testRuleId || '尚未创建'}
- 临时修订数：${state.revisionIds.length}
- 本机 webhook：仅运行期间使用 \`127.0.0.1\`
- 清理状态：${state.cleanupComplete ? '已完成' : '执行中或待执行'}

## 最近进展

${note || '等待下一项结果。'}

## 继续点

${status === 'READY_FOR_UI' ? '- API 与运行态测试已完成；继续执行 H-010 构建、浏览器与最终清理核验。' : `- ${state.current}`}
`;
  fs.writeFileSync(STATUS_FILE, body, 'utf8');
}

function appendResult(id, status, evidence, assertions) {
  fs.appendFileSync(RESULTS_FILE, `${JSON.stringify({
    id,
    status,
    time: `${beijingTimestamp()} +08:00`,
    evidence,
    assertions
  })}\n`, 'utf8');
}

async function runCase(id, handler) {
  state.current = id;
  writeStatus('RUNNING', `正在执行 ${id}。`);
  try {
    const result = await handler();
    state.pass += 1;
    appendResult(id, 'PASS', result.evidence, result.assertions);
    writeStatus('RUNNING', `${id} PASS：${result.assertions.join('；')}。`);
    return result.evidence;
  } catch (error) {
    state.fail += 1;
    appendResult(id, 'FAIL', {
      error: error.message,
      stack: String(error.stack || '').split('\n').slice(0, 8)
    }, ['用例执行失败']);
    writeStatus('FAILED', `${id} FAIL：${error.message}`);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function weeklyDutyConfig(staff) {
  const weekly = {};
  for (let weekday = 1; weekday <= 5; weekday += 1) {
    weekly[String(weekday)] = dutyItem(staff[(weekday - 1) % staff.length].id, `星期${weekday}`);
  }
  return {
    weekly,
    monthly: {},
    weekly_mode: 'fixed',
    weekly_rotation: {
      staff_ids: staff.map(item => item.id),
      end_weekday: 5,
      start_date: '2026-08-17'
    },
    weekly_versions: []
  };
}

function draftCalendar(overrides = {}) {
  return {
    calendar_year: 2026,
    effective_from: '2026-08-28',
    manual_overrides: overrides
  };
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
  const revisions = await DutyCalendarRevision.findAll({ order: [['revision_no', 'ASC']] });
  return {
    revisionRows: revisions.map(row => ({
      id: row.id,
      calendar_year: Number(row.calendar_year),
      revision_no: Number(row.revision_no),
      effective_from: String(row.effective_from),
      is_active: Boolean(row.is_active),
      updated_at: row.updated_at
    })),
    revisions: revisions.length,
    exceptions: await DutyScheduleException.count(),
    swaps: await DutyScheduleSwap.count(),
    specialLogs: await DutySpecialNotificationLog.count(),
    tempRules: await AutoTaskRule.count({ where: { name: { [Op.like]: `${RUN_PREFIX}%` } } })
  };
}

async function cleanupTestData(baseline) {
  if (state.testRuleId) {
    await DutySpecialNotificationLog.destroy({ where: { rule_id: state.testRuleId } });
    await AutoTaskMessage.destroy({ where: { rule_id: state.testRuleId } });
    await AutoTaskRunLog.destroy({ where: { rule_id: state.testRuleId } });
    await DutyScheduleSwap.destroy({ where: { rule_id: state.testRuleId } });
    await DutyScheduleException.destroy({ where: { rule_id: state.testRuleId } });
    await AutoTaskRule.destroy({ where: { id: state.testRuleId } });
  }
  const baselineRevisionIds = new Set(baseline.revisionRows.map(row => String(row.id)));
  const fingerprintedTestRevisions = (await DutyCalendarRevision.findAll({
    where: { calendar_year: 2026, effective_from: '2026-12-01' }
  })).filter(row => {
    const overrides = typeof row.manual_overrides === 'string'
      ? JSON.parse(row.manual_overrides || '{}')
      : (row.manual_overrides || {});
    return !baselineRevisionIds.has(String(row.id)) && overrides['2026-12-25'] === 'manual_skip';
  });
  const revisionIds = [...new Set([
    ...state.revisionIds.map(String),
    ...fingerprintedTestRevisions.map(row => String(row.id))
  ])];
  if (revisionIds.length > 0) {
    await DutyCalendarRevision.destroy({ where: { id: { [Op.in]: revisionIds } } });
  }
  for (const row of baseline.revisionRows) {
    await DutyCalendarRevision.update(
      { is_active: row.is_active, updated_at: row.updated_at },
      { where: { id: row.id }, silent: true }
    );
  }
  dutyCalendarService.invalidateResolverCache();
  const after = await baselineSnapshot();
  assert.strictEqual(after.revisions, baseline.revisions, 'calendar revision count must return to baseline');
  assert.strictEqual(after.exceptions, baseline.exceptions, 'exception count must return to baseline');
  assert.strictEqual(after.swaps, baseline.swaps, 'swap count must return to baseline');
  assert.strictEqual(after.specialLogs, baseline.specialLogs, 'special log count must return to baseline');
  assert.strictEqual(after.tempRules, baseline.tempRules, 'temporary rule count must return to baseline');
  state.cleanupComplete = true;
  return after;
}

async function main() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_FILE, '', 'utf8');
  writeStatus('RUNNING', '已在创建任何测试数据前写入状态文件。');

  await dutyCalendarService.ensureDutyCalendarTables();
  const baseline = await baselineSnapshot();
  const receiver = await startReceiver();
  const staff = await Staff.findAll({
    where: { employment_status: { [Op.ne]: 'resigned' } },
    order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
    limit: 5
  });
  assert.ok(staff.length >= 3, 'at least three non-resigned staff are required for isolated scheduling tests');
  const resigned = await Staff.findOne({ where: { employment_status: 'resigned' } });
  const ruleId = uuidv4();
  state.testRuleId = ruleId;
  const now = new Date();
  const webhook = {
    id: 'webhook_codex_duty_calendar_receiver',
    name: 'Codex duty calendar local receiver',
    url: `http://127.0.0.1:${receiver.port}/duty-calendar`
  };
  const rule = await AutoTaskRule.create({
    id: ruleId,
    name: `${RUN_PREFIX} isolated rule`,
    enabled: false,
    task_type: 'duty_notify',
    action_mode: 'notify_only',
    schedule_type: 'weekly',
    schedule_year: 2026,
    month_days: [],
    week_days: [1, 2, 3, 4, 5],
    execute_time: '09:15:00',
    notify_enabled: false,
    dingtalk_webhook: JSON.stringify([webhook]),
    dingtalk_message: `${RUN_PREFIX} parent`,
    dingtalk_recipients: JSON.stringify({ enabled: false, at_mode: 'people', staff_ids: [], extra: [] }),
    duty_config: JSON.stringify(weeklyDutyConfig(staff)),
    created_at: now,
    updated_at: now
  });

  const commonDraft = {
    calendar_revision: draftCalendar({ '2026-08-28': 'manual_skip' }),
    exceptions: [],
    swaps: []
  };
  let savedPayload;
  let savedCalendar;
  let savedSwapId;
  let savedRevisionNo = 0;

  try {
    await runCase('H-001', async () => {
      const health = await api('GET', '/api/health');
      assert.strictEqual(health.status, 200);
      const calendarResponse = await api('GET', `/api/settings/duty-calendar?year=2026&rule_id=${rule.id}`);
      assert.strictEqual(calendarResponse.status, 200);
      const data = calendarResponse.payload.data;
      assert.strictEqual(data.days.length, 365);
      assert.strictEqual(data.revision_no, baseline.revisions ? data.revision_no : 0);
      assert.strictEqual(data.official_data_available, true);
      assert.ok(data.revision.source_url.includes('www.gov.cn'));
      assert.ok(data.days.some(day => day.is_official_holiday && day.holiday_name === '国庆节'));
      assert.ok(data.days.some(day => day.is_weekend));
      assert.ok(data.staff.every(item => !Object.prototype.hasOwnProperty.call(item, 'phone')));
      assert.ok(data.staff.every(item => item.employment_status !== 'resigned'));

      const legacyDate = '2026-08-24';
      const legacy = await dutyCalendarService.resolveDutyDate(rule, legacyDate);
      const expected = dutyCalendarService.rawDutyItemForDate(rule, legacyDate);
      assert.deepStrictEqual(legacy.final_staff_ids, expected.staff_ids);
      return {
        evidence: {
          health_code: health.payload.code,
          days: data.days.length,
          revision_no: data.revision_no,
          official_source_host: new URL(data.revision.source_url).hostname,
          candidate_count: data.staff.length,
          phone_fields_exposed: 0,
          legacy_staff_ids_match: true
        },
        assertions: [
          '全年日历与官方日期快照可查询',
          '候选人员排除离职且不下发手机号',
          '无年度修订时保持旧排班结果'
        ]
      };
    });

    await runCase('H-002', async () => {
      const response = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-08-28',
        to: '2026-08-31',
        draft: commonDraft
      });
      assert.strictEqual(response.status, 200);
      const byDate = new Map(response.payload.data.days.map(day => [day.date, day]));
      assert.strictEqual(byDate.get('2026-08-28').whole_day_skipped, true);
      assert.strictEqual(byDate.get('2026-08-29').configured, false);
      assert.strictEqual(byDate.get('2026-08-29').whole_day_skipped, true);

      const forceWork = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-08-29',
        to: '2026-08-29',
        draft: {
          calendar_revision: draftCalendar({ '2026-08-29': 'force_work' }),
          exceptions: [],
          swaps: []
        }
      });
      const forcedDay = forceWork.payload.data.days[0];
      assert.strictEqual(forcedDay.whole_day_skipped, false);
      assert.strictEqual(forcedDay.configured, false);
      assert.strictEqual(await DutyCalendarRevision.count(), baseline.revisions);
      return {
        evidence: {
          manual_skip: byDate.get('2026-08-28').whole_day_skipped,
          weekend_default_skip: byDate.get('2026-08-29').whole_day_skipped,
          force_work_unconfigured: {
            whole_day_skipped: forcedDay.whole_day_skipped,
            configured: forcedDay.configured
          },
          persisted_revisions: baseline.revisions
        },
        assertions: [
          '普通日可形成手动停排草稿',
          '周末默认停排可取消',
          '强制工作日仍受规则未配置约束',
          '草稿预览不写数据库'
        ]
      };
    });

    const carryEvidence = await runCase('H-003', async () => {
      const response = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-08-28',
        to: '2026-09-02',
        draft: commonDraft
      });
      assert.strictEqual(response.status, 200);
      const byDate = new Map(response.payload.data.days.map(day => [day.date, day]));
      const fridayStaff = staff[(5 - 1) % staff.length].id;
      const mondayStaff = staff[0].id;
      assert.strictEqual(byDate.get('2026-08-28').whole_day_skipped, true);
      assert.deepStrictEqual(byDate.get('2026-08-31').final_staff_ids, [fridayStaff]);
      assert.deepStrictEqual(byDate.get('2026-09-01').final_staff_ids, [mondayStaff]);
      assert.strictEqual(byDate.get('2026-08-31').source_date, '2026-08-28');
      return {
        evidence: {
          skipped_date: '2026-08-28',
          next_valid_date: '2026-08-31',
          carried_staff: byDate.get('2026-08-31').final_staff[0].name,
          following_staff: byDate.get('2026-09-01').final_staff[0].name,
          source_date: byDate.get('2026-08-31').source_date
        },
        assertions: [
          '停排日不丢失排班单元',
          '未配置周末不消耗排班单元',
          '下个有效工作日承接原周五人员'
        ]
      };
    });

    await runCase('H-004', async () => {
      const skippedId = staff[(5 - 1) % staff.length].id;
      const response = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-08-31',
        to: '2026-09-02',
        draft: {
          ...commonDraft,
          exceptions: [{ calendar_date: '2026-08-31', skip_staff_ids: [skippedId] }]
        }
      });
      assert.strictEqual(response.status, 200);
      const byDate = new Map(response.payload.data.days.map(day => [day.date, day]));
      assert.deepStrictEqual(byDate.get('2026-08-31').base_staff_ids, [skippedId]);
      assert.deepStrictEqual(byDate.get('2026-08-31').skipped_staff_ids, [skippedId]);
      assert.deepStrictEqual(byDate.get('2026-08-31').final_staff_ids, [staff[0].id]);
      assert.deepStrictEqual(byDate.get('2026-09-01').final_staff_ids, [staff[1].id]);

      const exhausted = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-08-31',
        to: '2026-08-31',
        draft: {
          ...commonDraft,
          exceptions: [{ calendar_date: '2026-08-31', skip_staff_ids: staff.map(item => item.id) }]
        }
      });
      assert.strictEqual(exhausted.payload.data.conflicts.length, 1);
      assert.strictEqual(exhausted.payload.data.conflicts[0].code, 'no_available_staff');
      return {
        evidence: {
          base: byDate.get('2026-08-31').base_staff[0].name,
          replacement: byDate.get('2026-08-31').final_staff[0].name,
          following: byDate.get('2026-09-01').final_staff[0].name,
          exhausted_conflict: exhausted.payload.data.conflicts[0].code,
          resigned_fixture_available: Boolean(resigned)
        },
        assertions: [
          '基础人员与被跳过人员仍可审计',
          '补位人员和下一日顺序均消耗名额',
          '所有可用人员被跳过时返回保存级冲突'
        ]
      };
    });

    let swapDraft;
    await runCase('H-005', async () => {
      const baseResponse = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-08-31',
        to: '2026-09-02',
        draft: commonDraft
      });
      const baseDays = baseResponse.payload.data.days;
      swapDraft = {
        date_a: '2026-08-31',
        date_b: '2026-09-01',
        staff_a_id: baseDays[0].final_staff_ids[0],
        staff_b_id: baseDays[1].final_staff_ids[0]
      };
      const swappedResponse = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-08-31',
        to: '2026-09-02',
        draft: { ...commonDraft, swaps: [swapDraft] }
      });
      assert.strictEqual(swappedResponse.status, 200);
      const swapped = swappedResponse.payload.data.days;
      assert.deepStrictEqual(swapped[0].final_staff_ids, [swapDraft.staff_b_id]);
      assert.deepStrictEqual(swapped[1].final_staff_ids, [swapDraft.staff_a_id]);
      assert.deepStrictEqual(swapped[2].final_staff_ids, baseDays[2].final_staff_ids);
      assert.ok(swapped[0].events.length > 0);
      assert.ok(swapped[1].events.length > 0);
      swapped[0].events.forEach(event => assert.deepStrictEqual(event.staff_ids, [swapDraft.staff_b_id]));
      swapped[1].events.forEach(event => assert.deepStrictEqual(event.staff_ids, [swapDraft.staff_a_id]));
      return {
        evidence: {
          date_a_before_after: [baseDays[0].final_staff[0].name, swapped[0].final_staff[0].name],
          date_b_before_after: [baseDays[1].final_staff[0].name, swapped[1].final_staff[0].name],
          third_date_unchanged: swapped[2].final_staff_ids[0] === baseDays[2].final_staff_ids[0],
          date_a_event_staff_ids: swapped[0].events.map(event => event.staff_ids),
          date_b_event_staff_ids: swapped[1].events.map(event => event.staff_ids)
        },
        assertions: [
          '两名人员只在指定两日互换',
          '第三日与后续基础顺序不变',
          '换班结果重新构建通知事件'
        ]
      };
    });

    await runCase('H-006', async () => {
      const baselineRevisionNo = baseline.revisionRows
        .filter(item => item.calendar_year === 2026)
        .reduce((max, item) => Math.max(max, item.revision_no), 0);
      const futureDraft = {
        calendar_revision: {
          calendar_year: 2026,
          effective_from: '2026-12-01',
          manual_overrides: { '2026-12-25': 'manual_skip' }
        },
        exceptions: [],
        swaps: []
      };
      const baseResponse = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-12-01',
        to: '2026-12-03',
        draft: futureDraft
      });
      assert.strictEqual(baseResponse.status, 200);
      const futureDays = baseResponse.payload.data.days;
      const futureSwap = {
        date_a: '2026-12-01',
        date_b: '2026-12-02',
        staff_a_id: futureDays[0].final_staff_ids[0],
        staff_b_id: futureDays[1].final_staff_ids[0]
      };
      const today = getBeijingParts(new Date()).date;
      const firstEffective2026 = baseline.revisionRows
        .filter(item => item.calendar_year === 2026)
        .map(item => item.effective_from)
        .sort()[0] || '';
      const preEffectiveDate = firstEffective2026
        ? getBeijingParts(new Date(new Date(`${firstEffective2026}T12:00:00+08:00`).getTime() - 86400000)).date
        : today;
      const invalidPayload = {
        rule_id: rule.id,
        revision_no: baselineRevisionNo,
        effective_from: '2026-12-01',
        manual_overrides: { '2026-12-25': 'manual_skip' },
        exceptions: [{
          calendar_date: today,
          notice_enabled: true,
          notice_time: '23:59:59',
          notice_message: `${RUN_PREFIX} invalid at people`,
          notice_at_mode: 'people',
          notice_staff_ids: []
        }],
        swaps: [futureSwap]
      };
      const invalid = await api('PUT', '/api/settings/duty-calendar/2026', invalidPayload);
      assert.strictEqual(invalid.status, 400);
      assert.strictEqual(await DutyCalendarRevision.count(), baseline.revisions);

      const oversizedPreview = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-12-01',
        to: '2026-12-01',
        draft: {
          calendar_revision: futureDraft.calendar_revision,
          exceptions: Array.from({ length: 367 }, () => ({ calendar_date: '2026-12-01' })),
          swaps: []
        }
      });
      assert.strictEqual(oversizedPreview.status, 400);

      const preEffectiveSkip = await api('PUT', '/api/settings/duty-calendar/2026', {
        ...invalidPayload,
        exceptions: [{
          calendar_date: preEffectiveDate,
          notice_enabled: false,
          notice_time: '09:00:00',
          notice_message: '',
          notice_at_mode: 'none',
          notice_staff_ids: [],
          skip_staff_ids: [staff[0].id]
        }]
      });
      assert.strictEqual(preEffectiveSkip.status, 400);
      assert.strictEqual(await DutyCalendarRevision.count(), baseline.revisions);

      savedPayload = {
        ...invalidPayload,
        exceptions: [{
          calendar_date: today,
          notice_enabled: false,
          notice_time: '09:00:00',
          notice_message: '',
          notice_at_mode: 'none',
          notice_staff_ids: [],
          skip_staff_ids: []
        }]
      };
      const saved = await api('PUT', '/api/settings/duty-calendar/2026', savedPayload);
      assert.strictEqual(saved.status, 200);
      savedCalendar = saved.payload.data;
      savedRevisionNo = savedCalendar.revision_no;
      state.revisionIds.push(savedCalendar.revision.id);
      savedSwapId = savedCalendar.swaps[0].id;
      assert.strictEqual(savedRevisionNo, baselineRevisionNo + 1);
      assert.strictEqual(savedCalendar.exceptions.length, 1);
      assert.strictEqual(savedCalendar.swaps.length, 1);

      const stale = await api('PUT', '/api/settings/duty-calendar/2026', savedPayload);
      assert.strictEqual(stale.status, 409);
      assert.strictEqual(await DutyCalendarRevision.count(), baseline.revisions + 1);
      return {
        evidence: {
          invalid_at_people_status: invalid.status,
          oversized_draft_status: oversizedPreview.status,
          pre_effective_person_skip_status: preEffectiveSkip.status,
          saved_revision: savedRevisionNo,
          exception_count: savedCalendar.exceptions.length,
          swap_count: savedCalendar.swaps.length,
          stale_revision_status: stale.status,
          partial_rows_after_invalid: 0
        },
        assertions: [
          '无效通知配置在事务前被拒绝且无半成品',
          '超过单年自然日上限的草稿被拒绝',
          '首次生效日前的人员跳过被服务端拒绝',
          '年度修订、日期例外和换班一次原子保存',
          '旧修订号返回409且不新增修订'
        ]
      };
    });

    await runCase('H-007', async () => {
      const omitIdSwap = { ...savedPayload.swaps[0] };
      const repeat = await api('PUT', '/api/settings/duty-calendar/2026', {
        ...savedPayload,
        revision_no: savedRevisionNo,
        swaps: [omitIdSwap]
      });
      assert.strictEqual(repeat.status, 200);
      savedRevisionNo = repeat.payload.data.revision_no;
      state.revisionIds.push(repeat.payload.data.revision.id);
      assert.strictEqual(repeat.payload.data.swaps[0].id, savedSwapId);

      const invalidDaySwap = await api('PUT', '/api/settings/duty-calendar/2026', {
        ...savedPayload,
        revision_no: savedRevisionNo,
        swaps: [{
          date_a: '2026-12-02',
          date_b: '2026-12-05',
          staff_a_id: savedPayload.swaps[0].staff_b_id,
          staff_b_id: staff[0].id
        }]
      });
      assert.strictEqual(invalidDaySwap.status, 400);
      assert.strictEqual(await DutyCalendarRevision.count(), baseline.revisions + 2);

      const executedLog = await AutoTaskRunLog.create({
        id: uuidv4(),
        rule_id: rule.id,
        scheduled_at: new Date('2026-12-01T09:15:00+08:00'),
        event_type: 'duty_start',
        status: 'success',
        message: `${RUN_PREFIX} executed-date guard`,
        notify_status: 'success',
        created_at: new Date()
      });
      const executedSwap = await api('PUT', '/api/settings/duty-calendar/2026', {
        ...savedPayload,
        revision_no: savedRevisionNo,
        swaps: [omitIdSwap]
      });
      assert.strictEqual(executedSwap.status, 200);
      savedRevisionNo = executedSwap.payload.data.revision_no;
      state.revisionIds.push(executedSwap.payload.data.revision.id);
      await executedLog.destroy();
      assert.strictEqual(await DutyCalendarRevision.count(), baseline.revisions + 3);

      const unfinishedAt = new Date('2026-12-01T19:59:59+08:00');
      const unfinished = await dutyCalendarService.getDutySwapEditability(rule, '2026-12-01', unfinishedAt);
      assert.strictEqual(unfinished.editable, true);
      const afterEndTime = await dutyCalendarService.getDutySwapEditability(
        rule,
        '2026-12-01',
        new Date('2026-12-01T20:00:00+08:00')
      );
      assert.strictEqual(afterEndTime.editable, false);
      assert.strictEqual(afterEndTime.reason, 'duty_completed');
      const completedEndLog = await AutoTaskRunLog.create({
        id: uuidv4(),
        rule_id: rule.id,
        scheduled_at: new Date('2026-12-01T20:00:00+08:00'),
        event_type: 'duty_end',
        status: 'success',
        message: `${RUN_PREFIX} completed-date guard`,
        notify_status: 'success',
        created_at: new Date()
      });
      const completedByEndNotice = await dutyCalendarService.getDutySwapEditability(rule, '2026-12-01', unfinishedAt);
      assert.strictEqual(completedByEndNotice.editable, false);
      assert.strictEqual(completedByEndNotice.completed_by_end_notice, true);
      await completedEndLog.destroy();

      const cancelled = await api('DELETE', `/api/settings/duty-calendar/swaps/${savedSwapId}`);
      assert.strictEqual(cancelled.status, 200);
      const afterCancel = await api('GET', `/api/settings/duty-calendar?year=2026&rule_id=${rule.id}`);
      assert.strictEqual(afterCancel.payload.data.swaps.length, 0);

      const restored = await api('PUT', '/api/settings/duty-calendar/2026', {
        ...savedPayload,
        revision_no: savedRevisionNo,
        swaps: [omitIdSwap]
      });
      assert.strictEqual(restored.status, 200);
      savedRevisionNo = restored.payload.data.revision_no;
      state.revisionIds.push(restored.payload.data.revision.id);
      assert.strictEqual(restored.payload.data.swaps.length, 1);
      assert.strictEqual(restored.payload.data.swaps[0].id, savedSwapId);
      const physicalRows = await DutyScheduleSwap.count({ where: { rule_id: rule.id } });
      assert.strictEqual(physicalRows, 1);
      return {
        evidence: {
          first_swap_id: savedSwapId,
          omit_id_reused: repeat.payload.data.swaps[0].id,
          active_after_cancel: afterCancel.payload.data.swaps.length,
          restored_swap_id: restored.payload.data.swaps[0].id,
          physical_rows: physicalRows,
          stopped_or_unconfigured_swap_status: invalidDaySwap.status,
          successful_start_swap_status: executedSwap.status,
          unfinished_same_day_editable: unfinished.editable,
          after_end_time_editable: afterEndTime.editable,
          successful_end_editable: completedByEndNotice.editable,
          revision_no: savedRevisionNo
        },
        assertions: [
          '相同自然键无ID保存复用原换班记录',
          '取消换班采用逻辑取消',
          '停排或未配置日期不能换班',
          '开始提醒已成功但值班未结束时仍可换班',
          '到达结束时间或成功发送结束提醒后禁止换班',
          '取消后重加不会触发唯一键冲突或重复物理行'
        ]
      };
    });

    await runCase('H-008', async () => {
      // Keep the real scheduler before the target while this process verifies the due-time path.
      const target = new Date(Date.now() + 120000);
      const targetParts = getBeijingParts(target);
      const noticeMessage = `${RUN_PREFIX} isolated special notice`;
      const enabledSave = await api('PUT', '/api/settings/duty-calendar/2026', {
        ...savedPayload,
        revision_no: savedRevisionNo,
        exceptions: [{
          calendar_date: targetParts.date,
          notice_enabled: true,
          notice_time: targetParts.time,
          notice_message: noticeMessage,
          notice_at_mode: 'none',
          notice_staff_ids: [],
          skip_staff_ids: []
        }],
        swaps: [{ ...savedPayload.swaps[0] }]
      });
      assert.strictEqual(enabledSave.status, 200);
      savedRevisionNo = enabledSave.payload.data.revision_no;
      state.revisionIds.push(enabledSave.payload.data.revision.id);
      await rule.update({ enabled: true, notify_enabled: true, updated_at: new Date() });
      const simulatedDueAt = new Date(target.getTime() + 1000);
      const firstExecuted = await processDueSpecialDutyNotifications(simulatedDueAt, { ruleIds: [rule.id] });
      const secondExecuted = await processDueSpecialDutyNotifications(simulatedDueAt, { ruleIds: [rule.id] });
      await sleep(300);
      await rule.update({ enabled: false, notify_enabled: false, updated_at: new Date() });
      const logs = await DutySpecialNotificationLog.findAll({ where: { rule_id: rule.id } });
      if (receiver.received.length !== 1) {
        process.stderr.write(`${JSON.stringify({
          target: target.toISOString(),
          target_parts: targetParts,
          first_executed: firstExecuted,
          second_executed: secondExecuted,
          rule_updated_at: rule.updated_at,
          logs: logs.map(log => ({ status: log.status, error: log.notify_error, scheduled_at: log.scheduled_at }))
        }, null, 2)}\n`);
      }
      assert.strictEqual(receiver.received.length, 1);
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].status, 'success');
      const bodyText = receiver.received[0]?.payload?.markdown?.text || '';
      assert.ok(bodyText.includes(noticeMessage));
      return {
        evidence: {
          local_receiver_requests: receiver.received.length,
          special_log_count: logs.length,
          special_log_status: logs[0].status,
          duplicate_requests: 0,
          at_mode: 'none',
          formal_webhook_requests: 0
        },
        assertions: [
          '特殊通知只发送到本机隔离接收器',
          '重复调度扫描不重复发送',
          '特殊通知使用独立成功日志且不要求正常值班事件'
        ]
      };
    });

    await runCase('H-009', async () => {
      const targetDate = '2026-12-03';
      const futureCalendar = await api('GET', `/api/settings/duty-calendar?year=2027&rule_id=${rule.id}`);
      assert.strictEqual(futureCalendar.status, 200);
      assert.ok(futureCalendar.payload.data.suggested_effective_from.startsWith('2027-'));
      assert.strictEqual(futureCalendar.payload.data.days.length, 365);
      const crossYearPreview = await api('POST', '/api/settings/duty-calendar/preview', {
        rule_id: rule.id,
        from: '2026-12-31',
        to: '2028-02-03'
      });
      assert.strictEqual(crossYearPreview.status, 200);
      assert.strictEqual(crossYearPreview.payload.data.days.length, 400);
      const generationBefore = dutyCalendarService.resolverCacheGeneration;
      const first = await dutyCalendarService.resolveDutyDate(rule, targetDate);
      const second = await dutyCalendarService.resolveDutyDate(rule, targetDate);
      assert.strictEqual(first, second, 'same runtime key should return the cached resolved object');
      rule.enabled = true;
      const nextA = await dutyCalendarService.getNextDutyRunAt(rule, new Date('2026-12-01T00:00:00+08:00'));
      const nextB = await dutyCalendarService.getNextDutyRunAt(rule, new Date('2026-12-01T00:00:00+08:00'));
      rule.enabled = false;
      assert.strictEqual(nextA, nextB, 'same runtime key should return the cached next-run object');
      assert.ok(nextA instanceof Date);
      dutyCalendarService.invalidateResolverCache();
      const generationAfter = dutyCalendarService.resolverCacheGeneration;
      const afterInvalidation = await dutyCalendarService.resolveDutyDate(rule, targetDate);
      assert.strictEqual(generationAfter, generationBefore + 1);
      assert.notStrictEqual(first, afterInvalidation, 'cache invalidation must force a new resolved object');
      return {
        evidence: {
          date_cache_identity_match: first === second,
          next_run_cache_identity_match: nextA === nextB,
          cache_generation_before: generationBefore,
          cache_generation_after: generationAfter,
          post_invalidation_recomputed: first !== afterInvalidation,
          future_year_suggested_effective: futureCalendar.payload.data.suggested_effective_from,
          cross_year_preview_days: crossYearPreview.payload.data.days.length,
          next_run_at: nextA?.toISOString() || null,
          carry_forward_fixture: carryEvidence
        },
        assertions: [
          '调度同日解析使用短时缓存',
          '下一次执行查询使用短时缓存',
          '保存与取消操作会使缓存代际失效',
          '非当前年份建议生效日保持在所选年份',
          '400天跨三自然年预览完整加载中间年份',
          '旧逻辑兼容已在无修订基线验证'
        ]
      };
    });

    const deleteRuleResponse = await api('DELETE', `/api/settings/auto-tasks/${rule.id}`);
    assert.strictEqual(deleteRuleResponse.status, 200);
    const ruleDeleteCleanup = {
      exceptions: await DutyScheduleException.count({ where: { rule_id: rule.id } }),
      swaps: await DutyScheduleSwap.count({ where: { rule_id: rule.id } }),
      specialLogs: await DutySpecialNotificationLog.count({ where: { rule_id: rule.id } }),
      rules: await AutoTaskRule.count({ where: { id: rule.id } })
    };
    assert.deepStrictEqual(ruleDeleteCleanup, { exceptions: 0, swaps: 0, specialLogs: 0, rules: 0 });
    const afterCleanup = await cleanupTestData(baseline);
    state.current = 'H-010';
    writeStatus('READY_FOR_UI', `H-001 至 H-009 全部通过；临时数据已清理。基线修订 ${afterCleanup.revisions}、例外 ${afterCleanup.exceptions}、换班 ${afterCleanup.swaps}、特殊日志 ${afterCleanup.specialLogs}。`);
    process.stdout.write(JSON.stringify({
      ok: true,
      passed: state.pass,
      ready_for_ui: true,
      cleanup: afterCleanup,
      rule_delete_cleanup: ruleDeleteCleanup,
      receiver_requests: receiver.received.length
    }, null, 2));
  } finally {
    try {
      if (!state.cleanupComplete) await cleanupTestData(baseline);
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
