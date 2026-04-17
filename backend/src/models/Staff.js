const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Staff = sequelize.define('staff', {
  id:        { type: DataTypes.CHAR(36), primaryKey: true },
  name:      { type: DataTypes.STRING(50), allowNull: false },
  role:      { type: DataTypes.ENUM('frontend', 'backend', 'test'), allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  created_at:{ type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = Staff;
