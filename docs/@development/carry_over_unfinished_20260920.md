# REQ-070 开发记录：未完成需求跨周回显

2026-09-20。冻结需求：`docs/@demand/carry_over_unfinished_20260920.md`；执行记录：`docs/@test/carry_over_unfinished_20260920/execution.md`。无 DB 结构变更，无迁移，未部署生产。

## 改动文件

| 文件 | 内容 |
| --- | --- |
| `backend/src/services/DeliverySummaryService.js` | 新增导出 `buildCarryOverRows(records, tasks, currentTask)`：复用 `groupKey`/`isLater`/`hasValidVersion`，只取 `start_date` 早于当前任务的任务；排除五类、无版本、最新进度 null 或 ≥100；进度 0 → `delivery_progress:null` 且 `_carry_over.previous_progress:0`；JSON 字符串列（MariaDB）解析；按来源周 end_date 降序、标题升序。 |
| `backend/src/routes/fill.js` | `loadCarryOverRows(Model, staffId, currentTask, {records, draftRecords})`：仅当无记录且无草稿时按 `staff_id` 一次 `findAll` + 任务查询；system/legacy 两分支响应新增 `carry_over_records`。 |
| `backend/src/models/StaffFillLink.js`、`FillLink.js` | `draft_data` getter：字符串 → JSON.parse（修复 MariaDB 下草稿从不恢复的存量缺陷）。 |
| `frontend/src/views/FillPage.vue` | 初始化顺序 草稿 → 记录 → **带出行** → 空行（onMounted 与 `returnToPreferred` 一致）；`normalizeRows` 透传 `_carry_over` 并补 `original_title/original_version`；标题下 `.fill-carry-over-tag`（"第N周未完成 · 上次进度 N%"，改动后追加"已修改"）；带出时 `ElMessage.info`。提交 payload 白名单不含 `_carry_over`。 |
| `backend/scripts/verify_carry_over_rules.js` / `verify_carry_over_api.js` / `verify_carry_over_after_submit.js` | 纯函数、隔离 fixture API、提交后历史/统计核验脚本。 |
| `backend/scripts/verify_effective_hours_backend.js` | 路由夹具依赖白名单补 `DeliverySummaryService`、`Op.ne`。 |

## 未改动（有意）

- 统计口径（`buildDeliverySummary`、前端 `groupRequirementProgress`）、REQ-069 未完成列表：按 100 计算由既有"最新周期进度"分组自然成立。
- 提交 / 草稿 / 校验写路径、Excel 导入、文本识别、权限拦截。

## 回滚

`git revert <commit>` 单次即可；业务库无需回滚。

## 验证命令

```
node backend/scripts/verify_carry_over_rules.js
node backend/scripts/verify_carry_over_api.js            # 需本地 backend 3001；自动创建并清理 fixture
node backend/scripts/verify_effective_hours_backend.js
node backend/scripts/verify_delivery_summary.js
cd frontend && npx vite build
```
