-- DevTracker v1.1.0 数据库迁移脚本

-- REQ-16: 子任务停止/开始
ALTER TABLE work_records ADD COLUMN is_active TINYINT(1) DEFAULT 1;

-- REQ-17: 实时编辑通知
ALTER TABLE work_records ADD COLUMN edit_count INT DEFAULT 0;
ALTER TABLE work_records ADD COLUMN submit_count INT DEFAULT 0;
ALTER TABLE fill_links ADD COLUMN editing_at DATETIME NULL;
ALTER TABLE fill_links ADD COLUMN last_action VARCHAR(20) NULL;
ALTER TABLE fill_links ADD COLUMN last_action_at DATETIME NULL;

-- REQ-21: 权限控制
CREATE TABLE IF NOT EXISTS access_links (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '链接名称',
  token VARCHAR(200) UNIQUE NOT NULL COMMENT '访问令牌',
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS link_permissions (
  id CHAR(36) PRIMARY KEY,
  link_id CHAR(36) NOT NULL COMMENT '关联 access_links.id',
  resource VARCHAR(100) NOT NULL COMMENT '资源标识（页面/按钮）',
  can_view TINYINT(1) DEFAULT 0,
  can_create TINYINT(1) DEFAULT 0,
  can_update TINYINT(1) DEFAULT 0,
  can_delete TINYINT(1) DEFAULT 0,
  FOREIGN KEY (link_id) REFERENCES access_links(id) ON DELETE CASCADE
);
