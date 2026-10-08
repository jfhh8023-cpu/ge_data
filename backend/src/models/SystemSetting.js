const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * SystemSetting — 全局键值配置（REQ-074）
 *  - setting_key:   配置键（主键）
 *  - setting_value: JSON 字符串
 */
const SystemSetting = sequelize.define('system_settings', {
  setting_key:   { type: DataTypes.STRING(64), primaryKey: true },
  setting_value: { type: DataTypes.TEXT('long') },
  updated_at:    { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  timestamps: false
});

module.exports = SystemSetting;
