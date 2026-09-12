const XLSX = require('xlsx');
const { buildVersionView } = require('./WorkloadVersionData');

function validateVersionQuery(body) {
  const invalid = message => { const error = new Error(message); error.status = 400; throw error; };
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('导出参数无效');
  const filters = body.filters ?? {};
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) invalid('筛选条件无效');
  for (const key of ['staff', 'roles', 'versions']) {
    if (filters[key] === undefined) continue;
    if (!Array.isArray(filters[key]) || filters[key].length > 1000 || filters[key].some(value => typeof value !== 'string' || value.length > 500)) invalid('筛选条件必须是字符串列表');
  }
  const groupBy = body.groupBy || 'combination';
  if (!['staff', 'role', 'version', 'combination'].includes(groupBy)) invalid('去重维度无效');
  const sorts = body.sorts ?? {};
  if (!sorts || typeof sorts !== 'object' || Array.isArray(sorts)) invalid('排序条件无效');
  for (const sort of Object.values(sorts)) {
    if (!sort || typeof sort.key !== 'string' || !['asc', 'desc'].includes(sort.direction)) invalid('排序条件无效');
  }
  return { filters, groupBy, sorts };
}

function buildVersionWorkbook(report, { filters = {}, groupBy = 'combination', sorts = {} } = {}) {
  const view = buildVersionView(report, filters, groupBy, sorts);
  const workbook = XLSX.utils.book_new();
  const addSheet = (name, data, columns) => {
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet['!cols'] = columns.map(width => ({ wch: width }));
    if (data.length > 1 && name !== '导出说明') sheet['!autofilter'] = { ref: sheet['!ref'] };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
    return sheet;
  };
  const filterLabel = key => (filters[key] || []).map(value => view.options[key].find(option => option.value === value)?.label || value).join('、') || '全部';
  addSheet('导出说明', [
    ['项目', '内容'], ['报告', 'DevTracker 工时数据分析报告 - 版本'],
    ['范围', report.dataset.periodLabel || report.dataset.scope],
    ['日期范围', `${report.dataset.dateStart} 至 ${report.dataset.dateEnd}`],
    ['报告生成时间', report.generatedAt], ['导出时间', new Date().toISOString()],
    ['人员', filterLabel('staff')], ['岗位', filterLabel('roles')], ['版本号', filterLabel('versions')],
    ['去重维度', view.groupLabel], ['来源记录数', view.recordCount], ['版本数', view.versionRows.length],
    ['去重汇总行数', view.detailRows.length], ['总工时', view.total],
    ['统计口径', '汇总行按所选维度合并；全部有效来源记录工时累加，不删除跨周期或同标题记录。'],
    ['图表范围', '版本投入显示前16项；工时占比显示前10项及其他。版本汇总表导出全部筛选结果。']
  ], [22, 100]);
  const appendTable = (name, columns, rows) => {
    const sheet = addSheet(name, [columns.map(column => column.label), ...rows.map(row => columns.map(column => column.percent ? Number(row[column.key] || 0) / 100 : row[column.key] ?? ''))],
      columns.map(column => column.key === 'versionName' ? 65 : column.numeric || column.percent ? 16 : 24));
    columns.forEach((column, columnIndex) => {
      if (!column.percent) return;
      rows.forEach((_, index) => { sheet[XLSX.utils.encode_cell({ r: index + 1, c: columnIndex })].z = '0.0%'; });
    });
  };
  appendTable('版本汇总', view.versionColumns, view.versionRows);
  appendTable('人员岗位版本', view.detailColumns, view.detailRows);
  addSheet('筛选来源记录', [
    ['记录ID', '人员', '岗位', '版本号', '需求', '周期', 'AI产品经理', '工时'],
    ...view.records.map(record => [record.id, record.staff, record.roleText, record.version, record.title, record.period, record.pm, record.hours])
  ], [38, 20, 26, 20, 70, 48, 24, 14]);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildVersionWorkbook, validateVersionQuery };
