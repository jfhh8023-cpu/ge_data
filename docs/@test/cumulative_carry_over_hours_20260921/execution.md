# REQ-072 实际执行记录

2026-09-21 18:25–19:05（北京时间）。本地 backend 3001（preload 暂停自动通知）+ vite 5176，本地 MariaDB 镜像库。开发前备份提交 `471938c`（含四轮文档）已推三远端。决策 D1~D6 按授权采用默认。

## 结果总览

| 编号 | 结果 | 证据 |
| --- | --- | --- |
| CH4-P-001~004 | PASS 11/11 | `node backend/scripts/verify_carry_over_rules.js`（B 组 previous_hours 16 = 第35周 8h + 第36周 8h；0h 记录入明细；`"4.50"` 解析、`"abc"` 按 0） |
| CH4-A-001~009 | PASS | `verify_effective_hours_backend.js`：GET 有记录时 `carry_over_records=[]`、`carry_over_history` 仍含 previous_hours 10（排除当前任务）；legacy 同；submit `hours 5/cumulative 15` 200、`7/15` 400 且原记录不变、`0/10/100%` 200 后下一周不再带出；无 `cumulative_hours` 或标题不匹配跳过校验；draft 同校验且 `draft_data` 不含 `cumulative_hours` |
| CH4-F-001~005 | PASS 5/5 | `verify_carry_over_hours_frontend.mjs` |
| CH4-S-001 | PASS | `verify_effective_hours_stats.mjs` 17/17：10/70 + 5/80 + 3/100 → 累计 18h、进度 100；仅前两周 15h/80；0h 周使组进度 100、累计仍 10，前后端一致 |
| CH4-U-001 | PASS | fixture `B需求 V1.1`（第35周 8h/100 → 第36周 8h/40）带出：工时框 16、标签"第36周未完成 · 上次进度 40%"、下方"含第35周 8h、第36周 8h（橘色）+ 第37周（本周） 0h"；总计 0h + 小字"仅含本周期工时，不含此前周期已填 32h（第35周、第36周）"（三行合计） |
| CH4-U-002 | PASS | 输入 8 失焦 → 恢复 16，警告"累计工时不能小于此前周期已填 16h，已恢复为 16h" |
| CH4-U-003 | PASS | 输入 21、进度 80 → 提示"…+ 第37周（本周） 5h"，总计 5h；`evidence/fill-cumulative-1920.png` |
| CH4-U-004 | PASS | 暂存：服务端 `draft_data.hours=5`、无 `cumulative_hours`；刷新后显示 21、提示不变 |
| CH4-U-005 | PASS | 提交 payload `[B需求, hours 5, cumulative_hours 21, 80]` 200；刷新后记录行显示 21、提示与总计 5h 不变 |
| CH4-U-006 | PASS（口径微调） | 改标题 → 历史提示消失、标签追加"（已修改，将作为新需求统计，工时按当前值全额计入本周）"；**显示数字保持 21 不自动改为 5**（避免静默改写用户输入，R4 原文"显示 5"据此更正）；改回 → 恢复累计提示 |
| CH4-U-007 | PASS（按 D2） | 手工新增同名同版本行不挂接、无提示、按本周工时；"同名同版本已在上方按累计填写"提示仅对服务端返回记录/草稿中的第二行生效 |
| CH4-U-008 | PASS | 输入 16（=历史）/100% 提交：payload `hours 0, cumulative_hours 16`；DB 第35周 8h/100、第36周 8h/40 不变，第37周 **0h/100**；`progress-details` 第37周行 0h 已完成 |
| CH4-U-009 | PASS | 390 宽：提示单行省略（`scrollWidth>clientWidth`，完整文本在 title），页面无横向溢出；`evidence/fill-cumulative-390.png` |
| CH4-S-002 | PASS | 既有脚本全通（fill.mjs 7/7、unfinished、carry_over_rules 11/11）；`vite build` 通过 |
| CH4-H-001 | PASS | fixture 清理后 880 条 / 11273.5h / 15 人，`work_records` sha `99255f2f05ea` 与本轮开发前完全一致 |

## 隔离 fixture

复用 `verify_carry_over_api.js` fixture（KEEP_FIXTURE=1），浏览器完成暂存/提交/0h 提交后 `CLEANUP_ONLY=1` 全部删除，remaining 0。

## 备注

- 统计代码未改；`progress-details`/导出中每行 `hours` 为该周期增量（D6）。
- 未部署生产。
