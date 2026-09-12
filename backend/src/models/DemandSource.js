const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DemandSource = sequelize.define('demand_sources', {
  id: { type: DataTypes.CHAR(36), primaryKey: true },
  name: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  color: { type: DataTypes.STRING(7), allowNull: false, defaultValue: '#165DFF' },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = DemandSource;
