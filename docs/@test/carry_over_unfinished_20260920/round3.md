# REQ-070 第3轮：UI 标识、进度 0 处理、API 契约、数据与回滚

2026-09-20；设计审查，运行 NOT RUN。反哺来源：CO2-F-004、CO2-F-007、CO2-A-001。

## 本轮修订需求

1. **整体触发**（定稿 CO2-F-007）：`rows` 初始化顺序改为 草稿 → 已提交记录 → **带出行** → 空行；带出行非空时不再追加空行。
2. **带出行标识**（回应 CO2-A-001）：行携带前端私有字段 `_carry_over = { source_task_title, source_week_number, previous_progress }`；需求标题单元格下方显示小字标签 `上周未完成 · 上次进度 40%`（周号缺失时显示任务标题）。私有字段不进入提交 payload（现有 `handleSubmit` 已白名单构造字段，需核对）。
3. **进度 0 处理**（回应 CO2-F-004）：带出行 `delivery_progress` 预填上次值；若上次为 0，则预填 `null` 并在标签中显示 `上次进度 0%`，由本人选择正值——避免出现选择器裸值 0 且与 REQ-069 "新提交须正进度"一致。
4. **标题/版本（D2 假设=可改）**：保持可编辑；当标题或版本被改动后标签追加 `（已修改，将作为新需求统计）`。
5. **工时（D3 假设=留空）**：`hours=null`，提交校验沿用 `validateManualHours`。
6. **API 契约**：`GET /api/fill/:token` 在 `data` 新增 `carry_over_records`（数组，可空）。仅在 `task` 非空且 `records.length===0` 且 `draft_records` 为空时计算，否则返回 `[]`，减少无效查询。候选计算为纯函数 `buildCarryOverRows(historyRecords, tasks, currentTask)`，放入 `DeliverySummaryService`（复用 `groupKey`/`isLater`/`hasValidVersion`），一次 `findAll` 取本人全部记录。
7. **DB**：无表/列变更，无迁移。
8. **回滚**：仅回退 `routes/fill.js`、`DeliverySummaryService.js`、`FillPage.vue` 三处代码；已通过带出行提交的记录是本人确认的正常记录，不需数据回滚。

## 测试用例

| 用例 | 输入/预期 |
| --- | --- |
| CO3-U-001 | 带出行标题下方显示 `上周未完成 · 上次进度 40%`；手填/草稿/已提交行无此标签。 |
| CO3-U-002 | 上次进度 0 → 进度为空、标签 `上次进度 0%`；直接提交被现有校验拦截"请选择1%或10%至100%"。 |
| CO3-U-003 | 修改带出行标题 → 标签追加"已修改"；改回原值 → 标签恢复。 |
| CO3-U-004 | 带出行工时为空；填 8 后底部总工时联动。 |
| CO3-U-005 | 带出行可 ✕ 删除；全部删除后表格为空行 1 行（沿用"至少保留一行"）。 |
| CO3-U-006 | 暂存草稿后刷新 → 恢复的是草稿（含带出行内容），不再重复带出。 |
| CO3-U-007 | 编辑历史任务模式不带出；返回首选任务后按 R3-1 重新初始化。 |
| CO3-A-001 | 有记录/有草稿/无任务/blocked 四种情况 `carry_over_records` 为 `[]` 或缺省，不报错。 |
| CO3-A-002 | 返回项不含 `id`/`existing_record_id`/`_allowMissingProgress`；提交 payload 不含 `_carry_over`。 |
| CO3-D-001 | 纯函数：输入 3 周 5 条记录 → 输出组数、进度、来源任务符合 R2 规则（含 0/null/100/五类/无版本各一）。 |
| CO3-D-002 | 提交后 `work_records` 中上周行 `delivery_progress` 与 `updated_at` 不变（只读指纹前后一致）。 |
| CO3-S-001 | 统计页：选上周 → A 40%；选两周 → A 100%；REQ-069 "查看未完成"列表两周范围不再列出 A。 |
| CO3-I-001 | Excel 导入 / 文本识别路径不受影响（`newRows:true` 分支未改）。 |
| CO3-E-001 | 回滚三文件后，页面回到现状初始化逻辑，DB 无需变更。 |

## 反哺

- CO3-U-006 揭示：草稿保存的是带出行内容但丢失 `_carry_over` 标签（`normalizeSavedRows` 白名单）→ 接受：草稿恢复后标签消失是可接受降级，不扩展草稿结构（最小变更）。写入冻结版为"已知降级"。
- CO3-A-001 揭示：`legacy` 分支目前无 `task` 为空的情况，但 `records` 按 `link_id` 查询——候选源应统一按 `staff_id` 查询，而非 `link_id`。写入冻结版。
- CO3-D-001 揭示：任务 `start_date` 相同的两个任务（如周/月维度并存）排序歧义 → 候选源只取 `time_dimension` 与当前任务相同的任务？超出用户需求；冻结版采用"所有更早任务"不按维度过滤，`isLater` 已用 end_date + 时间戳兜底。
- 三轮后仍待用户拍板：D1（所有更早任务 vs 紧邻一周）、D2（标题/版本可改）、D3（工时留空）。默认值已在文档中标注，进入第 4 轮冻结。
