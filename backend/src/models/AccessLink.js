const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AccessLink = sequelize.define('access_links', {
  id:         { type: DataTypes.CHAR(36), primaryKey: true },
  name:       { type: DataTypes.STRING(100), allowNull: false },
  token:      { type: DataTypes.STRING(200), unique: true, allowNull: false },
  is_active:  { type: DataTypes.BOOLEAN, defaultValue: true },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = AccessLink;
