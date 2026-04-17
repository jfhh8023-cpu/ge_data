const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LinkPermission = sequelize.define('link_permissions', {
  id:         { type: DataTypes.CHAR(36), primaryKey: true },
  link_id:    { type: DataTypes.CHAR(36), allowNull: false },
  resource:   { type: DataTypes.STRING(100), allowNull: false },
  can_view:   { type: DataTypes.BOOLEAN, defaultValue: false },
  can_create: { type: DataTypes.BOOLEAN, defaultValue: false },
  can_update: { type: DataTypes.BOOLEAN, defaultValue: false },
  can_delete: { type: DataTypes.BOOLEAN, defaultValue: false }
}, {
  timestamps: false
});

module.exports = LinkPermission;
