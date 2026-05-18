-- DevTracker v3.1.0 migration
-- 自动执行任务并通知
SET NAMES utf8mb4;
USE devtracker;

CREATE TABLE IF NOT EXISTS auto_task_rules (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  name             VARCHAR(100) NOT NULL,
  enabled          TINYINT(1)   NOT NULL DEFAULT 1,
  schedule_type    ENUM('monthly','weekly') NOT NULL DEFAULT 'weekly',
  schedule_year    INT NULL,
  month_days       JSON NULL,
  week_days        JSON NULL,
  execute_time     VARCHAR(8) NOT NULL DEFAULT '09:00:00',
  notify_enabled   TINYINT(1) NOT NULL DEFAULT 1,
  dingtalk_webhook TEXT NULL,
  dingtalk_message TEXT NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_enabled (enabled),
  INDEX idx_schedule (schedule_type, execute_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auto_task_run_logs (
  id              CHAR(36) NOT NULL PRIMARY KEY,
  rule_id         CHAR(36) NOT NULL,
  scheduled_at    DATETIME NOT NULL,
  status          ENUM('running','success','skipped','failed','notify_failed') NOT NULL DEFAULT 'running',
  message         TEXT NULL,
  created_task_id CHAR(36) NULL,
  notify_status   ENUM('not_required','success','failed','skipped') NOT NULL DEFAULT 'not_required',
  notify_error    TEXT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_rule_scheduled (rule_id, scheduled_at),
  INDEX idx_rule (rule_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auto_task_messages (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  rule_id    CHAR(36) NULL,
  level      ENUM('success','warning','error','info') NOT NULL DEFAULT 'info',
  action     VARCHAR(50) NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rule (rule_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_staff_phone := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff' AND COLUMN_NAME = 'phone'
);
SET @sql := IF(@has_staff_phone = 0,
  'ALTER TABLE staff ADD COLUMN phone VARCHAR(30) NULL AFTER name',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_auto_task_recipients := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auto_task_rules' AND COLUMN_NAME = 'dingtalk_recipients'
);
SET @sql := IF(@has_auto_task_recipients = 0,
  'ALTER TABLE auto_task_rules ADD COLUMN dingtalk_recipients TEXT NULL AFTER dingtalk_message',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
