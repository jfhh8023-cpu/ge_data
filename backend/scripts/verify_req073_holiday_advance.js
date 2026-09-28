/**
 * REQ-073: weekly task-create rules that fall on a skipped day (holiday/weekend/manual skip)
 * run on the last workday BEFORE the break; child notifications still defer to the first workday AFTER.
 * Read-only against the configured DB (calendar revisions + official 2026 snapshot). No writes.
 *
 *   node backend/scripts/verify_req073_holiday_advance.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { sequelize } = require('../src/models');
const dutyCalendarService = require('../src/services/DutyCalendarService');
const {
  getDueRuleScheduledAtAsync,
  getNextChildRunAtAsync,
  getNextRunAtAsync
} = require('../src/services/AutoTaskService');

const OUT_DIR = path.resolve(__dirname, '../../docs/@test/req073_holiday_advance_20260928');
const bj = value => new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
const at = text => new Date(`${text}+08:00`);

const fridayRule = {
  id: 'req073-rule',
  enabled: true,
  task_type: 'task_create_notify',
  action_mode: 'run_and_notify',
  notify_enabled: true,
  schedule_type: 'weekly',
  schedule_year: null,
  month_days: [],
  week_days: [5],
  execute_time: '14:00:00',
  created_at: at('2026-08-24T09:44:13'),
  updated_at: at('2026-08-24T09:44:13')
};

const mondayChild = {
  id: 'req073-child',
  rule_id: fridayRule.id,
  enabled: true,
  schedule_type: 'weekly',
  month_days: [],
  week_days: [1],
  execute_time: '09:15:00',
  status: 'pending',
  activation_token: 'token',
  activated_at: at('2026-09-30T14:00:00'),
  activation_scheduled_at: at('2026-09-30T14:00:00'),
  created_at: at('2026-09-21T09:26:49'),
  updated_at: at('2026-09-21T09:26:49')
};

async function main() {
  const results = [];
  const check = (name, actual, expected) => {
    results.push({ name, expected, actual });
    assert.strictEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
    console.log(`PASS ${name}: ${actual}`);
  };

  const days = {};
  for (const ymd of ['2026-09-18', '2026-09-20', '2026-09-24', '2026-09-25', '2026-09-27', '2026-09-28', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-07', '2026-10-08', '2026-10-09']) {
    const day = await dutyCalendarService.getGlobalCalendarDay(ymd);
    days[ymd] = { skipped: day.effective_skipped, reasons: day.skip_reasons };
  }
  check('calendar 2026-09-25 mid-autumn skipped', days['2026-09-25'].skipped, true);
  check('calendar 2026-09-20 adjusted workday not skipped', days['2026-09-20'].skipped, false);
  check('calendar 2026-10-02 national day skipped', days['2026-10-02'].skipped, true);

  check('advance sources for 2026-09-24',
    (await dutyCalendarService.getGlobalScheduleAdvanceSourceDates('2026-09-24')).join(','),
    '2026-09-24,2026-09-25,2026-09-26,2026-09-27');
  check('advance sources for 2026-09-28 (Monday, no pull-back)',
    (await dutyCalendarService.getGlobalScheduleAdvanceSourceDates('2026-09-28')).join(','), '2026-09-28');
  check('advance sources for skipped day is empty',
    (await dutyCalendarService.getGlobalScheduleAdvanceSourceDates('2026-09-25')).length, 0);
  check('defer sources for 2026-09-28 (child still defers)',
    (await dutyCalendarService.getGlobalScheduleSourceDates('2026-09-28')).join(','),
    '2026-09-25,2026-09-26,2026-09-27,2026-09-28');

  check('normal Friday 09-18 unchanged', bj(await getNextRunAtAsync(fridayRule, at('2026-09-18T09:00:00'))), '2026-09-18 14:00:00');
  check('09-24 view: mid-autumn Friday advanced to Thu 09-24', bj(await getNextRunAtAsync(fridayRule, at('2026-09-24T09:00:00'))), '2026-09-24 14:00:00');
  check('09-24 14:00:30 is due', bj(await getDueRuleScheduledAtAsync(fridayRule, at('2026-09-24T14:00:30'))), '2026-09-24 14:00:00');
  check('09-25 14:00:30 (holiday) not due', await getDueRuleScheduledAtAsync(fridayRule, at('2026-09-25T14:00:30')), null);
  check('09-28 14:00:30 (Monday) not due — no more Monday carry-over', await getDueRuleScheduledAtAsync(fridayRule, at('2026-09-28T14:00:30')), null);
  check('09-28 view: next run is Wed 09-30 (national day Fri 10-02 advanced)', bj(await getNextRunAtAsync(fridayRule, at('2026-09-28T10:00:00'))), '2026-09-30 14:00:00');
  check('10-01 view: next run is Fri 10-09', bj(await getNextRunAtAsync(fridayRule, at('2026-10-01T10:00:00'))), '2026-10-09 14:00:00');
  check('10-08 (Thu after break) not due', await getDueRuleScheduledAtAsync(fridayRule, at('2026-10-08T14:00:30')), null);

  const mondayNext = await getNextChildRunAtAsync(mondayChild, fridayRule, at('2026-10-01T10:00:00'));
  check('child Monday 10-05 (holiday) still defers to 10-08', bj(mondayNext), '2026-10-08 09:15:00');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'verify_results.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), calendar: days, results
  }, null, 2), 'utf8');
  console.log(`\nALL PASS (${results.length}) -> ${OUT_DIR}`);
}

main()
  .catch(err => { console.error('FAIL', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
