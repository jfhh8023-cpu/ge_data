/**
 * Explicitly confirmed migration for the VOIP engineer role.
 *
 * Local usage:
 *   cd backend
 *   node scripts/migrate_voip_roles.js --confirm-local
 *
 * Production usage (only after a verified production backup):
 *   node scripts/migrate_voip_roles.js --confirm-production --backup-id=<backup timestamp>
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize, Staff, MatchGroup, WorkRecord } = require('../src/models');
const { safeParseJsonArray } = require('../src/utils/parseJson');
const { ensureStaffRoleSchema, ensureMatchGroupRoleSchema } = require('../src/services/RoleService');

const TARGET_NAMES = ['赖香山', '赵鲁鹏'];
const SOURCE_COLUMNS = ['frontend', 'backend', 'test_role'];
const ALL_ROLE_COLUMNS = [...SOURCE_COLUMNS, 'voip'];

function normalizeEntry(item) {
  return {
    staffName: String(item?.staffName || item?.name || '').trim(),
    hours: Number(item?.hours || 0)
  };
}

function roleEntries(group, column) {
  return safeParseJsonArray(group[column]).map(normalizeEntry);
}

function roleHours(groups, names = null) {
  const nameSet = names ? new Set(names) : null;
  return groups.reduce((total, group) => {
    return total + ALL_ROLE_COLUMNS.reduce((columnTotal, column) => {
      return columnTotal + roleEntries(group, column)
        .filter(item => !nameSet || nameSet.has(item.staffName))
        .reduce((sum, item) => sum + item.hours, 0);
    }, 0);
  }, 0);
}

function roleOccurrences(groups, columns, names) {
  const nameSet = new Set(names);
  return groups.reduce((total, group) => {
    return total + columns.reduce((columnTotal, column) => {
      return columnTotal + roleEntries(group, column).filter(item => nameSet.has(item.staffName)).length;
    }, 0);
  }, 0);
}

async function targetWorkRecordSummary(staff) {
  const rows = await WorkRecord.findAll({
    where: { staff_id: { [Op.in]: staff.map(item => item.id) } },
    attributes: ['staff_id', 'hours']
  });
  const byId = new Map(staff.map(item => [item.id, { name: item.name, records: 0, hours: 0 }]));
  for (const row of rows) {
    const item = byId.get(row.staff_id);
    item.records += 1;
    item.hours += Number(row.hours || 0);
  }
  return [...byId.values()].map(item => ({ ...item, hours: Number(item.hours.toFixed(2)) }));
}

async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  const backupArg = process.argv.find(arg => arg.startsWith('--backup-id='));
  const backupId = backupArg ? backupArg.slice('--backup-id='.length).trim() : '';

  if (isProduction) {
    if (!process.argv.includes('--confirm-production')) {
      throw new Error('生产环境缺少执行确认参数：--confirm-production');
    }
    if (!backupId) {
      throw new Error('生产环境必须提供已验证备份标识：--backup-id=<backup timestamp>');
    }
  } else if (!process.argv.includes('--confirm-local')) {
    throw new Error('本地环境缺少执行确认参数：--confirm-local');
  }
  await sequelize.authenticate();
  await ensureStaffRoleSchema();
  await ensureMatchGroupRoleSchema();

  const targetStaff = await Staff.findAll({
    where: { name: { [Op.in]: TARGET_NAMES } },
    order: [['name', 'ASC']]
  });
  const counts = new Map(TARGET_NAMES.map(name => [name, 0]));
  targetStaff.forEach(item => counts.set(item.name, (counts.get(item.name) || 0) + 1));
  const invalidNames = TARGET_NAMES.filter(name => counts.get(name) !== 1);
  if (invalidNames.length) {
    throw new Error(`目标人员必须且只能存在一条记录：${invalidNames.join('、')}`);
  }

  const beforeGroups = await MatchGroup.findAll();
  const beforeAllHours = roleHours(beforeGroups);
  const beforeTargetHours = roleHours(beforeGroups, TARGET_NAMES);
  const beforeSourceOccurrences = roleOccurrences(beforeGroups, SOURCE_COLUMNS, TARGET_NAMES);
  const workRecords = await targetWorkRecordSummary(targetStaff);

  let changedGroups = 0;
  let movedEntries = 0;
  const migrationResult = await sequelize.transaction(async transaction => {
    await Staff.update(
      { role: 'voip' },
      { where: { id: { [Op.in]: targetStaff.map(item => item.id) } }, transaction }
    );

    const groups = await MatchGroup.findAll({ transaction, lock: transaction.LOCK.UPDATE });
    const targetSet = new Set(TARGET_NAMES);
    for (const group of groups) {
      const moved = [];
      const updates = {};
      let changed = false;

      for (const column of SOURCE_COLUMNS) {
        const entries = roleEntries(group, column);
        const keep = [];
        for (const entry of entries) {
          if (targetSet.has(entry.staffName)) {
            moved.push(entry);
            movedEntries += 1;
          } else {
            keep.push(entry);
          }
        }
        if (keep.length !== entries.length) {
          updates[column] = keep;
          changed = true;
        }
      }

      if (moved.length) {
        updates.voip = [...roleEntries(group, 'voip'), ...moved];
        changed = true;
      }
      if (changed) {
        await group.update(updates, { transaction });
        changedGroups += 1;
      }
    }

    const afterStaff = await Staff.findAll({
      where: { name: { [Op.in]: TARGET_NAMES } },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const afterGroups = await MatchGroup.findAll({ transaction });
    const afterAllHours = roleHours(afterGroups);
    const afterTargetHours = roleHours(afterGroups, TARGET_NAMES);
    const afterSourceOccurrences = roleOccurrences(afterGroups, SOURCE_COLUMNS, TARGET_NAMES);
    const afterVoipOccurrences = roleOccurrences(afterGroups, ['voip'], TARGET_NAMES);

    const invalidRoles = afterStaff.filter(item => item.role !== 'voip');
    if (invalidRoles.length) throw new Error('人员角色迁移校验失败');
    if (afterSourceOccurrences !== 0) throw new Error('历史角色列仍存在目标人员');
    if (Math.abs(beforeAllHours - afterAllHours) > 0.001) throw new Error('匹配组总工时不守恒');
    if (Math.abs(beforeTargetHours - afterTargetHours) > 0.001) throw new Error('目标人员工时不守恒');

    return {
      afterStaff,
      afterAllHours,
      afterTargetHours,
      afterSourceOccurrences,
      afterVoipOccurrences
    };
  });

  console.log(JSON.stringify({
    environment: isProduction ? 'production' : 'local',
    backupId: isProduction ? backupId : null,
    targets: migrationResult.afterStaff.map(item => ({ name: item.name, role: item.role })),
    workRecords,
    changedGroups,
    movedEntries,
    beforeSourceOccurrences,
    afterSourceOccurrences: migrationResult.afterSourceOccurrences,
    afterVoipOccurrences: migrationResult.afterVoipOccurrences,
    beforeTargetHours: Number(beforeTargetHours.toFixed(2)),
    afterTargetHours: Number(migrationResult.afterTargetHours.toFixed(2)),
    beforeAllHours: Number(beforeAllHours.toFixed(2)),
    afterAllHours: Number(migrationResult.afterAllHours.toFixed(2))
  }, null, 2));
}

main()
  .catch(error => {
    console.error(`[VOIP migration failed] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
