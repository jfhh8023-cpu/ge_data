const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DutyCalendarRevision = sequelize.define('duty_calendar_revisions', {
  id:                 { type: DataTypes.CHAR(36), primaryKey: true },
  calendar_year:      { type: DataTypes.INTEGER, allowNull: false },
  revision_no:        { type: DataTypes.INTEGER, allowNull: false },
  effective_from:     { type: DataTypes.DATEONLY, allowNull: false },
  source_title:       { type: DataTypes.STRING(255), allowNull: true },
  source_url:         { type: DataTypes.STRING(600), allowNull: true },
  source_version:     { type: DataTypes.STRING(100), allowNull: true },
  source_verified_at: { type: DataTypes.DATE, allowNull: true },
  official_days:      { type: DataTypes.TEXT('long'), allowNull: true },
  manual_overrides:   { type: DataTypes.TEXT('long'), allowNull: true },
  audit_summary:      { type: DataTypes.TEXT, allowNull: true },
  is_active:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_at:         { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at:         { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  indexes: [
    { name: 'uniq_duty_calendar_year_revision', unique: true, fields: ['calendar_year', 'revision_no'] },
    { fields: ['calendar_year', 'effective_from'] },
    { fields: ['calendar_year', 'is_active'] }
  ]
});

module.exports = DutyCalendarRevision;
