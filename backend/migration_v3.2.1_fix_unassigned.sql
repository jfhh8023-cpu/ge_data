-- DevTracker v3.2.1 迁移脚本
-- 将 product_managers 字段中的 "未分配" 全部迁移为 "不在上述"
-- 执行前请备份：mysqldump -u root -p devtracker work_records match_groups > backup_v3.2.1.sql

SET NAMES utf8mb4;
USE devtracker;

-- 1. work_records：将 ["未分配"] → ["不在上述"]
UPDATE work_records
SET product_managers = REPLACE(product_managers, '"未分配"', '"不在上述"'),
    updated_at = NOW()
WHERE product_managers LIKE '%未分配%';

-- 2. match_groups：将 ["未分配"] → ["不在上述"]
UPDATE match_groups
SET product_managers = REPLACE(product_managers, '"未分配"', '"不在上述"')
WHERE product_managers LIKE '%未分配%';

-- 3. 验证：确认无残留
SELECT 'work_records 未分配残留' AS check_item,
       COUNT(*) AS cnt
FROM work_records
WHERE product_managers LIKE '%未分配%'
UNION ALL
SELECT 'match_groups 未分配残留',
       COUNT(*)
FROM match_groups
WHERE product_managers LIKE '%未分配%';
