# REQ-070 第2轮：纳入/排除集、双模型双链接、删除后行为

2026-09-20；设计审查，运行 NOT RUN。反哺来源：CO1-F-001、CO1-F-003、CO1-F-004。

## 本轮修订需求

1. **候选集定义（回应 CO1-F-001）**：以本人在当前任务之外、`start_date` 早于当前任务的所有任务记录为源，按 `(staff_id, version.trim(), requirement_title.trim())` 分组，取该组最新周期（`isLater`：任务 end_date → updated_at → created_at → id）的记录；仅当该记录 `normalizeProgress(delivery_progress)` 为 0~99 的**已知值**时纳入。默认采用"所有更早任务"（D1 推荐值），若用户选"紧邻前一任务"则源限定为 `start_date` 最大的那一个更早任务。
2. **排除集**：五类全额记录（`isFullCreditRecord`）、无有效版本（`hasValidVersion` 为假）、最新进度 null（历史空进度按 100% 兼容，不视为未完成）、最新进度 100。
3. **重复保护**：若当前任务已有该组（同标题+版本）的已提交记录或草稿行，则不带出该组。
4. **双模型双链接**：研发 `WorkRecord`（回显 `product_managers`）与 AI 产品 `ProductManagerWorkRecord`（回显 `demand_sources`、`demand_source_ids`、`demand_source_weights`）；`system`（`StaffFillLink`）与 `legacy`（`FillLink`）两种 token 均返回同一字段。
5. **删除后行为（回应 CO1-F-003）**：带出行只是**建议行**，删除后不写库；下周再打开若该组仍 <100 则再次带出。不新增"忽略"持久化状态（最小变更）。
6. **触发时机（回应 CO1-F-004）**：仅在当前任务**既无已提交记录也无草稿**时，将带出行作为初始 `rows`；否则不干预。历史任务编辑模式（`editingHistoryTask`）不带出。

## 测试用例

| 用例 | 输入/预期 |
| --- | --- |
| CO2-F-001 | 上周 A 40%、上上周 B 70%、上周未填 B → 带出 A 与 B（D1=所有更早任务）；若 D1=紧邻则仅 A。 |
| CO2-F-002 | A 组：上上周 40、上周 100 → 不带出（最新为 100）。 |
| CO2-F-003 | A 组：上上周 100、上周 40 → 带出 40。 |
| CO2-F-004 | 最新进度 0 → 带出，进度选择器显示 0%（与 REQ-069 历史 0 只读项一致，提交前须改为正值）。 |
| CO2-F-005 | 最新进度 null（历史空） → 不带出。 |
| CO2-F-006 | 请假/培训等五类、无版本 "-" 或空 → 不带出。 |
| CO2-F-007 | 当前任务已提交含 A v1.0 → A 不带出；B 仍带出？→ 否，见 R2-6：当前任务已有任何记录则整体不带出（保持"三选一"初始化）。 |
| CO2-F-008 | 本人删除带出行并提交空表/其他行 → DB 无 A；下周打开再次带出 A。 |
| CO2-R-001 | AI 产品经理：上周 A 需求方 [甲,乙] 权重 60/40 进度 50 → 带出行需求方与权重一致。 |
| CO2-R-002 | legacy `FillLink` token 与 system token 返回结构一致。 |
| CO2-A-001 | 后端返回 `carry_over_records: [{requirement_title, version, product_managers|demand_sources…, delivery_progress, source_task_id, source_task_title, source_week_number}]`，不含 `id`，避免被误当 `existing_record_id`。 |
| CO2-P-001 | 离职人员（`blocked`）响应不含带出；`assertStaffCanWrite` 逻辑不变。 |

## 反哺

- CO2-F-007 揭示歧义："当前任务已有记录"按**整体**判断（沿用初始化三选一）比按组判断更简单且不产生半自动混排 → 采纳整体判断，写入 R3。
- CO2-F-004 揭示：进度 0 在 REQ-069 中仅对 `existing_record_id` 行显示只读 0% 项；带出行无 `existing_record_id`，`el-select` 会显示裸值 0 → R3 需明确前端处理（预置为 0 时清空进度并高亮提示，或允许显示 0 只读项）。
- CO2-A-001 未定义前端如何标识"带出行"（视觉标签 + 上周进度）→ R3 UI 用例。
- 性能：候选计算需读本人全部历史记录；生产 880 条总量、单人 <100 条，可接受；但需在 R3 明确一次查询、不做 N+1。
- 待用户决策 D2（标题/版本可改？）、D3（工时留空？）仍未决，进入 R3 假设：D2=可改但给出脱钩提示，D3=留空。
