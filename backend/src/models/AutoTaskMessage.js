const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AutoTaskMessage = sequelize.define('auto_task_messages', {
  id: {
    type: DataTypes.CHAR(36),
    primaryKey: true
  },
  rule_id: {
    type: DataTypes.CHAR(36),
    allowNull: true
  },
  level: {
    type: DataTypes.ENUM('success', 'warning', 'error', 'info'),
    allowNull: false,
    defaultValue: 'info'
  },
  action: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'info'
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'auto_task_messages',
  timestamps: false,
  indexes: [
    { fields: ['rule_id'] },
    { fields: ['created_at'] }
  ]
});

module.exports = AutoTaskMessage;
