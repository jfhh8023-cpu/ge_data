const assert = require('assert');

const BASE_URL = process.env.DEVTRACKER_BASE_URL || 'http://127.0.0.1:3001/api';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json();
  assert.strictEqual(response.ok, true, `${path} returned HTTP ${response.status}`);
  assert.strictEqual(payload.code, 0, payload.message || `${path} returned a business error`);
  return payload.data;
}

function beijingDate(value) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

async function main() {
  const taskData = await request('/settings/auto-tasks');
  const rule = taskData.rules.find(item => item.task_type === 'duty_notify');
  assert.ok(rule, 'No duty notification rule found');

  const calendar = await request(`/settings/duty-calendar?year=2026&rule_id=${encodeURIComponent(rule.id)}`);
  assert.strictEqual(calendar.first_effective_from, '2026-08-24');
  assert.strictEqual(calendar.days.length, 365);

  const dayByDate = new Map(calendar.days.map(day => [day.date, day]));
  for (const date of ['2026-02-16', '2026-05-01', '2026-06-19', '2026-10-01']) {
    const day = dayByDate.get(date);
    assert.strictEqual(day?.is_official_holiday, true, `${date} must be an official holiday`);
    assert.strictEqual(day?.effective_skipped, true, `${date} must be marked as skipped in the calendar`);
  }

  const adjustedWorkdays = [
    '2026-01-04',
    '2026-02-14',
    '2026-02-28',
    '2026-05-09',
    '2026-09-20',
    '2026-10-10'
  ];
  for (const date of adjustedWorkdays) {
    const day = dayByDate.get(date);
    assert.strictEqual(day?.is_adjusted_workday, true, `${date} must be an official adjusted workday`);
    assert.strictEqual(day?.effective_skipped, false, `${date} must remain a working day`);
  }

  const runtimePreview = await request('/settings/duty-calendar/preview', {
    method: 'POST',
    body: JSON.stringify({ rule_id: rule.id, from: '2026-08-24', to: '2026-10-10' })
  });
  const runtimeByDate = new Map(runtimePreview.days.map(day => [day.date, day]));

  const presentationPreview = await request('/settings/duty-calendar/preview', {
    method: 'POST',
    body: JSON.stringify({
      rule_id: rule.id,
      from: '2026-01-01',
      to: '2026-12-31',
      presentation_before_first_effective: true,
      draft: {
        calendar_revision: {
          calendar_year: 2026,
          effective_from: calendar.revision.effective_from,
          manual_overrides: calendar.revision.manual_overrides
        },
        exceptions: calendar.exceptions,
        swaps: calendar.swaps
      }
    })
  });
  const presentationByDate = new Map(presentationPreview.days.map(day => [day.date, day]));
  const effectiveSkippedDays = calendar.days.filter(day => (
    day.date >= calendar.first_effective_from &&
    day.date <= '2026-10-10' &&
    day.effective_skipped
  ));
  assert.ok(effectiveSkippedDays.length > 0, 'No effective skipped days found in the verification window');
  for (const day of effectiveSkippedDays) {
    const result = runtimeByDate.get(day.date);
    assert.strictEqual(result?.whole_day_skipped, true, `${day.date} must be skipped by the scheduler`);
    assert.deepStrictEqual(result?.final_staff_ids, [], `${day.date} must not have duty staff`);
    assert.deepStrictEqual(result?.events, [], `${day.date} must not have duty notification events`);
  }

  for (const date of adjustedWorkdays) {
    const result = presentationByDate.get(date);
    assert.strictEqual(result?.whole_day_skipped, false, `${date} must participate in scheduling`);
    assert.ok(result?.final_staff_ids.length > 0, `${date} must have duty staff`);
    assert.ok(result?.events.length > 0, `${date} must have duty notification events`);
    if (date < calendar.first_effective_from) {
      assert.strictEqual(result.presentation_only, true, `${date} must be marked as presentation-only`);
      assert.strictEqual(result.runtime_effective_from, calendar.first_effective_from);
    } else {
      assert.deepStrictEqual(result.final_staff_ids, runtimeByDate.get(date)?.final_staff_ids);
      assert.deepStrictEqual(result.events, runtimeByDate.get(date)?.events);
    }
  }

  for (const date of ['2026-02-16', '2026-05-01', '2026-06-19', '2026-10-01']) {
    const result = presentationByDate.get(date);
    assert.strictEqual(result?.whole_day_skipped, true, `${date} must remain skipped in presentation preview`);
    assert.deepStrictEqual(result?.final_staff_ids, [], `${date} must not show duty staff`);
    assert.deepStrictEqual(result?.events, [], `${date} must not show duty notification events`);
  }

  const officialHolidayDates = new Set(
    calendar.days.filter(day => day.is_official_holiday).map(day => day.date)
  );
  const holidayRunLogs = taskData.logs.filter(log => (
    log.rule_id === rule.id &&
    log.status === 'success' &&
    officialHolidayDates.has(beijingDate(log.scheduled_at))
  ));
  assert.deepStrictEqual(holidayRunLogs, [], 'Found successful duty notification logs on official holidays');

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    first_effective_from: calendar.first_effective_from,
    checked_skipped_days: effectiveSkippedDays.length,
    adjusted_workdays: adjustedWorkdays.map(date => ({
      date,
      presentation_only: presentationByDate.get(date).presentation_only === true,
      staff_names: presentationByDate.get(date).final_staff.map(staff => staff.name),
      event_kinds: presentationByDate.get(date).events.map(event => event.kind)
    })),
    successful_holiday_run_logs: holidayRunLogs.length
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
