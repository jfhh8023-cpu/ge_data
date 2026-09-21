# REQ-072 第2轮：边界与规则补全

2026-09-21；设计审查，运行 NOT RUN。承接 R1 反哺。

## R1 缺口的代码核对

- **0h 记录**：后端 `buildDeliverySummary:42` 与前端 `summarizeDelivery:84` 仅剔除 `hours<0`/空，`hours=0` 进入 `selected` 并参与 `groups` 最新判定（`isLater` 先比周期 end_date）→ W37 `0h/100%` 会让该组最新进度变为 100，累计工时仍为历史之和。`incompleteRequirementRows:25` 按 `group.hours>0` 且 `progress<100` 过滤 → 0h/100 不再列出。**统计代码无需改动。**
- **提交过滤**：`FillPage.vue:273` `row.hours > 0` 以前端行值判断；行值为累计 C ≥ H > 0 → 通过；payload `hours=C−H` 可为 0；`validateManualHours` 接受 0。
- **草稿**：`handleSaveDraft:354` 整行快照 → 若行值为累计则草稿存累计；服务端 `normalizeSavedRows` 透传 → 恢复时再加 H 重复。
- **再次打开**：`loadCarryOverRows:191` 有记录/草稿即返回 `[]`，前端行无 `_carry_over`。

## 规则补全（R2）

| 编号 | 规则 |
| --- | --- |
| R2-1 持久化统一为增量 | DB、草稿 `draft_data`、提交 payload 中 `hours` 一律为**当前周期增量**；仅前端行内 `hours` 为累计显示值。转换点固定 3 处：提交 payload、草稿 payload、页面总数/预估（`totalHours`、`summarizeWorkHours`、`summarizeDraftWeightedHours` 输入）。 |
| R2-2 历史常返 | GET `/fill/:token`（system+legacy）新增 `carry_over_history: [{ requirement_title, version, previous_hours, previous_progress, source_task_id, source_task_title, source_week_number, source_task_end_date, history_weeks:[{task_id, week_number, task_title, hours}] }]`，**不论当前任务是否已有记录/草稿**都返回；`carry_over_records` 触发条件不变（仍仅空时）。数据来自 `buildCarryOverRows` 同一分组（最新更早进度 0~99 已知），`previous_hours`＝该组所有更早任务记录 `hours` 之和（含 0h 记录），`history_weeks` 按任务 end_date 升序。 |
| R2-3 挂接范围 | 前端为三类行挂接 `_carry_over`（含 `previous_hours/history_weeks`）：① 服务端带出行；② 当前任务本人已提交记录中 `(title.trim(), version.trim())` 与 `carry_over_history` 匹配者；③ 草稿恢复行（已带 `_carry_over` 者刷新数值；未带者按 ② 匹配）。**手工新增、Excel 导入、文本识别行不自动挂接**（D2），其输入即为本周增量，统计仍按分组累加。 |
| R2-4 显示值 | 行显示值 `C = 增量 + H_eff`；`H_eff = isCarryOverModified(row) ? 0 : previous_hours`（标题/版本脱钩后视为新需求，不减历史）。带出行初始增量 0 → 显示 H（上次累计），代替 REQ-070 D3 的留空。 |
| R2-5 下限与恢复 | `el-input-number` 对挂接行 `:min="0"`（不用组件夹取），`@change`：`v < H_eff` → 恢复 `row._last_valid_hours`（初值 C）并 `ElMessage.warning('累计工时不能小于此前周期已填 Hh')`；`v ≥ H_eff` → 接受并更新 `_last_valid_hours`。`v === H_eff` 合法（本周增量 0）。 |
| R2-6 提示 | 挂接且 `H_eff>0` 的行，工时单元格下方 `.fill-hours-breakdown`：`含 <橘>第36周 10h</橘> + 第37周（本周）5h`；多周：`含 <橘>第35周 6h</橘>、<橘>第36周 4h</橘> + 本周 5h`。脱钩行不显示。 |
| R2-7 总数 | "工时总计"＝Σ增量；当 Σ`H_eff`>0 时旁侧小字：`不含此前周期已填 10h（第36周）`。预估加权/应交付进度同样用增量。 |
| R2-8 服务端防线 | `hours<0` 已 400（`validateManualHours`）。新增：submit/draft 若行带 `cumulative_hours`（前端发送 C）且能匹配本人历史组，则校验 `|cumulative_hours − previous_hours − hours| ≤ 0.005`，不符 400 `累计工时与历史不一致`；无 `cumulative_hours` 的旧客户端/导入不校验。 |
| R2-9 五类行 | REQ-071 纳入带出的五类 <100 行遵循同一累计口径。 |

## 测试用例

| 用例 | 输入/预期 |
| --- | --- |
| CH2-P-001 | `buildCarryOverRows`：W35 `X V1 6h 50%`、W36 `X V1 4h 70%` → 一行，`previous_hours=10`，`history_weeks=[{35,6},{36,4}]`，`previous_progress=70`。 |
| CH2-P-002 | 组内含 0h 记录 → 计入周明细（`0h`）但 `previous_hours` 不变。 |
| CH2-P-003 | 最新更早进度 100 / null / 无版本 → 不在 `carry_over_history`。 |
| CH2-A-001 | 当前任务已有记录时 GET：`carry_over_records=[]` 且 `carry_over_history` 非空。 |
| CH2-A-002 | submit `hours=5, cumulative_hours=15`，历史 10 → 200；`hours=7, cumulative_hours=15` → 400；无 `cumulative_hours` → 200（兼容）。 |
| CH2-A-003 | submit `hours=-1` → 400（既有）。 |
| CH2-U-001 | 带出行显示 10、min 0；输入 8 失焦 → 恢复 10 + 警告；输入 10 → 增量 0；输入 15 → 增量 5、提示"含第36周 10h + 第37周（本周）5h"。 |
| CH2-U-002 | 改标题 → 提示消失、显示值变为增量（5）、"已修改"标签；改回 → 恢复累计显示。 |
| CH2-U-003 | 暂存后刷新 → 显示仍 15（草稿存 5，恢复 +10）。 |
| CH2-U-004 | 总计显示 5h + 小字"不含此前周期已填 10h（第36周）"。 |
| CH2-U-005 | 手工新增 `X V1` 同名行 → 不挂接、无提示、min 0.01。 |

## 反哺

- R2-4 显示 H 而非留空：带出行若用户不动即提交，会写入 `0h/70%` 记录；需在 R3 决定"未改动的带出行是否提交"（D3）。
- 历史工时 `previous_hours` 应否只统计**有效版本且非脱钩**的记录：分组键已含 version，无需再筛。
- 同周同组两行各自减 H → 双减；R3 定义"同组仅首行挂接，其余按新行"（D4）还是提示禁止。
- legacy 链接 `link.task` 固定任务：历史范围＝`start_date` 早于该任务的任务，与 system 一致 → R3 确认。
- 统计详情/导出中每条记录 `hours` 为增量，用户在统计侧看到 W37 5h 是否会误解 → R3 文案（不改统计代码，仅在需求文档说明）。
