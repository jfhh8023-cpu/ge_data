const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StaffStatusHistory = sequelize.define('staff_status_history', {
  id:         { type: DataTypes.CHAR(36), primaryKey: true },
  staff_id:   { type: DataTypes.CHAR(36), allowNull: false },
  status:     {
    type: DataTypes.ENUM('active', 'resigned', 'retained', 'long_leave'),
    allowNull: false,
    defaultValue: 'active'
  },
  started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  ended_at:   { type: DataTypes.DATE, allowNull: true },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = StaffStatusHistory;
