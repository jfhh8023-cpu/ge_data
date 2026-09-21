# REQ-072 开发记录：跨周需求累计工时口径

2026-09-21。冻结需求 `docs/@demand/cumulative_carry_over_hours_20260921.md`；执行记录 `docs/@test/cumulative_carry_over_hours_20260921/execution.md`。无 DB 结构变更，无迁移，未部署生产。开发前备份 `471938c`。

## 改动文件

| 文件 | 内容 |
| --- | --- |
| `backend/src/services/DeliverySummaryService.js` | `buildCarryOverRows` 按组累加更早任务 `hours`（`nonNegativeHours`，含 0h）→ `_carry_over.previous_hours`、`history_weeks[{task_id, task_title, week_number, end_date, hours}]`（end_date 升序） |
| `backend/src/routes/fill.js` | `loadCarryOverRows` → `loadCarryOverContext`：`carry_over_records`（仅空时）+ `carry_over_history`（常返），system/legacy GET 均返回；`validateCumulativeHours`（D5）用于 submit 与 draft（system/legacy）；`normalizeSavedRows` 剔除 `cumulative_hours` |
| `frontend/src/utils/carryOverHours.js`（新） | `isCarryOverModified`、`effectivePreviousHours`（脱钩/重复→0）、`periodHours`、`toPeriodRows`、`attachCarryOverHistory`（首行挂接、其余 `_carry_over_duplicate`、存量增量→累计显示）、`hoursBreakdown`、`excludedPreviousHours` |
| `frontend/src/views/FillPage.vue` | `normalizeRows(...,{history})` 对草稿/记录/带出行挂接；`handleHoursChange` 下限恢复；`periodRows` 驱动总计/应交付预估/加权预估；提交与草稿 payload `hours=periodHours`、挂接行附 `cumulative_hours`；工时列表头提示、`:min` 动态、单元格下方橘色明细、总计小字；标签补充脱钩/重复文案；样式 `.fill-hours-breakdown/.fill-hours-previous/.fill-hours-excluded` |
| 脚本 | 新增 `verify_carry_over_hours_frontend.mjs`；扩展 `verify_carry_over_rules.js`、`verify_effective_hours_backend.js`（真实 `buildCarryOverRows`、`Op.ne`、`CollectionTask.findAll`、task `toJSON`）、`verify_effective_hours_stats.mjs` |

## 未改动（有意）

统计口径与代码（D6）；历史任务编辑模式；Excel/识别/手工新增行（D2）；`MatchService`、导出、权限、离职、五类版本锁定。

## 回滚

`git revert <commit>`；业务库无需回滚。

## 验证命令

```
node backend/scripts/verify_carry_over_rules.js
node backend/scripts/verify_carry_over_hours_frontend.mjs
node backend/scripts/verify_effective_hours_backend.js
node backend/scripts/verify_effective_hours_stats.mjs
node backend/scripts/verify_effective_hours_fill.mjs
cd frontend && npx vite build
```
