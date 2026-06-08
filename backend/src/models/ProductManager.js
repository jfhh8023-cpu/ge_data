/**
 * ProductManager 模型 — v3.2.0
 * 产品经理管理（独立于 staff 表）
 */
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProductManager = sequelize.define('product_managers', {
  id:         { type: DataTypes.CHAR(36), primaryKey: true },
  name:       { type: DataTypes.STRING(50), allowNull: false, unique: true },
  token:      { type: DataTypes.STRING(100), unique: true },
  is_active:  { type: DataTypes.BOOLEAN, defaultValue: true },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = ProductManager;
