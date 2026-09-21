# REQ-071 冻结开发测试计划

2026-09-21。最小影响范围（铁律 16）：零 DB 变更，识别与进度规则集中在两个服务/两个前端 util，路由仅改调用点。

## 1. 改动清单

后端：`services/EffectiveHoursService.js`（识别、`fullCreditProgress`、`normalizeFullCreditRecord` 保留进度 + `allowedVersions`）、`services/DeliverySummaryService.js`（五类入分组加权、带出纳入、文案）、`routes/fill.js`（五类进度校验、版本沿用查询）、`routes/records.js`（三处进度调用）、`routes/stats.js`（读时 null→100、状态）。

前端：`utils/effectiveHours.js`、`utils/deliverySummary.js`、`utils/progress.js`（文案）、`views/FillPage.vue`（进度列下拉、payload）、`views/StatsPage.vue`（文案）。

脚本：新增 `backend/scripts/verify_full_credit_suffix.js`；更新 `verify_effective_hours_fill.mjs`、`verify_effective_hours_stats.mjs`、`verify_effective_hours_backend.js`、`verify_carry_over_rules.js` 至新预期。

## 2. 开发顺序

1. 开发前备份提交（四轮文档 + 当前代码状态）推三远端。
2. 后端纯函数 + `verify_full_credit_suffix.js`（FC4-M/P/S）→ 通过后进入 3。
3. 路由接线 + 既有后端脚本更新（FC4-A）。
4. 前端 util + FillPage/Stats + 前端 mjs 脚本更新 + `vite build`。
5. 本地启动 + 浏览器验证（FC4-U、FC4-I）、指纹核对（FC4-H）。
6. 归档 execution/development，提交推三远端，启动本地供用户测试。

## 3. 验收映射

见 `docs/@test/full_credit_suffix_progress_20260921/round4.md` 覆盖映射。

## 4. 回滚

`git revert` 单提交；无迁移无回填。通过新规则提交的五类记录为本人确认数据，不回滚。
