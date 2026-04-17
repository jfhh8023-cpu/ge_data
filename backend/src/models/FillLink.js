const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FillLink = sequelize.define('fill_links', {
  id:           { type: DataTypes.CHAR(36), primaryKey: true },
  task_id:      { type: DataTypes.CHAR(36), allowNull: false },
  staff_id:     { type: DataTypes.CHAR(36), allowNull: false },
  token:        { type: DataTypes.STRING(100), unique: true, allowNull: false },
  is_submitted:   { type: DataTypes.BOOLEAN, defaultValue: false },
  /* REQ-17: 实时编辑通知 */
  editing_at:     { type: DataTypes.DATE, allowNull: true },
  last_action:    { type: DataTypes.STRING(20), allowNull: true },
  last_action_at: { type: DataTypes.DATE, allowNull: true },
  /* v1.3.0: 草稿持久化 */
  draft_data:     { type: DataTypes.JSON, allowNull: true },
  draft_saved_at: { type: DataTypes.DATE, allowNull: true },
  created_at:     { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = FillLink;
