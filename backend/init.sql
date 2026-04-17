-- DevTracker v1.0.0 数据库初始化脚本
-- MySQL 8.0 | root/123456

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

DROP DATABASE IF EXISTS devtracker;
CREATE DATABASE devtracker DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE devtracker;

-- 收集任务表
CREATE TABLE IF NOT EXISTS collection_tasks (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(200) NOT NULL COMMENT '任务标题（自动生成）',
  time_dimension ENUM('day','week','half_month','month','quarter','half_year','year') DEFAULT 'week' COMMENT '时间维度',
  start_date DATE NOT NULL COMMENT '开始日期',
  end_date DATE NOT NULL COMMENT '结束日期',
  week_number INT COMMENT '周序号',
  year INT NOT NULL COMMENT '年份',
  status ENUM('draft','active','closed') DEFAULT 'active' COMMENT '状态',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_year_status (year, status),
  INDEX idx_start_date (start_date)
) ENGINE=InnoDB COMMENT='收集任务';

-- 人员表
CREATE TABLE IF NOT EXISTS staff (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(50) NOT NULL COMMENT '姓名',
  role ENUM('frontend','backend','test') NOT NULL COMMENT '角色',
  is_active BOOLEAN DEFAULT TRUE COMMENT '在职状态',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_role (role),
  INDEX idx_active (is_active)
) ENGINE=InnoDB COMMENT='研发人员';

-- 填写链接表
CREATE TABLE IF NOT EXISTS fill_links (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL COMMENT '关联任务ID',
  staff_id CHAR(36) NOT NULL COMMENT '关联人员ID',
  token VARCHAR(100) UNIQUE NOT NULL COMMENT '唯一令牌',
  is_submitted BOOLEAN DEFAULT FALSE COMMENT '是否已提交',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES collection_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  INDEX idx_task (task_id),
  INDEX idx_token (token)
) ENGINE=InnoDB COMMENT='填写链接';

-- 工时记录表
CREATE TABLE IF NOT EXISTS work_records (
  id CHAR(36) PRIMARY KEY,
  link_id CHAR(36) COMMENT '关联链接ID',
  task_id CHAR(36) NOT NULL COMMENT '关联任务ID',
  staff_id CHAR(36) NOT NULL COMMENT '关联人员ID',
  requirement_title VARCHAR(200) NOT NULL COMMENT '需求标题',
  version VARCHAR(50) COMMENT '版本号',
  product_managers JSON COMMENT '产品经理列表',
  hours DECIMAL(6,2) NOT NULL COMMENT '工时(小时)',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES collection_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  INDEX idx_task_staff (task_id, staff_id)
) ENGINE=InnoDB COMMENT='工时记录';

-- 匹配组表
CREATE TABLE IF NOT EXISTS match_groups (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL COMMENT '关联任务ID',
  merged_title VARCHAR(200) COMMENT '合并后的需求标题',
  version VARCHAR(50) COMMENT '版本号',
  product_managers JSON COMMENT '产品经理列表',
  frontend JSON COMMENT '前端人员工时 [{staffName,hours}]',
  backend JSON COMMENT '后端人员工时',
  test_role JSON COMMENT '测试人员工时',
  remark TEXT COMMENT '备注',
  confidence DECIMAL(3,2) DEFAULT 0 COMMENT '匹配置信度',
  status ENUM('auto_merged','pending_review','manual_merged') DEFAULT 'auto_merged',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES collection_tasks(id) ON DELETE CASCADE,
  INDEX idx_task (task_id)
) ENGINE=InnoDB COMMENT='匹配汇总组';

-- ========== Mock 数据 ==========

-- 人员
INSERT INTO staff (id, name, role, is_active, created_at) VALUES
('s1', '张三', 'frontend', TRUE, '2026-01-01'),
('s2', '赵六', 'frontend', TRUE, '2026-01-01'),
('s3', '李四', 'backend',  TRUE, '2026-01-01'),
('s4', '钱七', 'backend',  TRUE, '2026-01-01'),
('s5', '王五', 'test',     TRUE, '2026-01-01'),
('s6', '孙八', 'test',     TRUE, '2026-01-01');

-- 收集任务
INSERT INTO collection_tasks (id, title, time_dimension, start_date, end_date, week_number, year, status) VALUES
('t1', '2026年04月06日-2026年04月12日，本年度第15周工作统计', 'week', '2026-04-06', '2026-04-12', 15, 2026, 'active');

-- 填写链接
INSERT INTO fill_links (id, task_id, staff_id, token, is_submitted) VALUES
('l1','t1','s1','token_1',TRUE), ('l2','t1','s2','token_2',TRUE),
('l3','t1','s3','token_3',TRUE), ('l4','t1','s4','token_4',TRUE),
('l5','t1','s5','token_5',TRUE), ('l6','t1','s6','token_6',TRUE);

-- 工时记录
INSERT INTO work_records (id, link_id, task_id, staff_id, requirement_title, version, product_managers, hours) VALUES
('r1','l1','t1','s1','用户中心改版','V4.633.0','["杨瑞"]',5),
('r2','l1','t1','s1','AI Agent 优化','V4.633.0','["钟冠"]',3),
('r3','l2','t1','s2','用户中心改版','V4.633.0','["杨瑞"]',4),
('r4','l3','t1','s3','用户中心改版','V4.633.0','["杨瑞"]',6),
('r5','l3','t1','s3','AI Agent 优化','V4.633.0','["钟冠"]',8),
('r6','l4','t1','s4','支付系统升级','V4.634.0','["吴浩鑫"]',10),
('r7','l5','t1','s5','用户中心改版','V4.633.0','["杨瑞"]',9),
('r8','l6','t1','s6','AI Agent 优化','V4.633.0','["钟冠"]',4);

-- 匹配组
INSERT INTO match_groups (id, task_id, merged_title, version, product_managers, frontend, backend, test_role, confidence, status) VALUES
('mg1','t1','用户中心改版','V4.633.0','["杨瑞"]','[{"staffName":"张三","hours":5},{"staffName":"赵六","hours":4}]','[{"staffName":"李四","hours":6}]','[{"staffName":"王五","hours":9}]',0.95,'auto_merged'),
('mg2','t1','AI Agent 优化','V4.633.0','["钟冠"]','[{"staffName":"张三","hours":3}]','[{"staffName":"李四","hours":8}]','[{"staffName":"孙八","hours":4}]',0.90,'auto_merged'),
('mg3','t1','支付系统升级','V4.634.0','["吴浩鑫"]','[]','[{"staffName":"钱七","hours":10}]','[]',1.0,'auto_merged');
