# 开发日志 v3.1.2 — 自动任务执行模式与通知子模块优化

**日期**：2026-05-19  
**关联需求文档**：`docs/@demand/requirements_v3.1.2.md`  
**执行状态**：本地开发完成，暂不发版  

---

## 一、文档回溯

已按规约回读：

- `docs/@architecture/conventions.md`
- `docs/@demand/requirements_v3.1.0.md`
- `docs/@demand/requirements_v3.1.1.md`

本次变更仅覆盖设置页自动任务规则、钉钉 webhook 通知子模块、自动任务后端规则模型与执行逻辑。

---

## 二、完成内容

### 2.1 自动任务执行模式

新增规则执行模式：

- `执行规则并通知`
- `仅执行规则`
- `仅通知`

后端字段：

- `auto_task_rules.action_mode`
- 默认值：`run_and_notify`

兼容规则：

- 旧规则没有 `action_mode` 时，按 `run_and_notify` 处理。
- 启动时自动补列，不重建表，不清理已有数据。

### 2.2 模式联动

`执行规则并通知`：

- 维持原逻辑。
- 通知开关打开时新增任务后通知。
- 通知开关关闭时仅新增任务。

`仅执行规则`：

- 通知开关强制关闭。
- 通知开关不可打开。
- 自动触发和测试执行均只新增任务，不发送 webhook。

`仅通知`：

- 通知开关强制打开。
- 通知开关不可关闭。
- 自动触发时只发送 webhook，不新增任务。
- 测试执行按钮置灰，不允许触发新增任务。

### 2.3 页面交互

- 在规则时间选择框与保存规则按钮之间新增执行模式下拉框。
- 钉钉 webhook 通知模块整体右缩进。
- 新增直角子目录连接线，表现为规则行的子模块。
- 通知操作按钮顺序调整为：
  1. 保存通知
  2. 配置接收人
  3. 测试发送webhook

---

## 三、涉及文件

- `backend/src/models/AutoTaskRule.js`
- `backend/src/services/AutoTaskService.js`
- `backend/migration_v3.1.0.sql`
- `frontend/src/views/SettingsPage.vue`
- `docs/@demand/requirements_v3.1.2.md`
- `docs/@development/session_log_v3.1.2.md`

---

## 四、验证记录

后端语法：

- `node -c backend/src/services/AutoTaskService.js`
- `node -c backend/src/models/AutoTaskRule.js`
- `node -c backend/src/routes/settings.js`

前端构建：

- `npx vite build --configLoader runner`

接口/逻辑：

- 本地 `/api/settings/auto-tasks` 返回旧规则默认 `action_mode: run_and_notify`。
- `normalizeRulePayload` 验证：
  - `run_and_notify` 保留通知开关。
  - `run_only` 强制 `notify_enabled=false`。
  - `notify_only` 强制 `notify_enabled=true`。
- `runRuleOnce({ action_mode: 'notify_only' })` 返回“当前任务仅通知，已禁止生成任务”。

浏览器冒烟：

- 设置页可见执行模式下拉、保存通知、配置接收人、测试发送webhook。
- `仅通知`：测试执行按钮置灰，通知开关锁定打开。
- `仅执行规则`：测试执行按钮可用，通知开关锁定关闭，通知配置区隐藏。
- 截图：
  - `C:/tmp/devtracker_settings_v312.png`
  - `C:/tmp/devtracker_settings_v312_notify_only.png`
  - `C:/tmp/devtracker_settings_v312_run_only.png`

---

## 五、未执行事项

- 未推送远端仓库。
- 未发版到生产环境。
- 未修改线上数据。
