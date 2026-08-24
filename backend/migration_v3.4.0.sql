-- DevTracker v3.4.0: holiday calendar, duty exceptions, swaps and special notices.
-- Additive migration only. Existing business tables and duty_config are unchanged.

CREATE TABLE IF NOT EXISTS duty_holiday_snapshots (
  calendar_year INT NOT NULL PRIMARY KEY,
  source_title VARCHAR(255) NULL,
  source_document_no VARCHAR(100) NULL,
  source_url VARCHAR(600) NULL,
  published_at DATE NULL,
  verified_at DATETIME NULL,
  source_version VARCHAR(100) NULL,
  checksum VARCHAR(64) NULL,
  official_days LONGTEXT NULL,
  sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  last_checked_at DATETIME NULL,
  next_retry_at DATETIME NULL,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY duty_holiday_sync_retry (sync_status, next_retry_at),
  KEY duty_holiday_verified (verified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS duty_calendar_revisions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  calendar_year INT NOT NULL,
  revision_no INT NOT NULL,
  effective_from DATE NOT NULL,
  source_title VARCHAR(255) NULL,
  source_url VARCHAR(600) NULL,
  source_version VARCHAR(100) NULL,
  source_verified_at DATETIME NULL,
  official_days LONGTEXT NULL,
  manual_overrides LONGTEXT NULL,
  audit_summary TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_duty_calendar_year_revision (calendar_year, revision_no),
  KEY duty_calendar_year_effective (calendar_year, effective_from),
  KEY duty_calendar_year_active (calendar_year, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS duty_schedule_exceptions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  rule_id CHAR(36) NOT NULL,
  calendar_date DATE NOT NULL,
  skip_staff_ids TEXT NULL,
  notice_enabled TINYINT(1) NOT NULL DEFAULT 0,
  notice_time VARCHAR(8) NOT NULL DEFAULT '09:00:00',
  notice_message TEXT NULL,
  notice_at_mode VARCHAR(20) NOT NULL DEFAULT 'none',
  notice_staff_ids TEXT NULL,
  notice_webhook_ids TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  revision INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_duty_exception_rule_date (rule_id, calendar_date),
  KEY duty_exception_notice_date (calendar_date, notice_enabled, status),
  KEY duty_exception_rule_status (rule_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS duty_schedule_swaps (
  id CHAR(36) NOT NULL PRIMARY KEY,
  rule_id CHAR(36) NOT NULL,
  date_a DATE NOT NULL,
  date_b DATE NOT NULL,
  staff_a_id CHAR(36) NOT NULL,
  staff_b_id CHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  revision INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_duty_swap_rule_dates_people (rule_id, date_a, date_b, staff_a_id, staff_b_id),
  KEY duty_swap_rule_date_a (rule_id, date_a, status),
  KEY duty_swap_rule_date_b (rule_id, date_b, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS duty_special_notification_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  exception_id CHAR(36) NOT NULL,
  rule_id CHAR(36) NOT NULL,
  scheduled_at DATETIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  notify_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_duty_special_notice_schedule (exception_id, scheduled_at),
  KEY duty_special_notice_rule_created (rule_id, created_at),
  KEY duty_special_notice_status_updated (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
