# 开发日志 v1.6.0 — 首选收集项 & 系统级专属链接

> 日期：2026-04-17  
> 版本：v1.6.0  
> 需求文档：`docs/demand/REQ-preferred-link-refactor.md` (v1.1)  
> 开发文档：`docs/development/DEV-preferred-link-refactor.md` (v1.1)  
> 开发计划：`docs/@plan/PLAN-preferred-link-refactor.md` (v1.1)

---

## 开发概述

本版本实现了三大功能模块：
1. **首选收集项**：管理员可标记某个 active 任务为「收集首选」，唯一互斥
2. **系统级专属链接**：每人一条永久链接，跨任务复用，不再与具体任务绑定
3. **填写页历史编辑**：用户可从右侧历史面板点击编辑，回显记录到左侧表单

---

## 阶段执行记录

### 阶段1：DB + 模型
- **文件变更**：
  - `backend/src/models/CollectionTask.js`：新增 `is_preferred BOOLEAN` 字段
  - `backend/src/models/StaffFillLink.js`：新建，含 id/staff_id/token/editing_task_id/editing_at/last_action/draft_data 等字段
  - `backend/src/models/index.js`：注册 StaffFillLink，建立 Staff 1:1 StaffFillLink 关联
  - `backend/src/scripts/migrate-v1.6.0.js`：迁移脚本（已执行，9人迁移完成）
- **问题修复**：
  - SQL `only_full_group_by` 模式错误：去掉 `GROUP BY fl.staff_id`
  - 字符集冲突（utf8mb4_unicode_ci vs utf8mb4_0900_ai_ci）：`ALTER TABLE CONVERT TO ...utf8mb4_unicode_ci`

### 阶段2：首选收集项 API + TaskList UI
- **文件变更**：
  - `backend/src/routes/tasks.js`：新增 `PATCH /:id/preferred`；更新 activity 接口兼容 StaffFillLink
  - `frontend/src/views/TaskList.vue`：添加 `handlePreferred`、`preferredTask` computed；操作列新增「设为首选/取消」按钮，列宽 240→340

### 阶段3：团队人员列表重构
- **文件变更**：
  - `backend/src/routes/staff.js`：`GET /` 含 fillLink.token；新增 `POST /ensure-links`；`POST /` 自动创建 StaffFillLink
  - `frontend/src/views/PersonnelPage.vue`：完全重写为 el-table，含预设文本框、打开/复制/复制带标题链接操作列

### 阶段4：系统级链接后端
- **文件变更**：
  - `backend/src/routes/fill.js`：完全重写，通过 `resolveToken()` 工具函数双路由（system/legacy）；新增 `GET /:token/task/:taskId/records` 端点

### 阶段5：填写页前端
- **文件变更**：
  - `frontend/src/views/FillPage.vue`：新增 `editingHistoryTask` 状态；`loadHistoryForEdit(task)` 函数；`returnToPreferred()` 函数；无首选任务空态 UI；历史编辑按钮；返回首选按钮

### 阶段6：移除链接管理 Tab
- **文件变更**：
  - `frontend/src/views/TaskDetail.vue`：移除 Tab2（链接管理）全部 UI 和逻辑代码

### 阶段7：版本发布
- 验证通过：后端路由加载 ✓、staff API 返回 fillToken ✓、preferred API 设置 ✓、fill 系统链接解析 ✓
- 前端 lint 无报错 ✓
- PROJECT_STATUS.md 更新至 v1.6.0

---

## 关键技术决策

1. **双链接体系兼容**：`resolveToken()` 先查 `staff_fill_links`，不存在则 fallback 到旧 `fill_links`。保障存量旧链接继续可用，无需强制迁移。

2. **活动状态追踪迁移**：`editing_at` 从 FillLink 迁移到 StaffFillLink，增加 `editing_task_id` 字段以区分当前编辑的任务。tasks.js activity 接口改为查 StaffFillLink。

3. **link_id null 处理**：新体系提交时 `link_id = null`（WorkRecord 允许 null），通过 `task_id + staff_id` 删除旧记录，不依赖 link_id。

4. **collation 统一**：新建 staff_fill_links 表默认 charset 为 utf8mb4_0900_ai_ci，与现有 staff 表（utf8mb4_unicode_ci）不兼容。迁移脚本末尾执行 CONVERT TO utf8mb4_unicode_ci 修正。

---

## 生产部署注意事项

1. 先在生产服务器执行迁移：`node backend/src/scripts/migrate-v1.6.0.js`
2. 重启后端服务：`pm2 restart devtracker`
3. 构建并部署前端：`python deploy/deploy.py`
