// Serialized into the standalone report as well as used by the Excel exporter.
function buildVersionView(report, filters = {}, groupBy = 'combination', sorts = {}) {
  const round = value => Number(Number(value || 0).toFixed(1));
  const text = value => String(value ?? '').trim();
  const compare = (a, b) => text(a).localeCompare(text(b), 'zh-CN', { numeric: true });
  const selected = key => new Set(Array.isArray(filters[key]) ? filters[key].map(text) : []);
  const staffFilter = selected('staff');
  const roleFilter = selected('roles');
  const versionFilter = selected('versions');
  const roles = report.roleDefinitions || [];
  const roleNames = new Map(roles.map(role => [role.key, role.name]));
  const source = (report.records || []).map(record => ({
    ...record,
    staffKey: text(record.staffId || record.staff),
    staff: text(record.staff),
    version: text(record.version) || '未填版本',
    roleText: roleNames.get(record.role) || record.roleText || record.role,
    hours: Number(record.rawHours ?? record.hours ?? 0)
  }));
  const people = new Map();
  const versions = new Set();
  for (const record of source) {
    people.set(record.staffKey, record.staff);
    versions.add(record.version);
  }
  const records = source.filter(record =>
    (!staffFilter.size || staffFilter.has(record.staffKey)) &&
    (!roleFilter.size || roleFilter.has(record.role)) &&
    (!versionFilter.size || versionFilter.has(record.version))
  );
  const total = records.reduce((sum, record) => sum + record.hours, 0);
  const versionGroups = new Map();
  const detailGroups = new Map();
  const groupLabels = { staff: '按人员', role: '按岗位', version: '按版本号', combination: '人员 + 岗位 + 版本号' };
  const detailDimensions = { staff: ['staff'], role: ['roleText'], version: ['version'], combination: ['staff', 'roleText', 'version'] };
  const dimensions = detailDimensions[groupBy] || detailDimensions.combination;
  const newGroup = record => ({
    staff: record.staff, roleText: record.roleText, version: record.version,
    total: 0, records: 0, requirements: new Set(), tasks: new Set(), people: new Set(),
    roleHours: Object.fromEntries(roles.map(role => [role.key, 0])), titles: new Map()
  });
  const accumulate = (group, record) => {
    const requirementKey = JSON.stringify([record.taskId, record.title, record.version]);
    group.total += record.hours;
    group.records += 1;
    group.requirements.add(requirementKey);
    group.tasks.add(record.taskId);
    group.people.add(record.staffKey);
    group.roleHours[record.role] = (group.roleHours[record.role] || 0) + record.hours;
    const requirement = group.titles.get(requirementKey) || { title: record.title, hours: 0 };
    requirement.hours += record.hours;
    group.titles.set(requirementKey, requirement);
  };
  for (const record of records) {
    if (!versionGroups.has(record.version)) versionGroups.set(record.version, newGroup(record));
    accumulate(versionGroups.get(record.version), record);
    const key = JSON.stringify(dimensions.map(dimension => dimension === 'staff' ? record.staffKey : dimension === 'roleText' ? record.role : record[dimension]));
    if (!detailGroups.has(key)) detailGroups.set(key, newGroup(record));
    accumulate(detailGroups.get(key), record);
  }
  const finish = group => ({
    staff: group.staff, roleText: group.roleText, version: group.version,
    total: round(group.total), records: group.records,
    requirementCount: group.requirements.size, taskCount: group.tasks.size, staffCount: group.people.size,
    share: total ? round(group.total * 100 / total) : 0,
    ...Object.fromEntries(roles.map(role => [role.key, round(group.roleHours[role.key])]))
  });
  const versionNames = new Map((report.versions || []).map(row => [row.name, row.versionName]));
  const versionRows = [...versionGroups].map(([name, group]) => ({
    ...finish(group), name, versionName: versionNames.get(name) || '——'
  })).sort((a, b) => b.total - a.total || compare(a.name, b.name));
  const detailRows = [...detailGroups.values()].map(finish)
    .sort((a, b) => b.total - a.total || compare(a.staff, b.staff) || compare(a.version, b.version));
  const versionColumns = [
    { key: 'name', label: '版本号' }, { key: 'versionName', label: '版本名称' },
    { key: 'total', label: '总工时', numeric: true }, { key: 'share', label: '占比', percent: true },
    ...roles.map(role => ({ key: role.key, label: role.name, numeric: true })),
    { key: 'records', label: '记录数', numeric: true }, { key: 'requirementCount', label: '需求数', numeric: true },
    { key: 'staffCount', label: '人员数', numeric: true }
  ];
  const dimensionLabels = { staff: '人员', roleText: '岗位', version: '版本号' };
  const detailColumns = [
    ...dimensions.map(key => ({ key, label: dimensionLabels[key] })),
    { key: 'total', label: '总工时', numeric: true }, { key: 'share', label: '占比', percent: true },
    { key: 'records', label: '来源记录数', numeric: true }, { key: 'requirementCount', label: '需求数', numeric: true },
    { key: 'taskCount', label: '覆盖周期数', numeric: true }
  ];
  const sortRows = (rows, columns, sort) => {
    const column = columns.find(item => item.key === sort?.key);
    if (!column || !['asc', 'desc'].includes(sort.direction)) return;
    rows.sort((a, b) => (column.numeric || column.percent ? Number(a[column.key]) - Number(b[column.key]) : compare(a[column.key], b[column.key])) * (sort.direction === 'asc' ? 1 : -1));
  };
  const chartRows = [...versionRows];
  sortRows(versionRows, versionColumns, sorts.versions);
  sortRows(detailRows, detailColumns, sorts.details);
  const nameCounts = new Map();
  for (const name of people.values()) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  return {
    options: {
      staff: [...people].map(([value, name]) => ({ value, label: nameCounts.get(name) > 1 ? `${name} (${value.slice(0, 8)})` : name })).sort((a, b) => compare(a.label, b.label)),
      roles: roles.map(role => ({ value: role.key, label: role.name })),
      versions: [...versions].sort(compare).map(value => ({ value, label: value }))
    },
    groupLabel: groupLabels[groupBy] || groupLabels.combination,
    total: round(total), recordCount: records.length,
    versionRows, detailRows, versionColumns, detailColumns, records, chartRows
  };
}

module.exports = { buildVersionView };
