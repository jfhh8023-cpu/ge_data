const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * StaffFillLink — 人员系统级专属填写链接
 * 每人唯一一条，token 永久有效，跨任务复用。
 * 同时承载活动状态追踪（editing）和草稿（draft）。
 */
const StaffFillLink = sequelize.define('staff_fill_links', {
  id:               { type: DataTypes.CHAR(36), primaryKey: true },
  staff_id:         { type: DataTypes.CHAR(36), allowNull: false, unique: true },
  token:            { type: DataTypes.STRING(100), allowNull: false, unique: true },
  // 活动状态追踪（供任务活动看板使用）
  editing_task_id:  { type: DataTypes.CHAR(36), allowNull: true },
  editing_at:       { type: DataTypes.DATE, allowNull: true },
  last_action:      { type: DataTypes.STRING(20), allowNull: true },
  last_action_at:   { type: DataTypes.DATE, allowNull: true },
  // 草稿（仅保存当前首选任务的草稿数据）
  draft_data:       { type: DataTypes.JSON, allowNull: true },
  draft_task_id:    { type: DataTypes.CHAR(36), allowNull: true },
  draft_saved_at:   { type: DataTypes.DATE, allowNull: true },
  created_at:       { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:       { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = StaffFillLink;
