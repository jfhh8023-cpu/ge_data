const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AutoTaskRule = sequelize.define('auto_task_rules', {
  id:               { type: DataTypes.CHAR(36), primaryKey: true },
  name:             { type: DataTypes.STRING(100), allowNull: false },
  enabled:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  action_mode:      { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'run_and_notify' },
  schedule_type:    { type: DataTypes.ENUM('monthly', 'weekly'), allowNull: false, defaultValue: 'weekly' },
  schedule_year:    { type: DataTypes.INTEGER },
  month_days:       { type: DataTypes.JSON },
  week_days:        { type: DataTypes.JSON },
  execute_time:     { type: DataTypes.STRING(8), allowNull: false, defaultValue: '09:00:00' },
  notify_enabled:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  dingtalk_webhook: { type: DataTypes.TEXT },
  dingtalk_message: { type: DataTypes.TEXT },
  dingtalk_recipients: { type: DataTypes.TEXT },
  created_at:       { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:       { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = AutoTaskRule;
