const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * QuoteConfig — 某条自动任务规则的名句搭配配置（v3.3.0）
 *  - enabled: 是否开启名句搭配
 *  - no_repeat_count: 近 N 次提取去重（默认 20）
 *  - candidate_queue: 接下来要被使用的句子 id 队列（JSON 数组）
 *  - used_history:    已使用过的句子 id（按时间倒序，JSON 数组）
 */
const QuoteConfig = sequelize.define('quote_configs', {
  id:               { type: DataTypes.CHAR(36), primaryKey: true },
  rule_id:          { type: DataTypes.CHAR(36), allowNull: false, unique: true },
  enabled:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  no_repeat_count:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 20 },
  candidate_queue:  { type: DataTypes.JSON },
  used_history:     { type: DataTypes.JSON },
  created_at:       { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:       { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  timestamps: false
});

module.exports = QuoteConfig;
