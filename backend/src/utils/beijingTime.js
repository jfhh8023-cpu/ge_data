const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'Asia/Shanghai';

function pad(n) {
  return String(n).padStart(2, '0');
}

function getBeijingParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`
  };
}

function dateFromYmd(ymd) {
  if (ymd instanceof Date) return new Date(Date.UTC(ymd.getUTCFullYear(), ymd.getUTCMonth(), ymd.getUTCDate()));
  const [year, month, day] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateToYmd(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDays(date, days) {
  const d = dateFromYmd(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function getIsoWeekInfo(date) {
  const d = dateFromYmd(date);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const weekYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((d - yearStart) / DAY_MS) + 1) / 7);
  return { year: weekYear, week };
}

function getMonday(date) {
  const d = dateFromYmd(date);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 1);
  return d;
}

function getIsoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = getMonday(jan4);
  firstMonday.setUTCDate(firstMonday.getUTCDate() + (Number(week) - 1) * 7);
  return firstMonday;
}

function getBeijingDate(date = new Date()) {
  const parts = getBeijingParts(date);
  return dateFromYmd(parts.date);
}

function getWeekdayNumber(date) {
  const d = dateFromYmd(date);
  return d.getUTCDay() || 7;
}

function getBeijingScheduledAt(parts, executeTime) {
  return new Date(`${parts.date}T${executeTime}+08:00`);
}

function formatBeijingTimestamp(date = new Date()) {
  const parts = getBeijingParts(date);
  return `${parts.year}${pad(parts.month)}${pad(parts.day)}_${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}`;
}

module.exports = {
  addDays,
  dateFromYmd,
  dateToYmd,
  formatBeijingTimestamp,
  getBeijingDate,
  getBeijingParts,
  getBeijingScheduledAt,
  getIsoWeekMonday,
  getIsoWeekInfo,
  getMonday,
  getWeekdayNumber
};
