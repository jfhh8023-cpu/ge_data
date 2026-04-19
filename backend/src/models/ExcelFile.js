/**
 * ExcelFile 模型 — 存储导入/导出的 Excel 文件
 * v2.0.0: 导入导出功能新增
 */
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ExcelFile = sequelize.define('excel_files', {
  id:          { type: DataTypes.CHAR(36), primaryKey: true },
  filename:    { type: DataTypes.STRING(255), allowNull: false },
  file_data:   { type: DataTypes.BLOB('long'), allowNull: false },
  file_size:   { type: DataTypes.INTEGER, allowNull: false },
  source_page: { type: DataTypes.STRING(50), allowNull: false },
  task_id:     { type: DataTypes.CHAR(36), allowNull: true },
  staff_id:    { type: DataTypes.CHAR(36), allowNull: true },
  upload_type: { type: DataTypes.ENUM('import', 'export'), allowNull: false },
  created_at:  { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:  { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = ExcelFile;
