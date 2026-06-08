-- DevTracker v3.2.0 迁移脚本
-- 新增产品经理管理表

SET NAMES utf8mb4;
USE devtracker;

-- 1. 创建 product_managers 表
CREATE TABLE IF NOT EXISTS product_managers (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE COMMENT '产品经理姓名',
  token VARCHAR(100) UNIQUE COMMENT 'PM 专属查看链接令牌',
  is_active BOOLEAN DEFAULT TRUE COMMENT '是否在职',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_name (name),
  INDEX idx_token (token)
) ENGINE=InnoDB COMMENT='产品经理';

-- 2. 从现有 work_records 中提取 PM 名称自动初始化
-- 注意：仅当 product_managers 表为空时才执行初始化
INSERT IGNORE INTO product_managers (id, name, token, is_active, created_at)
SELECT
  UUID() AS id,
  pm_name AS name,
  CONCAT(LEFT(REPLACE(UUID(), '-', ''), 8), '_', LEFT(REPLACE(UUID(), '-', ''), 12)) AS token,
  TRUE AS is_active,
  NOW() AS created_at
FROM (
  SELECT DISTINCT JSON_UNQUOTE(j.pm) AS pm_name
  FROM work_records,
       JSON_TABLE(product_managers, '$[*]' COLUMNS (pm VARCHAR(50) PATH '$')) AS j
  WHERE JSON_UNQUOTE(j.pm) IS NOT NULL
    AND JSON_UNQUOTE(j.pm) != ''
    AND JSON_UNQUOTE(j.pm) NOT REGEXP '^[0-9.]+$'
) AS unique_pms
WHERE pm_name IS NOT NULL;
