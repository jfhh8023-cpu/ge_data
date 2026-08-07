const assert = require('assert');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Op, fn, col } = require('sequelize');
const {
  sequelize,
  CollectionTask,
  Staff,
  StaffFillLink,
  StaffRole,
  StaffStatusHistory,
  WorkRecord,
  MatchGroup,
  ProductManager
} = require('../src/models');
const { safeParseJsonArray } = require('../src/utils/parseJson');

const BASE_URL = process.env.DEVTRACKER_BASE_URL || 'http://127.0.0.1:3001';
const OUTPUT_PATH = path.resolve(
  __dirname,
  '../../docs/@development/configurable_research_roles_20260807/evidence/api-results.json'
);

function numeric(value) {
  return Number(value || 0);
}

async function snapshot() {
  const [staff, records, groups, roles, totalHours] = await Promise.all([
    Staff.count(),
    WorkRecord.count(),
    MatchGroup.count(),
    StaffRole.count(),
    WorkRecord.sum('hours')
  ]);
  return { staff, records, groups, roles, totalHours: numeric(totalHours) };
}

async function requestJson(method, route, body, expectedStatus = 200) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  assert.strictEqual(
    response.status,
    expectedStatus,
    `${method} ${route} expected ${expectedStatus}, got ${response.status}: ${text}`
  );
  return payload;
}

async function requestWorkbook(route) {
  const response = await fetch(`${BASE_URL}${route}`);
  assert.strictEqual(response.status, 200, `GET ${route} expected 200, got ${response.status}`);
  return XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
}

function workbookValues(workbook) {
  return workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], {
    header: 1,
    defval: ''
  }).flat()).map(value => String(value));
}

async function findTestContext() {
  const task = await CollectionTask.findOne({
    where: {
      year: 2026,
      end_date: { [Op.between]: ['2026-07-01', '2026-09-30'] }
    },
    order: [['end_date', 'DESC']]
  });
  assert(task, '缺少 2026 Q3 任务，无法执行统计链路验证');

  const taskRecords = await WorkRecord.findAll({ where: { task_id: task.id } });
  const candidateNames = [...new Set(taskRecords.flatMap(record => safeParseJsonArray(record.product_managers)))];
  let pm = candidateNames.length
    ? await ProductManager.findOne({ where: { name: { [Op.in]: candidateNames }, employment_status: { [Op.ne]: 'resigned' } } })
    : null;
  if (!pm) pm = await ProductManager.findOne({ where: { employment_status: { [Op.ne]: 'resigned' } }, order: [['sort_order', 'ASC']] });
  assert(pm, '缺少可用于测试的在职 AI 产品经理');
  return { task, pm };
}

async function cleanup({ marker, roleKey, staffId, recordId, groupId }) {
  if (recordId) await WorkRecord.destroy({ where: { id: recordId } });
  await WorkRecord.destroy({ where: { requirement_title: marker } });
  if (groupId) await MatchGroup.destroy({ where: { id: groupId } });
  await MatchGroup.destroy({ where: { merged_title: marker } });
  if (staffId) {
    await StaffFillLink.destroy({ where: { staff_id: staffId } });
    await StaffStatusHistory.destroy({ where: { staff_id: staffId } });
    await Staff.destroy({ where: { id: staffId } });
  }
  if (roleKey) await StaffRole.destroy({ where: { key: roleKey } });
}

async function main() {
  const suffix = String(Date.now()).slice(-6);
  const marker = `角色验收_${suffix}`;
  const staffName = `嵌入验收${suffix}`;
  const phone = `19999${suffix}`;
  const roleName = `验收动态角色${suffix}`;
  const roleShortName = `验收${suffix.slice(-3)}`;
  const state = { marker, roleKey: null, staffId: null, recordId: null, groupId: null };
  const baseline = await snapshot();
  const results = { startedAt: new Date().toISOString(), baseline, checks: [] };

  try {
    const defaultRoles = await requestJson('GET', '/api/roles');
    assert(defaultRoles.data.some(role => role.key === 'embedded' && role.name === '嵌入式软件工程师'));
    results.checks.push({ id: 'ROLE-DEFAULT', status: 'PASS', roles: defaultRoles.data.map(role => role.name) });

    const invalid = await requestJson('POST', '/api/staff', {
      name: `无效${suffix}`,
      phone,
      role: 'missing_role'
    }, 400);
    assert.strictEqual(invalid.message, '角色无效');
    results.checks.push({ id: 'ROLE-VALIDATION', status: 'PASS', message: invalid.message });

    const createdRole = await requestJson('POST', '/api/roles', {
      name: `验收角色${suffix}`,
      short_name: roleShortName,
      color: '#7C3AED'
    }, 201);
    state.roleKey = createdRole.data.key;
    const updatedRole = await requestJson('PUT', `/api/roles/${state.roleKey}`, {
      name: roleName,
      short_name: roleShortName,
      color: '#0F766E'
    });
    assert.strictEqual(updatedRole.data.name, roleName);
    results.checks.push({ id: 'ROLE-CRUD', status: 'PASS', key: state.roleKey, name: roleName });

    const createdStaff = await requestJson('POST', '/api/staff', {
      name: staffName,
      phone,
      role: state.roleKey
    });
    state.staffId = createdStaff.data.id;
    assert.strictEqual(createdStaff.data.role_label, roleName);

    const { task, pm } = await findTestContext();
    await StaffStatusHistory.update(
      { started_at: task.start_date },
      { where: { staff_id: state.staffId, status: 'active' } }
    );
    await Staff.update({ status_changed_at: task.start_date }, { where: { id: state.staffId } });

    const filters = new URLSearchParams({ name: staffName, phone, role: state.roleKey, status: 'active' });
    const filteredStaff = await requestJson('GET', `/api/staff?${filters}`);
    assert.strictEqual(filteredStaff.data.length, 1);
    assert.strictEqual(filteredStaff.data[0].id, state.staffId);
    results.checks.push({ id: 'STAFF-FILTERS', status: 'PASS', count: filteredStaff.data.length });

    const createdRecord = await requestJson('POST', '/api/records', {
      task_id: task.id,
      staff_id: state.staffId,
      requirement_title: marker,
      version: `V-${suffix}`,
      product_managers: [pm.name],
      hours: 1.25
    });
    state.recordId = createdRecord.data.id;

    const stats = await requestJson('GET', '/api/stats?year=2026&quarter=Q3');
    const roleDefinition = stats.data.roleDefinitions.find(role => role.key === state.roleKey);
    assert(roleDefinition && roleDefinition.name === roleName);
    assert.strictEqual(numeric(stats.data.roleSummary[state.roleKey]), 1.25);
    const pmRow = stats.data.pmDistribution.find(item => item.name === pm.name);
    assert(pmRow && numeric(pmRow[state.roleKey]) >= 1.25);
    results.checks.push({
      id: 'DYNAMIC-STATS',
      status: 'PASS',
      roleHours: numeric(stats.data.roleSummary[state.roleKey]),
      pmRoleHours: numeric(pmRow[state.roleKey])
    });

    const imported = await requestJson('POST', '/api/report/import', {
      task_id: task.id,
      rows: [{
        merged_title: marker,
        version: `V-${suffix}`,
        product_managers: [pm.name],
        role_buckets: { [state.roleKey]: [{ staffName, hours: 2.5 }] },
        remark: '动态角色导入验收'
      }]
    });
    assert(imported.message.includes('新增 1 条'));
    const report = await requestJson('GET', `/api/report?taskId=${task.id}`);
    const importedRow = report.data.find(item => item.merged_title === marker);
    assert(importedRow, '导入后的需求报表行不存在');
    state.groupId = importedRow.id;
    assert.deepStrictEqual(importedRow.product_managers, [pm.name]);
    assert.strictEqual(numeric(importedRow.role_buckets[state.roleKey][0].hours), 2.5);

    const editedRow = await requestJson('PUT', `/api/report/${state.groupId}`, {
      merged_title: marker,
      version: `V-${suffix}-EDIT`,
      product_managers: [pm.name],
      role_buckets: { embedded: [{ staffName: '嵌入式待分配', hours: 3.5 }] },
      remark: '整行自动保存验收'
    });
    assert.strictEqual(editedRow.data.version, `V-${suffix}-EDIT`);
    assert.strictEqual(numeric(editedRow.data.role_buckets.embedded[0].hours), 3.5);
    results.checks.push({ id: 'REPORT-IMPORT-EDIT', status: 'PASS', productManagers: importedRow.product_managers });

    const template = await requestWorkbook('/api/excel/template/report');
    const templateValues = workbookValues(template);
    assert(templateValues.includes(`${roleName}姓名`));
    assert(templateValues.includes('嵌入式软件工程师姓名'));

    const backup = await requestWorkbook('/api/settings/report-backup?format=xlsx');
    const backupValues = workbookValues(backup);
    assert(backupValues.includes(roleName));
    assert(backupValues.includes('嵌入式软件工程师'));
    results.checks.push({ id: 'DYNAMIC-EXCEL', status: 'PASS', templateRole: roleName, sheets: backup.SheetNames.length });
  } finally {
    await cleanup(state);
    const afterCleanup = await snapshot();
    results.afterCleanup = afterCleanup;
    results.dataConserved = JSON.stringify(afterCleanup) === JSON.stringify(baseline);
    results.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    await sequelize.close();
  }

  assert(results.dataConserved, `测试清理后数据未回到基线: ${JSON.stringify({ baseline, afterCleanup: results.afterCleanup })}`);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
