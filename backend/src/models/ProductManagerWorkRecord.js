const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/** AI 产品经理独立工时表，避免与研发工时字段混用。 */
const ProductManagerWorkRecord = sequelize.define('product_manager_work_records', {
  id:                { type: DataTypes.CHAR(36), primaryKey: true },
  link_id:           { type: DataTypes.CHAR(36) },
  task_id:           { type: DataTypes.CHAR(36), allowNull: false },
  staff_id:          { type: DataTypes.CHAR(36), allowNull: false },
  requirement_title: { type: DataTypes.STRING(200), allowNull: false },
  version:           { type: DataTypes.STRING(50) },
  demand_sources:    { type: DataTypes.JSON, allowNull: false },
  // 需求方维度展示权重，百分比合计 100；历史空值按需求方数量均分。
  demand_source_weights: { type: DataTypes.JSON, allowNull: true },
  hours:             { type: DataTypes.DECIMAL(6, 2), allowNull: false },
  // 历史数据允许为空；新记录由接口强制 0-100。
  delivery_progress: { type: DataTypes.INTEGER, allowNull: true },
  created_at:        { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:        { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  is_active:         { type: DataTypes.BOOLEAN, defaultValue: true },
  edit_count:        { type: DataTypes.INTEGER, defaultValue: 0 },
  submit_count:      { type: DataTypes.INTEGER, defaultValue: 0 }
});

module.exports = ProductManagerWorkRecord;
