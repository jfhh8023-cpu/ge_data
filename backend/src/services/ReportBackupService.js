const XLSX = require('xlsx');
const { CollectionTask, MatchGroup } = require('../models');
const { safeParseJsonArray } = require('../utils/parseJson');
const { formatBeijingTimestamp } = require('../utils/beijingTime');

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

function buildTaskRows(task) {
  const groups = task.matchGroups || [];
  if (!groups.length) {
    return [{
      周期: task.title,
      年份: task.year,
      周数: task.week_number || '',
      开始日期: task.start_date,
      结束日期: task.end_date,
      需求名称: '暂无需求工时统计数据',
      版本: '',
      产品经理: '',
      前端: '',
      前端工时: 0,
      后端: '',
      后端工时: 0,
      测试: '',
      测试工时: 0,
      合计工时: 0,
      备注: ''
    }];
  }

  return groups.map(group => {
    const frontendHours = roleTotal(group.frontend);
    const backendHours = roleTotal(group.backend);
    const testHours = roleTotal(group.test_role);
    return {
      周期: task.title,
      年份: task.year,
      周数: task.week_number || '',
      开始日期: task.start_date,
      结束日期: task.end_date,
      需求名称: group.merged_title || '',
      版本: group.version || '',
      产品经理: pmText(group.product_managers),
      前端: roleText(group.frontend),
      前端工时: frontendHours,
      后端: roleText(group.backend),
      后端工时: backendHours,
      测试: roleText(group.test_role),
      测试工时: testHours,
      合计工时: frontendHours + backendHours + testHours,
      备注: group.remark || ''
    };
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

function buildExcel(tasks) {
  const workbook = XLSX.utils.book_new();
  const allRows = [];
  const overview = [];
  const taskSheets = [];
  const usedSheetNames = new Set();
  let totalHours = 0;
  let nonEmptyTaskCount = 0;

  for (const task of tasks) {
    const rows = buildTaskRows(task);
    const taskTotal = rows.reduce((sum, row) => sum + (Number(row.合计工时) || 0), 0);
    totalHours += taskTotal;
    if ((task.matchGroups || []).length > 0) nonEmptyTaskCount++;
    overview.push({
      周期: task.title,
      年份: task.year,
      周数: task.week_number || '',
      开始日期: task.start_date,
      结束日期: task.end_date,
      统计行数: (task.matchGroups || []).length,
      合计工时: taskTotal
    });
    allRows.push(...rows);

    const sheet = XLSX.utils.json_to_sheet(rows);
    const sheetName = uniqueSheetName(`${task.year || ''}W${task.week_number || ''}_${task.title || task.id}`, usedSheetNames);
    taskSheets.push({ sheet, sheetName });
  }

  const summaryRows = [
    { 指标: '周期数量', 数值: tasks.length },
    { 指标: '有统计数据的周期数量', 数值: nonEmptyTaskCount },
    { 指标: '总工时', 数值: totalHours },
    {},
    ...overview
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), '总览');
  for (const item of taskSheets) {
    XLSX.utils.book_append_sheet(workbook, item.sheet, item.sheetName);
  }
  if (allRows.length === 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 提示: '暂无需求工时统计数据' }]), '周期数据');
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function buildMarkdown(tasks) {
  const lines = [];
  const exportedAt = formatBeijingTimestamp().replace('_', ' ');
  let totalHours = 0;
  let nonEmptyTaskCount = 0;

  lines.push('# 需求工时统计全量备份');
  lines.push('');
  lines.push(`导出时间：${exportedAt}`);
  lines.push('');

  const taskSections = tasks.map(task => {
    const rows = buildTaskRows(task);
    const taskTotal = rows.reduce((sum, row) => sum + (Number(row.合计工时) || 0), 0);
    totalHours += taskTotal;
    if ((task.matchGroups || []).length > 0) nonEmptyTaskCount++;

    const section = [];
    section.push(`## ${task.title}`);
    section.push('');
    section.push(`- 周期：${taskLabel(task)}`);
    section.push(`- 日期：${task.start_date} 至 ${task.end_date}`);
    section.push(`- 合计工时：${taskTotal}`);
    section.push('');

    if (!(task.matchGroups || []).length) {
      section.push('暂无需求工时统计数据');
      section.push('');
      return section.join('\n');
    }

    section.push('| 需求名称 | 版本 | 产品经理 | 前端 | 前端工时 | 后端 | 后端工时 | 测试 | 测试工时 | 合计工时 | 备注 |');
    section.push('| --- | --- | --- | --- | ---: | --- | ---: | --- | ---: | ---: | --- |');
    for (const row of rows) {
      section.push(`| ${row.需求名称} | ${row.版本} | ${row.产品经理} | ${row.前端} | ${row.前端工时} | ${row.后端} | ${row.后端工时} | ${row.测试} | ${row.测试工时} | ${row.合计工时} | ${String(row.备注 || '').replace(/\|/g, '\\|')} |`);
    }
    section.push('');
    return section.join('\n');
  });

  lines.push('## 总览');
  lines.push('');
  lines.push(`- 周期数量：${tasks.length}`);
  lines.push(`- 有统计数据的周期数量：${nonEmptyTaskCount}`);
  lines.push(`- 总工时：${totalHours}`);
  lines.push('');
  lines.push(...taskSections);
  return Buffer.from(lines.join('\n'), 'utf8');
}

async function buildReportBackup(format = 'xlsx') {
  const tasks = await loadBackupData();
  const safeFormat = format === 'md' ? 'md' : 'xlsx';
  const filename = `需求工时统计全量备份_${formatBeijingTimestamp()}.${safeFormat}`;
  if (safeFormat === 'md') {
    return {
      filename,
      mime: 'text/markdown; charset=utf-8',
      buffer: buildMarkdown(tasks)
    };
  }
  return {
    filename,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: buildExcel(tasks)
  };
}

module.exports = { buildReportBackup };
