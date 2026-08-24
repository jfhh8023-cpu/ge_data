const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DutyHolidaySnapshot = sequelize.define('duty_holiday_snapshots', {
  calendar_year:  { type: DataTypes.INTEGER, primaryKey: true },
  source_title:   { type: DataTypes.STRING(255), allowNull: true },
  source_document_no: { type: DataTypes.STRING(100), allowNull: true },
  source_url:     { type: DataTypes.STRING(600), allowNull: true },
  published_at:   { type: DataTypes.DATEONLY, allowNull: true },
  verified_at:    { type: DataTypes.DATE, allowNull: true },
  source_version: { type: DataTypes.STRING(100), allowNull: true },
  checksum:       { type: DataTypes.STRING(64), allowNull: true },
  official_days:  { type: DataTypes.TEXT('long'), allowNull: true },
  sync_status:    { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
  last_checked_at:{ type: DataTypes.DATE, allowNull: true },
  next_retry_at:  { type: DataTypes.DATE, allowNull: true },
  error_message:  { type: DataTypes.STRING(1000), allowNull: true },
  created_at:     { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:     { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  indexes: [
    { fields: ['sync_status', 'next_retry_at'] },
    { fields: ['verified_at'] }
  ]
});

module.exports = DutyHolidaySnapshot;
