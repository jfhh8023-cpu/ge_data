const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StaffRole = sequelize.define('staff_roles', {
  key: { type: DataTypes.STRING(50), primaryKey: true },
  name: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  short_name: { type: DataTypes.STRING(12), allowNull: false },
  color: { type: DataTypes.STRING(7), allowNull: false },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = StaffRole;
