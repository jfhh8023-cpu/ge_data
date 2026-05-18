const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AutoTaskRunLog = sequelize.define('auto_task_run_logs', {
  id:              { type: DataTypes.CHAR(36), primaryKey: true },
  rule_id:         { type: DataTypes.CHAR(36), allowNull: false },
  scheduled_at:    { type: DataTypes.DATE, allowNull: false },
  status:          { type: DataTypes.ENUM('running', 'success', 'skipped', 'failed', 'notify_failed'), allowNull: false, defaultValue: 'running' },
  message:         { type: DataTypes.TEXT },
  created_task_id: { type: DataTypes.CHAR(36) },
  notify_status:   { type: DataTypes.ENUM('not_required', 'success', 'failed', 'skipped'), allowNull: false, defaultValue: 'not_required' },
  notify_error:    { type: DataTypes.TEXT },
  created_at:      { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  indexes: [
    { unique: true, fields: ['rule_id', 'scheduled_at'] },
    { fields: ['rule_id'] },
    { fields: ['created_at'] }
  ]
});

module.exports = AutoTaskRunLog;
