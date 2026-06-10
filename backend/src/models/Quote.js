const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Quote — 名句库（v3.3.0）
 * 一条记录 = 一句（以中文句号为天然分隔的单句）
 */
const Quote = sequelize.define('quotes', {
  id:         { type: DataTypes.CHAR(36), primaryKey: true },
  content:    { type: DataTypes.TEXT, allowNull: false },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  timestamps: false,
  indexes: [{ name: 'idx_quotes_sort', fields: ['sort_order'] }]
});

module.exports = Quote;
