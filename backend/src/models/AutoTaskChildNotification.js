const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AutoTaskChildNotification = sequelize.define('auto_task_child_notifications', {
  id:                      { type: DataTypes.CHAR(36), primaryKey: true },
  rule_id:                 { type: DataTypes.CHAR(36), allowNull: false },
  enabled:                 { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  schedule_type:           { type: DataTypes.ENUM('monthly', 'weekly'), allowNull: false, defaultValue: 'weekly' },
  month_days:              { type: DataTypes.JSON },
  week_days:               { type: DataTypes.JSON },
  execute_time:            { type: DataTypes.STRING(8), allowNull: false, defaultValue: '09:00:00' },
  message:                 { type: DataTypes.TEXT, allowNull: false },
  webhook_target_mode:     { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'all' },
  webhook_ids:             { type: DataTypes.TEXT },
  activation_token:        { type: DataTypes.CHAR(36) },
  activation_scheduled_at: { type: DataTypes.DATE },
  activated_at:            { type: DataTypes.DATE },
  status:                  { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'inactive' },
  last_scheduled_at:       { type: DataTypes.DATE },
  last_sent_at:            { type: DataTypes.DATE },
  last_error:              { type: DataTypes.TEXT },
  created_at:              { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:              { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  indexes: [
    { fields: ['rule_id'] },
    { fields: ['status'] },
    { fields: ['activation_token'] }
  ]
});

module.exports = AutoTaskChildNotification;
