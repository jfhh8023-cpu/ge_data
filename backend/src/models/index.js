/**
 * 模型注册中心 & 关联定义
 * 单例模式：所有模型从此处统一导出
 */
const sequelize = require('../config/database');
const CollectionTask = require('./CollectionTask');
const Staff = require('./Staff');
const FillLink = require('./FillLink');
const WorkRecord = require('./WorkRecord');
const MatchGroup = require('./MatchGroup');
const AccessLink = require('./AccessLink');
const LinkPermission = require('./LinkPermission');
const StaffFillLink = require('./StaffFillLink');

/* ========== 关联定义 ========== */

// Task 1:N FillLink
CollectionTask.hasMany(FillLink, { foreignKey: 'task_id', as: 'links' });
FillLink.belongsTo(CollectionTask, { foreignKey: 'task_id', as: 'task' });

// Staff 1:N FillLink
Staff.hasMany(FillLink, { foreignKey: 'staff_id', as: 'links' });
FillLink.belongsTo(Staff, { foreignKey: 'staff_id', as: 'staff' });

// Task 1:N WorkRecord
CollectionTask.hasMany(WorkRecord, { foreignKey: 'task_id', as: 'records' });
WorkRecord.belongsTo(CollectionTask, { foreignKey: 'task_id', as: 'task' });

// Staff 1:N WorkRecord
Staff.hasMany(WorkRecord, { foreignKey: 'staff_id', as: 'records' });
WorkRecord.belongsTo(Staff, { foreignKey: 'staff_id', as: 'staff' });

// Task 1:N MatchGroup
CollectionTask.hasMany(MatchGroup, { foreignKey: 'task_id', as: 'matchGroups' });
MatchGroup.belongsTo(CollectionTask, { foreignKey: 'task_id', as: 'task' });

// AccessLink 1:N LinkPermission（REQ-21）
AccessLink.hasMany(LinkPermission, { foreignKey: 'link_id', as: 'permissions' });
LinkPermission.belongsTo(AccessLink, { foreignKey: 'link_id', as: 'accessLink' });

// Staff 1:1 StaffFillLink（v1.6.0 系统级链接）
Staff.hasOne(StaffFillLink, { foreignKey: 'staff_id', as: 'fillLink' });
StaffFillLink.belongsTo(Staff, { foreignKey: 'staff_id', as: 'staff' });

module.exports = {
  sequelize,
  CollectionTask,
  Staff,
  FillLink,
  WorkRecord,
  MatchGroup,
  AccessLink,
  LinkPermission,
  StaffFillLink
};
