# REQ-072 第4轮：冻结用例矩阵

2026-09-21；设计冻结，运行 NOT RUN（实施后填 execution.md）。

## 纯函数（后端 `buildCarryOverRows`）— `verify_carry_over_rules.js` 扩展

| 编号 | 输入 | 预期 |
| --- | --- | --- |
| CH4-P-001 | W35 `X V1 6h 50%`、W36 `X V1 4h 70%` | 一行；`_carry_over.previous_hours=10`、`history_weeks=[{week 35, 6},{week 36, 4}]`、`previous_progress=70` |
| CH4-P-002 | 组含 W36 `0h 70%` | 明细含 `0`，`previous_hours` 不受影响 |
| CH4-P-003 | 字符串 hours `"4.50"`、非法 `"abc"` | 4.5 计入；非法按 0 |
| CH4-P-004 | 既有 CO4-D-001~003 | 不变 |

## 后端路由 — `verify_effective_hours_backend.js` 扩展 + fixture API

| 编号 | 输入 | 预期 |
| --- | --- | --- |
| CH4-A-001 | GET，当前任务已有记录 | `carry_over_records=[]`；`carry_over_history` 含 `X V1 previous_hours=10` |
| CH4-A-002 | GET，无记录无草稿 | `carry_over_records` 与 `carry_over_history` 同组 |
| CH4-A-003 | submit `{title X, version V1, hours 5, cumulative_hours 15, progress 80}`，历史 10 | 200，DB 5h/80 |
| CH4-A-004 | submit `hours 7, cumulative_hours 15` | 400 "累计工时与历史不一致" |
| CH4-A-005 | submit `hours 0, cumulative_hours 10, progress 100` | 200，DB 0h/100；再 GET 历史仍 10；下周 `buildCarryOverRows` 不再带出 |
| CH4-A-006 | submit 无 `cumulative_hours`（旧客户端/导入） | 不校验，200 |
| CH4-A-007 | submit `cumulative_hours` 但标题不匹配任何历史组 | 忽略校验，200 |
| CH4-A-008 | draft 含 `cumulative_hours` | 保存后 `draft_data` 行不含该字段 |
| CH4-A-009 | legacy 链接 GET | 同样返回 `carry_over_history` |

## 前端纯函数 — `verify_effective_hours_fill.mjs` 扩展（`utils/carryOverHours.js`）

| 编号 | 输入 | 预期 |
| --- | --- | --- |
| CH4-F-001 | `effectivePreviousHours(row)`：挂接 10、未脱钩 | 10；脱钩（标题改）→ 0 |
| CH4-F-002 | `periodHours(row)`：显示 15、H 10 | 5；显示 10 → 0；显示 8 → 负数（由 UI 拒绝） |
| CH4-F-003 | `attachCarryOverHistory(rows, history)` | 匹配行获得 `_carry_over`；同组第二行不挂接且 `_carry_over_duplicate=true`；不匹配不变 |
| CH4-F-004 | `hoursBreakdownText(row, currentWeek)` | `含第36周 10h + 第37周（本周）5h`；多周逐周；H=0 → '' |
| CH4-F-005 | `summarizeDraftWeightedHours(periodRows)` | 用增量计算 |

## 浏览器（FillPage，1920 与 390）

| 编号 | 步骤 | 预期 |
| --- | --- | --- |
| CH4-U-001 | fixture W36 `X V1 10h 70%`，打开 W37 | 带出行工时框显示 10，进度 70，标签"第36周未完成 · 上次进度 70%"，下方"含第36周 10h（橘）+ 第37周（本周）0h" |
| CH4-U-002 | 输入 8 失焦 | 恢复 10，警告"累计工时不能小于此前周期已填 10h" |
| CH4-U-003 | 输入 15 失焦、进度 80 | 提示变 "…+ 第37周（本周）5h"；总计 5h，小字"不含此前周期已填 10h（第36周）" |
| CH4-U-004 | 暂存 → 刷新 | 显示 15、提示不变 |
| CH4-U-005 | 提交 → DB W37 5h/80 → 刷新 | 记录行显示 15、提示不变、总计 5h |
| CH4-U-006 | 改标题为 `X2` | 显示 5（增量）、无历史提示、"已修改"标签；改回 → 15 |
| CH4-U-007 | 手工新增 `X V1` 第二行 | 不挂接；显示"同名同版本已在上方按累计填写" |
| CH4-U-008 | 输入 10/100% 提交 | DB 0h/100；统计累计 10h、100%；未完成列表不含 X |
| CH4-U-009 | 390 宽 | 提示单行省略不溢出 |

## 一致性/回归

| 编号 | 预期 |
| --- | --- |
| CH4-S-001 | `verify_effective_hours_stats.mjs`：W36 10h/70 + W37 5h/80 + W38 3h/100 → 累计 18h、进度 100；仅选 W36~W37 → 15h、80 |
| CH4-S-002 | 既有全部脚本通过；`vite build` 通过 |
| CH4-H-001 | 清理 fixture 后 8 表指纹与开发前一致 |
