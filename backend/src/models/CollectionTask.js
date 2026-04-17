const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CollectionTask = sequelize.define('collection_tasks', {
  id:             { type: DataTypes.CHAR(36), primaryKey: true },
  title:          { type: DataTypes.STRING(200), allowNull: false },
  time_dimension: { type: DataTypes.ENUM('day','week','half_month','month','quarter','half_year','year'), defaultValue: 'week' },
  start_date:     { type: DataTypes.DATEONLY, allowNull: false },
  end_date:       { type: DataTypes.DATEONLY, allowNull: false },
  week_number:    { type: DataTypes.INTEGER },
  year:           { type: DataTypes.INTEGER, allowNull: false },
  status:         { type: DataTypes.ENUM('draft','active','closed'), defaultValue: 'active' },
  created_at:     { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:     { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = CollectionTask;
