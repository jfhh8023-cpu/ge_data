const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MatchGroup = sequelize.define('match_groups', {
  id:               { type: DataTypes.CHAR(36), primaryKey: true },
  task_id:          { type: DataTypes.CHAR(36), allowNull: false },
  merged_title:     { type: DataTypes.STRING(200) },
  version:          { type: DataTypes.STRING(50) },
  product_managers: { type: DataTypes.JSON },
  frontend:         { type: DataTypes.JSON },
  backend:          { type: DataTypes.JSON },
  test_role:        { type: DataTypes.JSON },
  remark:           { type: DataTypes.TEXT },
  confidence:       { type: DataTypes.DECIMAL(3, 2), defaultValue: 0 },
  status:           { type: DataTypes.ENUM('auto_merged', 'pending_review', 'manual_merged'), defaultValue: 'auto_merged' },
  created_at:       { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = MatchGroup;
