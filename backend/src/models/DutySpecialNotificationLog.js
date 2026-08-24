const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DutySpecialNotificationLog = sequelize.define('duty_special_notification_logs', {
  id:            { type: DataTypes.CHAR(36), primaryKey: true },
  exception_id:  { type: DataTypes.CHAR(36), allowNull: false },
  rule_id:       { type: DataTypes.CHAR(36), allowNull: false },
  scheduled_at:  { type: DataTypes.DATE, allowNull: false },
  status:        { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'running' },
  notify_error:  { type: DataTypes.TEXT, allowNull: true },
  created_at:    { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:    { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  indexes: [
    { name: 'uniq_duty_special_notice_schedule', unique: true, fields: ['exception_id', 'scheduled_at'] },
    { fields: ['rule_id', 'created_at'] },
    { fields: ['status', 'updated_at'] }
  ]
});

module.exports = DutySpecialNotificationLog;
