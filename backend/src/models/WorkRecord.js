const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const WorkRecord = sequelize.define('work_records', {
  id:                { type: DataTypes.CHAR(36), primaryKey: true },
  link_id:           { type: DataTypes.CHAR(36) },
  task_id:           { type: DataTypes.CHAR(36), allowNull: false },
  staff_id:          { type: DataTypes.CHAR(36), allowNull: false },
  requirement_title: { type: DataTypes.STRING(200), allowNull: false },
  version:           { type: DataTypes.STRING(50) },
  product_managers:  { type: DataTypes.JSON },
  hours:             { type: DataTypes.DECIMAL(6, 2), allowNull: false },
  created_at:        { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:        { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  /* REQ-16: 子任务停止/开始 */
  is_active:         { type: DataTypes.BOOLEAN, defaultValue: true },
  /* REQ-17: 编辑/提交次数统计 */
  edit_count:        { type: DataTypes.INTEGER, defaultValue: 0 },
  submit_count:      { type: DataTypes.INTEGER, defaultValue: 0 }
});

module.exports = WorkRecord;
