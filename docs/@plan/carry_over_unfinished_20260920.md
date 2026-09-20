# REQ-070 冻结开发测试计划

2026-09-20。状态：待用户确认冻结需求与 D1/D2/D3 后执行。最小影响范围（铁律 16）：**三个文件、零 DB 变更、零统计改动**。

## 1. 改动清单

| 文件 | 改动 |
| --- | --- |
| `backend/src/services/DeliverySummaryService.js` | 新增纯函数 `buildCarryOverRows(records, tasksById, currentTask, { mode })`，复用 `groupKey`/`isLater`/`hasValidVersion`；导出。 |
| `backend/src/routes/fill.js` | `GET /:token`：system 与 legacy 分支在 `records.length===0 && !draft_records` 时，按 `staff_id` 一次 `findAll` 本人记录 + 相关任务，调用上述函数，响应 `data.carry_over_records`（否则 `[]`）。 |
| `frontend/src/views/FillPage.vue` | onMounted 初始化新增第三优先级：`carry_over_records` 非空 → `normalizeRows(list, { newRows: true })` 并附 `_carry_over`；标题列下方标签；进度 0 → null；`handleSubmit`/草稿 payload 不含私有字段（核对白名单）。 |

## 2. 开发顺序（铁律 4，做一个完一个）

1. 纯函数 + 单测脚本 `backend/scripts/verify_carry_over_rules.js`（CO4-D-001~003）→ 通过后进入 2。
2. 路由接线 + 隔离 API 验证脚本（CO4-A-001~004，本地库只读 + 内存 fixture）→ 通过后进入 3。
3. 前端回显 + 浏览器验证（CO4-U-001~006，Playwright 拦截写请求；1920/390px 截图）。
4. 统计与历史核验（CO4-S-001、CO4-H-001：提交前后 8 表只读指纹）。
5. 导入/导出/权限回归（CO4-I-001、CO4-P-001）；构建 `vite build` 通过。

## 3. 验收映射

| 验收 | 用例 |
| --- | --- |
| 候选规则/空值零值/历史 | CO4-D-001~003 |
| API 双链接双角色 | CO4-A-001~004 |
| UI 回显/标签/删除/草稿/历史模式 | CO4-U-001~006 |
| 统计不变与按 100 计 | CO4-S-001 |
| 历史数据不变 | CO4-H-001 |
| 权限/导入导出 | CO4-P-001、CO4-I-001 |
| 回滚 | CO4-E-001 |

## 4. 回滚

`git revert` 单次提交即可；无迁移、无数据回填。通过带出行提交的记录为本人确认的正常业务数据，不回滚。

## 5. 归档

执行：`docs/@test/carry_over_unfinished_20260920/execution.md`；开发：`docs/@development/carry_over_unfinished_20260920.md`；与代码同一 commit 推送三远端（铁律 15）。不部署生产，除非用户另行下达发版指令。
