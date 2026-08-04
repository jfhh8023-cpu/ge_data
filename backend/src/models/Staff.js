const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Staff = sequelize.define('staff', {
  id:        { type: DataTypes.CHAR(36), primaryKey: true },
  name:      { type: DataTypes.STRING(50), allowNull: false },
  phone:     { type: DataTypes.STRING(30), allowNull: true },
  role:      { type: DataTypes.ENUM('ai_dev', 'voip', 'ai_quality', 'frontend', 'backend', 'test'), allowNull: false },
  employment_status: {
    type: DataTypes.ENUM('active', 'resigned', 'retained', 'long_leave'),
    defaultValue: 'active'
  },
  status_changed_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  sort_order:{ type: DataTypes.INTEGER, defaultValue: 0 },
  created_at:{ type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = Staff;
