# REQ-072 冻结计划：跨周需求累计工时口径

2026-09-21。最小改动，无迁移，单 commit 可 revert。开发前备份提交＝本文档提交。

## 改动清单

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 后端 | `services/DeliverySummaryService.js` `buildCarryOverRows` | `_carry_over` 增加 `previous_hours`（组内更早记录 hours 之和）与 `history_weeks`（按 end_date 升序） |
| 后端 | `routes/fill.js` | `loadCarryOverRows` 拆为 `loadCarryOverContext` → `{ carry_over_records, carry_over_history }`；GET system/legacy 返回 `carry_over_history`；`normalizeSavedRows` 剔除 `cumulative_hours`；submit/draft 前 `validateCumulativeHours(rows, history)`（D5） |
| 前端 | `utils/carryOverHours.js`（新） | `effectivePreviousHours`、`periodHours`、`attachCarryOverHistory`、`hoursBreakdown`、`toPeriodRows` |
| 前端 | `views/FillPage.vue` | 载入时挂接历史；工时列 `:min` 动态、`@change` 下限恢复；单元格下方提示；总计小字；提交/草稿 payload 用增量 + `cumulative_hours`；预估用增量行 |
| 脚本 | `verify_carry_over_rules.js`、`verify_effective_hours_backend.js`、`verify_effective_hours_fill.mjs`、`verify_effective_hours_stats.mjs`、`verify_carry_over_api.js` | 按 R4 扩展 |

## 步骤

1. 后端纯函数 + 脚本（CH4-P）。
2. 路由 GET/submit/draft + 脚本（CH4-A）。
3. 前端 util + 脚本（CH4-F）。
4. FillPage 接线，`vite build`。
5. 隔离 fixture API + 浏览器（CH4-U），截图归档。
6. 清理 fixture、指纹核对、文档（execution/development/requirements）、提交推送三远端。

## 回滚

`git revert`；业务库无需回滚（仅新增读路径与校验）。
