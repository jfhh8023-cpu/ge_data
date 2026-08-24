const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DutyScheduleException = sequelize.define('duty_schedule_exceptions', {
  id:                   { type: DataTypes.CHAR(36), primaryKey: true },
  rule_id:              { type: DataTypes.CHAR(36), allowNull: false },
  calendar_date:        { type: DataTypes.DATEONLY, allowNull: false },
  skip_staff_ids:       { type: DataTypes.TEXT, allowNull: true },
  notice_enabled:       { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  notice_time:          { type: DataTypes.STRING(8), allowNull: false, defaultValue: '09:00:00' },
  notice_message:       { type: DataTypes.TEXT, allowNull: true },
  notice_at_mode:       { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'none' },
  notice_staff_ids:     { type: DataTypes.TEXT, allowNull: true },
  notice_webhook_ids:   { type: DataTypes.TEXT, allowNull: true },
  status:               { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active' },
  revision:             { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  created_at:           { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:           { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  indexes: [
    { name: 'uniq_duty_exception_rule_date', unique: true, fields: ['rule_id', 'calendar_date'] },
    { fields: ['calendar_date', 'notice_enabled', 'status'] },
    { fields: ['rule_id', 'status'] }
  ]
});

module.exports = DutyScheduleException;
