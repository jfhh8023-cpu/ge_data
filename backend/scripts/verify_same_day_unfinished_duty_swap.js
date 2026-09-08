const assert = require('assert');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  sequelize,
  AutoTaskRule,
  AutoTaskRunLog,
  DutyCalendarRevision,
  DutyScheduleException,
  DutyScheduleSwap,
  Staff
} = require('../src/models');
const {
  ensureDutyCalendarTables,
  getDutyCalendar,
  getDutySwapEditability,
  invalidateResolverCache,
  resolveDutyDate
} = require('../src/services/DutyCalendarService');
const { addDays, dateToYmd, getBeijingParts, getWeekdayNumber } = require('../src/utils/beijingTime');

const API_BASE = process.env.DUTY_TEST_API_BASE || 'http://127.0.0.1:3001';
const RUN_PREFIX = 'CODEX-SAME-DAY-UNFINISHED-SWAP-20260908';

function dutyItem(staffIds, label) {
  return {
    enabled: true,
    staff_ids: staffIds,
    start_time: '09:00:00',
    end_time: '23:59:59',
    send_mode: 'start_and_end',
    start_message: `${RUN_PREFIX} ${label} start`,
    end_message: `${RUN_PREFIX} ${label} end`
  };
}

function dutyConfig(today, targetDate, staff) {
  const weekly = {};
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    weekly[String(weekday)] = dutyItem([staff[(weekday - 1) % staff.length].id], `weekday-${weekday}`);
  }
  weekly[String(getWeekdayNumber(today))] = dutyItem([staff[0].id, staff[2].id], 'today');
  weekly[String(getWeekdayNumber(targetDate))] = dutyItem([staff[1].id, staff[3].id], 'target');
  return {
    weekly,
    monthly: {},
    weekly_mode: 'fixed',
    weekly_rotation: { staff_ids: staff.map(item => item.id), end_weekday: 7, start_date: today },
    weekly_versions: []
  };
}

async function api(method, pathname, body) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, payload: text ? JSON.parse(text) : null };
}

async function main() {
  await ensureDutyCalendarTables();
  const health = await api('GET', '/api/health');
  assert.strictEqual(health.status, 200, 'local API must be running before this regression test');

  const baselineRevisions = await DutyCalendarRevision.findAll({ order: [['revision_no', 'ASC']] });
  const baseline = {
    revisionCount: baselineRevisions.length,
    active: baselineRevisions.map(row => ({ id: row.id, is_active: Boolean(row.is_active), updated_at: row.updated_at })),
    ruleCount: await AutoTaskRule.count({ where: { name: `${RUN_PREFIX} isolated rule` } })
  };
  const staff = await Staff.findAll({
    where: { employment_status: { [Op.ne]: 'resigned' } },
    order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
    limit: 4
  });
  assert.strictEqual(staff.length, 4, 'same-day swap test requires four non-resigned staff');

  const today = getBeijingParts(new Date()).date;
  const targetDate = dateToYmd(addDays(today, 1));
  const year = Number(today.slice(0, 4));
  assert.strictEqual(Number(targetDate.slice(0, 4)), year, 'test date must remain in the same calendar year');
  const rule = await AutoTaskRule.create({
    id: uuidv4(),
    name: `${RUN_PREFIX} isolated rule`,
    enabled: false,
    task_type: 'duty_notify',
    action_mode: 'notify_only',
    schedule_type: 'weekly',
    schedule_year: year,
    month_days: [],
    week_days: [1, 2, 3, 4, 5, 6, 7],
    execute_time: '09:00:00',
    notify_enabled: false,
    dingtalk_webhook: '[]',
    dingtalk_message: `${RUN_PREFIX} parent`,
    dingtalk_recipients: JSON.stringify({ enabled: false, at_mode: 'people', staff_ids: [], extra: [] }),
    duty_config: JSON.stringify(dutyConfig(today, targetDate, staff)),
    created_at: new Date(),
    updated_at: new Date()
  });
  const revisionIds = [];

  try {
    await AutoTaskRunLog.create({
      id: uuidv4(),
      rule_id: rule.id,
      scheduled_at: new Date(`${today}T09:00:00+08:00`),
      event_type: 'duty_start',
      status: 'success',
      message: `${RUN_PREFIX} start was sent`,
      notify_status: 'success',
      created_at: new Date()
    });

    const calendar = await getDutyCalendar({ year, ruleId: rule.id });
    const basePayload = {
      rule_id: rule.id,
      effective_from: today,
      manual_overrides: { [today]: 'force_work', [targetDate]: 'force_work' },
      exceptions: [],
      swaps: [{
        date_a: today,
        date_b: targetDate,
        staff_a_id: staff[0].id,
        staff_b_id: staff[1].id
      }]
    };
    const created = await api('PUT', `/api/settings/duty-calendar/${year}`, {
      ...basePayload,
      revision_no: calendar.revision_no
    });
    assert.strictEqual(created.status, 200, 'successful start notification must not block a new unfinished same-day swap');
    revisionIds.push(created.payload.data.revision.id);
    const createdSwap = created.payload.data.swaps[0];

    const edited = await api('PUT', `/api/settings/duty-calendar/${year}`, {
      ...basePayload,
      revision_no: created.payload.data.revision_no,
      swaps: [{
        id: createdSwap.id,
        date_a: today,
        date_b: targetDate,
        staff_a_id: staff[2].id,
        staff_b_id: staff[3].id
      }]
    });
    assert.strictEqual(edited.status, 200, 'successful start notification must not block editing an unfinished same-day swap');
    revisionIds.push(edited.payload.data.revision.id);
    const editedSwap = edited.payload.data.swaps[0];
    assert.strictEqual(editedSwap.staff_a_id, staff[2].id);
    assert.strictEqual(editedSwap.staff_b_id, staff[3].id);
    const resolvedAfterEdit = await resolveDutyDate(rule, today);
    assert.deepStrictEqual(resolvedAfterEdit.final_staff_ids, [staff[0].id, staff[3].id]);
    assert.deepStrictEqual(
      resolvedAfterEdit.events.find(event => event.kind === 'end')?.staff_ids,
      [staff[0].id, staff[3].id]
    );

    const cancelled = await api('DELETE', `/api/settings/duty-calendar/swaps/${editedSwap.id}`);
    assert.strictEqual(cancelled.status, 200, 'successful start notification must not block cancelling an unfinished same-day swap');

    const beforeEnd = await getDutySwapEditability(rule, today, new Date(`${today}T12:00:00+08:00`));
    assert.strictEqual(beforeEnd.editable, true);
    const afterEndTime = await getDutySwapEditability(rule, today, new Date(`${today}T23:59:59+08:00`));
    assert.strictEqual(afterEndTime.editable, false);
    assert.strictEqual(afterEndTime.reason, 'duty_completed');

    await AutoTaskRunLog.create({
      id: uuidv4(),
      rule_id: rule.id,
      scheduled_at: new Date(`${today}T23:59:59+08:00`),
      event_type: 'duty_end',
      status: 'success',
      message: `${RUN_PREFIX} end was sent`,
      notify_status: 'success',
      created_at: new Date()
    });
    const afterEndNotice = await getDutySwapEditability(rule, today, new Date(`${today}T12:00:00+08:00`));
    assert.strictEqual(afterEndNotice.editable, false);
    assert.strictEqual(afterEndNotice.completed_by_end_notice, true);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      created_status: created.status,
      edited_status: edited.status,
      cancelled_status: cancelled.status,
      unfinished_end_event_staff_ids: resolvedAfterEdit.events.find(event => event.kind === 'end')?.staff_ids,
      start_sent_before_end_editable: beforeEnd.editable,
      after_end_time_editable: afterEndTime.editable,
      after_end_notice_editable: afterEndNotice.editable
    }, null, 2)}\n`);
  } finally {
    await AutoTaskRunLog.destroy({ where: { rule_id: rule.id } });
    await DutyScheduleSwap.destroy({ where: { rule_id: rule.id } });
    await DutyScheduleException.destroy({ where: { rule_id: rule.id } });
    await AutoTaskRule.destroy({ where: { id: rule.id } });
    if (revisionIds.length > 0) {
      await DutyCalendarRevision.destroy({ where: { id: { [Op.in]: revisionIds } } });
    }
    for (const row of baseline.active) {
      await DutyCalendarRevision.update(
        { is_active: row.is_active, updated_at: row.updated_at },
        { where: { id: row.id }, silent: true }
      );
    }
    invalidateResolverCache();
    assert.strictEqual(await DutyCalendarRevision.count(), baseline.revisionCount, 'calendar revisions must return to baseline');
    assert.strictEqual(await AutoTaskRule.count({ where: { name: `${RUN_PREFIX} isolated rule` } }), baseline.ruleCount, 'test rule must be cleaned');
  }
}

(async () => {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
