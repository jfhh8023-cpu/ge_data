# REQ-072 第3轮：集成、回归与决策收敛

2026-09-21；设计审查，运行 NOT RUN。承接 R2 反哺。

## 决策收敛（默认按"四轮后执行"授权采用）

| 编号 | 问题 | 默认（采用） | 备选 | 依据 |
| --- | --- | --- | --- | --- |
| D1 | 累计口径的入库表示 | **每周存增量**，前端显示累计（R2-1） | 每周存累计、统计取最新 | 用户"计算总数的时候将此前工时减去"；REQ-066 统计代码不改；历史记录不变 |
| D2 | 手工新增/导入/识别的同名同版本行 | **不挂接**历史（按本周增量） | 自动挂接 | 导入文本中的工时天然是本周数；避免误减致负数 |
| D3 | 带出行未改动（增量 0、进度不变）是否提交 | **提交**，写入 `0h/上次进度` | 前端静默过滤 | 用户要求"已回显可继续填写"、"本周 100%+10h → 存 0h"必须允许 0h；未改动的 0h 记录对统计无影响（累计不变、进度不变），且可让用户在历史中看到"本周仍在进行" |
| D4 | 同周同组多行 | **仅第一行**（按行序）挂接历史，其余按新行处理，并在其余行显示"同名同版本已在上方按累计填写" | 阻止提交 | 不阻断用户；避免双减 |
| D5 | 服务端一致性校验 | 前端发送 `cumulative_hours`，服务端匹配历史组时校验差值（R2-8） | 不校验 | 用户"即使任意修改也不改变逻辑"，服务端兜底防旧缓存/篡改 |
| D6 | 统计侧记录明细文案 | 不改统计代码；`progress-details`/导出行内 `hours` 即该周期增量，需求累计在"查看未完成"/加权口径已按分组累加 | 加列 | 最小改动 |

## 集成点核对

- `normalizeSavedRows`（`fill.js:157`）对未知字段透传：`cumulative_hours` 会进入 `draft_data`，需在 `normalizeSavedRows` 输出剔除（避免草稿携带）；`replaceSavedRecords` 显式字段建表，不受影响。
- `MatchService`、`WorkloadReportService`、Excel 导出读取 `hours` 为周期值，无变化。
- REQ-069 未完成列表 `group.hours` 累计仍正确（增量累加）。
- legacy 链接：`link.task` 为固定任务，`loadCarryOverRows(Model, link.staff_id, link.task, …)` 已用，`carry_over_history` 同路径返回。
- 历史任务编辑模式（`/fill/:token/task/:taskId/records`）：不带出、不挂接（历史"更早"定义相对当前任务，编辑旧任务时口径混乱），保持 REQ-070 行为。
- 权限/离职拦截、五类版本锁定（REQ-064/071）不受影响：`hours` 转换在校验前完成。

## 回归用例

| 用例 | 预期 |
| --- | --- |
| CH3-G-001 `verify_carry_over_rules.js` | 既有 9 例 + `previous_hours/history_weeks` 断言全通。 |
| CH3-G-002 `verify_effective_hours_backend.js` | 全通；新增 `cumulative_hours` 一致/不一致/缺省三例。 |
| CH3-G-003 `verify_effective_hours_stats.mjs` | 全通；新增 W36 10h/70 + W37 5h/80 + W38 3h/100 → 累计 18h、进度 100；仅选 W36~W37 → 15h、80。 |
| CH3-G-004 `verify_effective_hours_fill.mjs` | 新增前端纯函数：`displayHours/periodHours/effectivePreviousHours`、脱钩为 0、同组第二行不挂接。 |
| CH3-G-005 隔离 fixture API | REQ-070 fixture：GET 含 `carry_over_history`；submit 15/80 → DB 5h；再 GET 记录行匹配历史；submit 10/100（增量 0）→ DB 0h/100；下周不再带出。 |
| CH3-G-006 浏览器 | CH2-U-001~005 + 移动 390 宽提示不溢出（`.fill-carry-over-tag` 已 ellipsis，同样式）。 |
| CH3-G-007 指纹 | 清理 fixture 后 8 表指纹与本轮开发前一致（允许用户本人 18:13 的 2 条改动）。 |

## 反哺

- D3 采用"提交 0h"后，`handleSubmit` 的 `row.hours > 0` 过滤对**无历史**行仍需保留（空行不提交），对挂接行改为 `C ≥ H_eff` → 需在 R4 用例中明确"挂接行 C=H 且进度未改 → 提交 0h"。
- `cumulative_hours` 仅对挂接行发送；服务端"能匹配历史组"以 `(staff, title.trim(), version.trim())` 匹配 `buildCarryOverRows` 输出。
- 文案统一："此前周期"指所有更早任务；示例用"第36周"。
