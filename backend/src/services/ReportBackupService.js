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

function mergeRoleLists(...lists) {
  return lists.flatMap(list => safeParseJsonArray(list));
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
      AI产品经理: '',
      AI开发工程师: '',
      AI开发工程师工时: 0,
      VOIP工程师: '',
      VOIP工程师工时: 0,
      AI质量工程师: '',
      AI质量工程师工时: 0,
      合计工时: 0,
      备注: ''
    }];
  }

  return groups.map(group => {
    const aiDevelopers = mergeRoleLists(group.frontend, group.backend);
    const aiDevHours = roleTotal(aiDevelopers);
    const voipHours = roleTotal(group.voip);
    const aiQualityHours = roleTotal(group.test_role);
    return {
      周期: task.title,
      年份: task.year,
      周数: task.week_number || '',
      开始日期: task.start_date,
      结束日期: task.end_date,
      需求名称: group.merged_title || '',
      版本: group.version || '',
      AI产品经理: pmText(group.product_managers),
      AI开发工程师: roleText(aiDevelopers),
      AI开发工程师工时: aiDevHours,
      VOIP工程师: roleText(group.voip),
      VOIP工程师工时: voipHours,
      AI质量工程师: roleText(group.test_role),
      AI质量工程师工时: aiQualityHours,
      合计工时: aiDevHours + voipHours + aiQualityHours,
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

    section.push('| 需求名称 | 版本 | AI产品经理 | AI开发工程师 | AI开发工程师工时 | VOIP工程师 | VOIP工程师工时 | AI质量工程师 | AI质量工程师工时 | 合计工时 | 备注 |');
    section.push('| --- | --- | --- | --- | ---: | --- | ---: | --- | ---: | ---: | --- |');
    for (const row of rows) {
      section.push(`| ${row.需求名称} | ${row.版本} | ${row.AI产品经理} | ${row.AI开发工程师} | ${row.AI开发工程师工时} | ${row.VOIP工程师} | ${row.VOIP工程师工时} | ${row.AI质量工程师} | ${row.AI质量工程师工时} | ${row.合计工时} | ${String(row.备注 || '').replace(/\|/g, '\\|')} |`);
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
