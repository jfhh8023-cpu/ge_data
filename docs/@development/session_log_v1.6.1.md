# 开发日志 v1.6.1 — 交互增强 & 人员交接

> 日期：2026-04-17  
> 版本：v1.6.1  
> 需求文档：`docs/demand/REQ-v1.6.1-enhancements.md`  
> 开发文档：`docs/development/DEV-v1.6.1-enhancements.md`  
> 开发计划：`docs/@plan/PLAN-v1.6.1-enhancements.md`

---

## REQ-01：新建收集任务自动首选

**变更文件**：`backend/src/routes/tasks.js`

- `POST /api/tasks` 新建时：先 `UPDATE collection_tasks SET is_preferred=false, status='closed' WHERE is_preferred=true`，再创建新任务（is_preferred=true, status=active）
- 无需前端改动，FillPage 打开后 `GET /fill/:token` 自动返回新首选任务

---

## REQ-02：FillPage 编辑历史 UI 优化

**变更文件**：`frontend/src/views/FillPage.vue`

- 新增 `.fill-edit-banner` 提示条，位于左侧卡片**外部顶部**；含【编辑历史数据】标题 + 返回按钮
- 卡片内标题区移除旧的 `【编辑历史数据】` 文字和 `.fill-back-bar`
- 历史面板每个任务块底部增加 `.fill-history-task-footer` 横行：工时 | 状态标签 | 编辑按钮
- 移除旧 `.fill-back-bar` CSS 定义

---

## REQ-03：PersonnelPage 链接显示优化

**变更文件**：`frontend/src/views/PersonnelPage.vue`

- 专属链接改用 `.dt-link-url-full`：`word-break: break-all; white-space: normal`，完整展示
- 操作列新增 `.dt-link-ops` + `.dt-link-op-btn`：14px 粗体横排不换行
- 按钮文本：打开 / 复制 / 复制带标题

---

## REQ-04：人员删除数据交接

**变更文件**：
- `backend/src/routes/staff.js`：新增 `GET /:id/records-summary`、`POST /:id/transfer`；`DELETE /:id` 前检查 WorkRecord 数量
- `frontend/src/views/PersonnelPage.vue`：管理列新增"交接"按钮；交接弹窗含任务汇总表 + 目标人员下拉

**交接流程**：
1. 点击「交接」→ 请求 records-summary 加载数据
2. 弹窗展示该人员的任务汇总（任务名 / 状态 / 记录数 / 总工时）
3. 下拉选目标人员 → 点击「确认交接」→ POST /staff/:id/transfer
4. 交接完成后列表刷新，然后可正常删除

---

## 验证结果

- ✅ `records-summary` API：返回 code:0，tasks:12，total:43
- ✅ Lint 无报错
- ✅ 后端路由加载成功
