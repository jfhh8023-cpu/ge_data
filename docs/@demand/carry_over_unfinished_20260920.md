# REQ-070 未完成需求跨周回显（冻结需求）

2026-09-20。状态：四轮设计反哺完成，**待用户确认冻结版与 D1/D2/D3 决策后开发**。

## 1. 用户原始需求

填写工时时，若需求交付进度 <100%，下一周填写工时时自动把该需求带出回显（上一周的版本号、需求名称、其他全部参数信息、进度百分比），以便本周完成到 100%；达成 100% 后该需求按 100% 计算；历史周期提交的 <100% 记录与百分比保持原样。

## 2. 带出规则

- **触发**：填写页打开且存在当前任务，且本人在当前任务**既无已提交记录也无草稿**；历史任务编辑模式不触发。
- **候选源**：本人（`staff_id`）在 `start_date` 早于当前任务的所有任务中的记录（D1 默认；若选"紧邻"则只取最近一个更早任务），研发取 `work_records`，AI 产品经理取 `product_manager_work_records`；system/legacy 两种链接一致。
- **分组与最新**：按 `(staff_id, version.trim(), requirement_title.trim())` 分组，取最新周期记录（任务 end_date → updated_at → created_at → id，与 `DeliverySummaryService.isLater` 一致）。
- **纳入**：最新记录 `delivery_progress` 为 0~99 的已知值。
- **排除**：五类全额（请假/培训/公司会议/出差/团建）、无有效版本（空或 `-`）、最新进度 null（历史空进度按 100% 兼容）、最新进度 100。

## 3. 回显内容

每个纳入组预置一行：`requirement_title`、`version`、研发 `product_managers` / AI 产品 `demand_sources`+`demand_source_ids`+`demand_source_weights`、`delivery_progress`=上次进度（上次为 0 时预填空并提示 0%）、`hours` 留空（D3 默认）。行附带前端私有 `_carry_over{source_task_id, source_task_title, source_week_number, previous_progress}`，标题下方显示 `上周未完成 · 上次进度 N%`；标题或版本被改动时追加 `（已修改，将作为新需求统计）`（D2 默认）。

## 4. 提交与统计

- 带出行是**建议行**：可编辑、可删除；提交、暂存、校验（`validateManualHours`、进度须正值、PM/需求方必选）与手填行完全一致，不新增写路径。删除后不写库，下周仍 <100 则再次带出。
- **历史不变**：不修改任何既有记录；本条需求无表/列变更。
- **按 100 计算**：沿用 REQ-066 加权口径（同人+版本+标题分组取所选范围最新周期进度）。本周填 100 后，含本周的范围该组按 100 计；仅选历史范围仍显示原值。**统计代码不改。**
- REQ-069 "查看未完成"列表按同一分组自然收敛，不改。

## 5. 已知降级与边界

- 草稿保存后 `_carry_over` 标签不持久化，恢复草稿时标签消失（内容保留）。
- 不按 `time_dimension` 过滤更早任务；不新增"忽略此需求"持久化状态。
- Excel 导入、文本识别、历史导出、权限与离职拦截逻辑不变。

## 6. 待确认决策（铁律 18.5）

| 编号 | 问题 | 默认 | 备选 |
| --- | --- | --- | --- |
| D1 | "上一周"范围 | 所有更早任务的最新进度 | 仅紧邻前一任务 |
| D2 | 带出行标题/版本 | 可编辑 + 脱钩提示 | 只读锁定 |
| D3 | 带出行工时 | 留空 | 复制上周 |

[冻结计划](../@plan/carry_over_unfinished_20260920.md) · [四轮矩阵](../@test/carry_over_unfinished_20260920/round4.md) · 轮次：[R1](../@test/carry_over_unfinished_20260920/round1.md) [R2](../@test/carry_over_unfinished_20260920/round2.md) [R3](../@test/carry_over_unfinished_20260920/round3.md)
