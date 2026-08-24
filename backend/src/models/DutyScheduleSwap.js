const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DutyScheduleSwap = sequelize.define('duty_schedule_swaps', {
  id:         { type: DataTypes.CHAR(36), primaryKey: true },
  rule_id:    { type: DataTypes.CHAR(36), allowNull: false },
  date_a:     { type: DataTypes.DATEONLY, allowNull: false },
  date_b:     { type: DataTypes.DATEONLY, allowNull: false },
  staff_a_id: { type: DataTypes.CHAR(36), allowNull: false },
  staff_b_id: { type: DataTypes.CHAR(36), allowNull: false },
  status:     { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active' },
  revision:   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  indexes: [
    { name: 'uniq_duty_swap_rule_dates_people', unique: true, fields: ['rule_id', 'date_a', 'date_b', 'staff_a_id', 'staff_b_id'] },
    { fields: ['rule_id', 'date_a', 'status'] },
    { fields: ['rule_id', 'date_b', 'status'] }
  ]
});

module.exports = DutyScheduleSwap;
