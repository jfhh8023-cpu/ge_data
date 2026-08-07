const XLSX = require('xlsx');
const { CollectionTask, MatchGroup } = require('../models');
const { getRoleDefinitions, normalizeStaffRole } = require('./RoleService');
const { safeParseJsonArray } = require('../utils/parseJson');
const { formatBeijingTimestamp } = require('../utils/beijingTime');

function parseJsonObject(value) {
  if (value && !Array.isArray(value) && typeof value === 'object') return value;
  let text = typeof value === 'string' ? value.trim() : '';
  for (let i = 0; i < 2 && text; i += 1) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') return parsed;
      if (typeof parsed === 'string') text = parsed;
      else break;
    } catch { break; }
  }
  return {};
}

function roleText(list) {
  const arr = safeParseJsonArray(list);
  if (!arr.length) return '';
  return arr.map(item => {
    const name = item.staffName || item.name || '';
    const hours = Number(item.hours || 0);
    return `${name}${Number.isFinite(hours) ? `(${hours}h)` : ''}`;
  }).filter(Boolean).join('、');
}

function roleTotal(list) {
  return safeParseJsonArray(list).reduce((sum, item) => sum + (Number(item.hours) || 0), 0);
}

function pmText(value) {
  return safeParseJsonArray(value).join('、');
}

function taskLabel(task) {
  const week = task.week_number ? `第${task.week_number}周` : task.time_dimension;
  return `${task.year || ''} ${week || ''}`.trim();
}

function roleBuckets(group) {
  const parsed = parseJsonObject(group.role_buckets);
  if (Object.keys(parsed).length) return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [normalizeStaffRole(key), safeParseJsonArray(value)]));
  return {
    ai_dev: [...safeParseJsonArray(group.frontend), ...safeParseJsonArray(group.backend)],
    voip: safeParseJsonArray(group.voip),
    ai_quality: safeParseJsonArray(group.test_role)
  };
}

function emptyTaskRow(task, roles) {
  const row = {
    周期: task.title,
    年份: task.year,
    周数: task.week_number || '',
    开始日期: task.start_date,
    结束日期: task.end_date,
    需求名称: '暂无需求工时统计数据',
    版本: '',
    AI产品经理: ''
  };
  for (const role of roles) {
    row[role.name] = '';
    row[`${role.name}工时`] = 0;
  }
  row.合计工时 = 0;
  row.备注 = '';
  return row;
}

function buildTaskRows(task, roles) {
  const groups = task.matchGroups || [];
  if (!groups.length) return [emptyTaskRow(task, roles)];
  return groups.map(group => {
    const buckets = roleBuckets(group);
    const row = {
      周期: task.title,
      年份: task.year,
      周数: task.week_number || '',
      开始日期: task.start_date,
      结束日期: task.end_date,
      需求名称: group.merged_title || '',
      版本: group.version || '',
      AI产品经理: pmText(group.product_managers)
    };
    let total = 0;
    for (const role of roles) {
      const list = buckets[role.key] || [];
      const hours = roleTotal(list);
      row[role.name] = roleText(list);
      row[`${role.name}工时`] = hours;
      total += hours;
    }
    row.合计工时 = total;
    row.备注 = group.remark || '';
    return row;
  });
}

function uniqueSheetName(base, used) {
  let name = base.replace(/[\\/?*[\]:]/g, '').slice(0, 31) || '周期';
  let i = 1;
  while (used.has(name)) {
    const suffix = `_${i++}`;
    name = `${base.replace(/[\\/?*[\]:]/g, '').slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name);
  return name;
}

async function loadBackupData() {
  return CollectionTask.findAll({
    include: [{ model: MatchGroup, as: 'matchGroups', required: false }],
    order: [['year', 'DESC'], ['start_date', 'DESC']]
  });
}

function buildExcel(tasks, roles) {
  const workbook = XLSX.utils.book_new();
  const overview = [];
  const taskSheets = [];
  const usedSheetNames = new Set();
  let totalHours = 0;
  let nonEmptyTaskCount = 0;

  for (const task of tasks) {
    const rows = buildTaskRows(task, roles);
    const taskTotal = rows.reduce((sum, row) => sum + (Number(row.合计工时) || 0), 0);
    totalHours += taskTotal;
    if ((task.matchGroups || []).length > 0) nonEmptyTaskCount += 1;
    overview.push({
      周期: task.title,
      年份: task.year,
      周数: task.week_number || '',
      开始日期: task.start_date,
      结束日期: task.end_date,
      统计行数: (task.matchGroups || []).length,
      合计工时: taskTotal
    });
    taskSheets.push({
      sheet: XLSX.utils.json_to_sheet(rows),
      sheetName: uniqueSheetName(`${task.year || ''}W${task.week_number || ''}_${task.title || task.id}`, usedSheetNames)
    });
  }

  const summaryRows = [
    { 指标: '周期数量', 数值: tasks.length },
    { 指标: '有统计数据的周期数量', 数值: nonEmptyTaskCount },
    { 指标: '总工时', 数值: totalHours },
    {},
    ...overview
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), '总览');
  for (const item of taskSheets) XLSX.utils.book_append_sheet(workbook, item.sheet, item.sheetName);
  if (!taskSheets.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 提示: '暂无需求工时统计数据' }]), '周期数据');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildMarkdown(tasks, roles) {
  const lines = ['# 需求工时统计全量备份', '', `导出时间：${formatBeijingTimestamp().replace('_', ' ')}`, ''];
  let totalHours = 0;
  let nonEmptyTaskCount = 0;
  const sections = [];
  const roleHeaders = roles.flatMap(role => [role.name, `${role.name}工时`]);
  for (const task of tasks) {
    const rows = buildTaskRows(task, roles);
    const taskTotal = rows.reduce((sum, row) => sum + (Number(row.合计工时) || 0), 0);
    totalHours += taskTotal;
    if ((task.matchGroups || []).length > 0) nonEmptyTaskCount += 1;
    sections.push(`## ${task.title}`, '', `- 周期：${taskLabel(task)}`, `- 日期：${task.start_date} 至 ${task.end_date}`, `- 合计工时：${taskTotal}`, '');
    if (!(task.matchGroups || []).length) {
      sections.push('暂无需求工时统计数据', '');
      continue;
    }
    const headers = ['需求名称', '版本', 'AI产品经理', ...roleHeaders, '合计工时', '备注'];
    sections.push(`| ${headers.join(' | ')} |`, `| ${headers.map((_, index) => index >= 4 && index % 2 === 0 ? '---:' : '---').join(' | ')} |`);
    for (const row of rows) sections.push(`| ${headers.map(header => markdownCell(row[header])).join(' | ')} |`);
    sections.push('');
  }
  lines.push('## 总览', '', `- 周期数量：${tasks.length}`, `- 有统计数据的周期数量：${nonEmptyTaskCount}`, `- 总工时：${totalHours}`, '', ...sections);
  return Buffer.from(lines.join('\n'), 'utf8');
}

async function buildReportBackup(format = 'xlsx') {
  const tasks = await loadBackupData();
  const roles = getRoleDefinitions();
  const safeFormat = format === 'md' ? 'md' : 'xlsx';
  const filename = `需求工时统计全量备份_${formatBeijingTimestamp()}.${safeFormat}`;
  if (safeFormat === 'md') {
    return { filename, mime: 'text/markdown; charset=utf-8', buffer: buildMarkdown(tasks, roles) };
  }
  return { filename, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buildExcel(tasks, roles) };
}

module.exports = { buildReportBackup };
