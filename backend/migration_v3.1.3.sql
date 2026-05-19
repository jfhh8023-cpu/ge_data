-- DevTracker v3.1.3 migration
-- 自动任务类型与自动值班通知配置兼容迁移
SET NAMES utf8mb4;
USE devtracker;

SET @has_auto_task_type := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auto_task_rules' AND COLUMN_NAME = 'task_type'
);
SET @sql := IF(@has_auto_task_type = 0,
  'ALTER TABLE auto_task_rules ADD COLUMN task_type VARCHAR(40) NOT NULL DEFAULT ''task_create_notify'' AFTER enabled',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_auto_task_log_event_type := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auto_task_run_logs' AND COLUMN_NAME = 'event_type'
);
SET @sql := IF(@has_auto_task_log_event_type = 0,
  'ALTER TABLE auto_task_run_logs ADD COLUMN event_type VARCHAR(30) NOT NULL DEFAULT ''auto_task'' AFTER scheduled_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_old_log_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auto_task_run_logs' AND INDEX_NAME = 'uniq_rule_scheduled'
);
SET @sql := IF(@has_old_log_idx > 0,
  'ALTER TABLE auto_task_run_logs DROP INDEX uniq_rule_scheduled',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_old_sequelize_log_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auto_task_run_logs' AND INDEX_NAME = 'auto_task_run_logs_rule_id_scheduled_at'
);
SET @sql := IF(@has_old_sequelize_log_idx > 0,
  'ALTER TABLE auto_task_run_logs DROP INDEX auto_task_run_logs_rule_id_scheduled_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_new_log_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auto_task_run_logs' AND INDEX_NAME = 'uniq_rule_scheduled_event'
);
SET @sql := IF(@has_new_log_idx = 0,
  'ALTER TABLE auto_task_run_logs ADD UNIQUE KEY uniq_rule_scheduled_event (rule_id, scheduled_at, event_type)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_auto_task_duty_config := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auto_task_rules' AND COLUMN_NAME = 'duty_config'
);
SET @sql := IF(@has_auto_task_duty_config = 0,
  'ALTER TABLE auto_task_rules ADD COLUMN duty_config TEXT NULL AFTER dingtalk_recipients',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
