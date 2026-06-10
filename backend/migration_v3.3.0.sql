-- DevTracker v3.3.0 migration
-- 值班通知名句搭配功能
SET NAMES utf8mb4;
USE devtracker;

-- 句子库（按 sort_order 升序）
CREATE TABLE IF NOT EXISTS quotes (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  content    TEXT         NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 名句搭配配置（每条 auto_task_rule 一份）
CREATE TABLE IF NOT EXISTS quote_configs (
  id              CHAR(36) NOT NULL PRIMARY KEY,
  rule_id         CHAR(36) NOT NULL,
  enabled         TINYINT(1) NOT NULL DEFAULT 0,
  no_repeat_count INT NOT NULL DEFAULT 20,
  candidate_queue JSON NULL,
  used_history    JSON NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_rule (rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
