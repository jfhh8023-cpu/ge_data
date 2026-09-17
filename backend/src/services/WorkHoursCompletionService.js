const { addDays, dateFromYmd, dateToYmd, getMonday, getWeekdayNumber } = require('../utils/beijingTime');

const HOURS_PER_WORKDAY = 8;
const FORMULA = '工时完成度＝已填工时÷应填工时×100%；应填工时＝所属周期工作日×每天8小时。跨人员、跨周期按应填工时加权，同一人员同一工作日只计一次；超过100%的部分为超额。交付进度仍按有效已填工时加权，独立计算。';

function plain(value) { return value?.toJSON ? value.toJSON() : value; }
function rounded(value) { return Number(value.toFixed(2)); }
function dateKey(value) {
  if (!value) return '';
  if (value instanceof Date) return new Date(value.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function validDate(value) {
  const key = dateKey(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && dateToYmd(dateFromYmd(key)) === key;
}
function normalizedRole(role) { return ({ frontend: 'ai_dev', backend: 'ai_dev', test: 'ai_quality' })[role] || role || ''; }

function taskDateRange(taskValue) {
  const task = plain(taskValue);
  if (!task || !validDate(task.start_date) || !validDate(task.end_date)) return null;
  let start = dateKey(task.start_date);
  let end = dateKey(task.end_date);
  if (end < start) return null;
  // 历史周任务存在周日~周六区间；沿用统计季度归属的 end_date 锚点，
  // 才能归入该次填写所属自然周，兼容现在的周一~周日任务。
  if (task.time_dimension === 'week') {
    start = dateToYmd(getMonday(end));
    end = dateToYmd(addDays(start, 6));
  }
  return { start, end };
}

function isCurrentlyEligible(staff) {
  return (staff.employment_status || (staff.is_active === false ? 'resigned' : 'active')) !== 'resigned';
}

function staffMatchesQuery(staff, query = {}) {
  if (query.staffId && query.staffId !== 'all' && String(staff.id) !== String(query.staffId)) return false;
  if (query.role && query.role !== 'all' && normalizedRole(staff.role) !== normalizedRole(query.role)) return false;
  if (query.sourceType === 'product_manager' && normalizedRole(staff.role) !== 'ai_pm') return false;
  if (query.sourceType === 'engineering' && normalizedRole(staff.role) === 'ai_pm') return false;
  return true;
}

function taskCalendar(task, snapshots = new Map()) {
  const range = taskDateRange(task);
  if (!range) return { workDates: [], calendarStatus: 'invalid_period', start: null, end: null };
  const workDates = [];
  const statuses = new Set();
  for (let date = range.start; date <= range.end; date = dateToYmd(addDays(date, 1))) {
    const snapshot = snapshots.get(Number(date.slice(0, 4)));
    statuses.add(snapshot ? 'official' : 'weekday_fallback');
    const official = snapshot?.days?.find(day => day.date === date);
    const workday = official?.is_adjusted_workday === true || (official?.is_holiday !== true && getWeekdayNumber(date) <= 5);
    if (workday) workDates.push(date);
  }
  return { ...range, workDates, calendarStatus: statuses.has('weekday_fallback') ? 'weekday_fallback' : 'official' };
}

function rates(actualHours, standardHours) {
  const completionRate = standardHours > 0 ? rounded(actualHours / standardHours * 100) : null;
  return { completionRate, excessRate: completionRate === null ? null : rounded(Math.max(0, completionRate - 100)) };
}

/** Pure calculation. Repeated records add hours; repeated staff/date capacity never adds hours twice. */
function buildWorkHours({ tasks = [], records = [], staff = [], snapshots = new Map(), query = {}, scopeNote = '', includeEmptyStaff = false } = {}) {
  const selectedTasks = [...new Map(tasks.map(value => { const task = plain(value); return [String(task.id), task]; })).values()];
  const taskIds = new Set(selectedTasks.map(task => String(task.id)));
  const recordedStaffIds = new Set(records.map(plain).filter(record => taskIds.has(String(record.task_id)))
    .map(record => String(record.staff_id || record.staff?.id || '')));
  const selectedStaff = [...new Map(staff.map(value => { const person = plain(value); return [String(person.id), person]; })).values()]
    .filter(person => isCurrentlyEligible(person) && staffMatchesQuery(person, query)
      && (includeEmptyStaff || recordedStaffIds.has(String(person.id))));
  const staffIds = new Set(selectedStaff.map(person => String(person.id)));
  const unitHours = new Map();
  const seenRecords = new Set();
  let actualHours = 0;
  for (const value of records) {
    const record = plain(value);
    const staffId = String(record.staff_id || record.staff?.id || '');
    const taskId = String(record.task_id || '');
    if (!taskIds.has(taskId) || !staffIds.has(staffId)) continue;
    // A JOIN may repeat the same record. Separate source tables may legally have the same ID.
    const source = record.source_type || (record.is_product_manager_record || record.demand_sources !== undefined ? 'product_manager' : 'engineering');
    const identity = record.id ? `${source}:${record.id}` : null;
    if (identity && seenRecords.has(identity)) continue;
    if (identity) seenRecords.add(identity);
    const hours = Number(record.hours);
    if (!Number.isFinite(hours) || hours < 0) continue;
    actualHours += hours;
    const key = `${staffId}:${taskId}`;
    unitHours.set(key, (unitHours.get(key) || 0) + hours);
  }
  const uniqueDays = new Set();
  const units = [];
  const calendars = new Map(selectedTasks.map(task => [String(task.id), taskCalendar(task, snapshots)]));
  for (const person of selectedStaff) {
    const staffId = String(person.id);
    for (const task of selectedTasks) {
      const taskId = String(task.id);
      const calendar = calendars.get(taskId);
      const workDates = calendar.workDates;
      for (const date of workDates) uniqueDays.add(`${staffId}:${date}`);
      const unitActual = rounded(unitHours.get(`${staffId}:${taskId}`) || 0);
      const standardHours = workDates.length * HOURS_PER_WORKDAY;
      units.push({ staffId, staffName: person.name || '-', role: normalizedRole(person.role), taskId,
        taskTitle: task.title || '', startDate: calendar.start, endDate: calendar.end,
        workDates, calendarStatus: calendar.calendarStatus, actualHours: unitActual,
        standardHours, workingDays: workDates.length, ...rates(unitActual, standardHours) });
    }
  }
  const standardHours = uniqueDays.size * HOURS_PER_WORKDAY;
  const statuses = [...calendars.values()].map(calendar => calendar.calendarStatus);
  const calendarStatus = statuses.includes('invalid_period') ? 'invalid_period'
    : statuses.includes('weekday_fallback') ? 'weekday_fallback' : statuses.length ? 'official' : 'empty';
  const partialScope = query.versionType || query.demandSourceId;
  const note = scopeNote || (partialScope
    ? '当前筛选范围有记录的非离职人员，按完整所选周期计算应填工时；未填周不缩减基准。'
    : '当前非离职且所选范围有记录的人员计入；按完整所选周期工作日计算，未填周保留，同一人员同一工作日去重。');
  const completion = calendarStatus === 'invalid_period'
    ? { completionRate: null, excessRate: null } : rates(actualHours, standardHours);
  return { actualHours: rounded(actualHours), standardHours, ...completion,
    workingDays: uniqueDays.size, hoursPerWorkday: HOURS_PER_WORKDAY, calendarStatus, units,
    formula: FORMULA, scopeNote: note,
    calendarNote: calendarStatus === 'weekday_fallback' ? '部分年份缺少官方节假日快照，暂按周一至周五估算，未计该年份节假日与调休。'
      : calendarStatus === 'invalid_period' ? '部分周期日期无效，应填工时基准不完整，暂不计算完成度；已填工时仍完整保留。' : '工作日按官方节假日和调休补班计算。' };
}

/** Read-only context: no holiday sync, table creation, scheduler or persistence. */
async function loadWorkHoursContext({ tasks = [], staff, query = {}, scopeNote = '', includeEmptyStaff = false } = {}) {
  const { Staff } = require('../models');
  const { getCachedOfficialHolidaySnapshot } = require('./OfficialHolidaySyncService');
  const people = (staff || await Staff.findAll({ attributes: ['id', 'name', 'role', 'employment_status', 'is_active', 'status_changed_at'] }))
    .map(plain).filter(person => staffMatchesQuery(person, query));
  const snapshots = new Map();
  for (const task of tasks) {
    const range = taskDateRange(task);
    if (!range) continue;
    for (let year = Number(range.start.slice(0, 4)); year <= Number(range.end.slice(0, 4)); year += 1) {
      if (snapshots.has(year)) continue;
      try { snapshots.set(year, getCachedOfficialHolidaySnapshot(year)); } catch { snapshots.set(year, null); }
    }
  }
  return { tasks, staff: people, snapshots, query, scopeNote, includeEmptyStaff };
}

async function getWorkHours(options = {}) {
  return buildWorkHours({ ...await loadWorkHoursContext(options), records: options.records || [] });
}

module.exports = { HOURS_PER_WORKDAY, FORMULA, buildWorkHours, getWorkHours, loadWorkHoursContext, staffMatchesQuery, taskCalendar, taskDateRange };
