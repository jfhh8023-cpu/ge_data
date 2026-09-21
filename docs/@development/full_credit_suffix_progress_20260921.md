# REQ-071 开发记录：五类工时后缀识别与可编辑进度

2026-09-21。冻结需求 `docs/@demand/full_credit_suffix_progress_20260921.md`；执行记录 `docs/@test/full_credit_suffix_progress_20260921/execution.md`。无 DB 结构变更，无迁移，未部署生产。开发前备份 `eb9627d`。

## 改动文件

| 文件 | 内容 |
| --- | --- |
| `backend/src/services/EffectiveHoursService.js` | `fullCreditCategoryOf`/`isFullCreditRecord`：trim → 剥尾部非汉字（`/[^\u3400-\u4dbf\u4e00-\u9fff]+$/u`）→ 繁体归一（請訓會議團）→ `endsWith` 五词组。新增 `fullCreditProgress`（空→100，非法 400）、`fullCreditVersionKey`、`FULL_CREDIT_DEFAULT_PROGRESS`。`normalizeFullCreditRecord` 保留进度（空→100），新增 `options.allowedVersions`：无已存原记录时，客户端 `vYYMMDD` 仅在本人已保存同标题同版本时沿用。 |
| `backend/src/services/DeliverySummaryService.js` | 五类进入 `(staff, version, title)` 分组；加权 = 工时×(最新进度 ?? 100)/100；新增 `fullCreditWeightedHours`，`requirementProgress` 改减该值；`buildCarryOverRows` 纳入五类；`DELIVERY_FORMULA` 文案。 |
| `backend/src/routes/fill.js` | `validateFullCreditProgress` 用于研发/AI产品两条校验链；`loadFullCreditVersions(Model, staffId, rows)` 仅当存在无 `existing_record_id` 且带 `vYYMMDD` 的五类行时查询一次；submit/draft（system+legacy）传入 `normalizeSavedRows`。 |
| `backend/src/routes/records.js` | POST/import 五类 `fullCreditProgress`；PUT 未传进度且原为五类时保留原值（含历史 null），传值则校验。 |
| `backend/src/routes/stats.js` | `buildProgressDetails` 五类 null 读作 100、状态走通用分支。 |
| `frontend/src/utils/effectiveHours.js` | 同规则识别；`initializeSpecialRow` null→100（带出上次 0 例外）、带出行沿用 `vYYMMDD`；`syncSpecialRow` 转五类置 100；`isValidSubmittedProgress` 五类须合法值；`summarizeDraftWeightedHours` 五类×进度；`FULL_CREDIT_NOTE`。 |
| `frontend/src/utils/deliverySummary.js` | `groupRequirementProgress` 纳入五类（`fullCredit` 标记，null→100）；`summarizeDelivery` 拆分 `fullCreditWeightedHours`；文案。 |
| `frontend/src/utils/progress.js`、`views/FillPage.vue` | 文案；进度列五类改为下拉（title 提示）；payload 不再置 null。 |
| 脚本 | 新增 `verify_full_credit_suffix.js`、`verify_full_credit_unfinished.mjs`、`inspect_recent_work_records.js`（只读）；更新 `verify_effective_hours_backend.js`、`verify_effective_hours_fill.mjs`、`verify_effective_hours_stats.mjs`、`verify_carry_over_rules.js` 至新预期。 |

## 未改动（有意）

需求总数/需求进度平均/进度覆盖率排除五类（D4）；`MatchService` 五类独立键；PM/需求方对五类仍不适用；权限与离职拦截。

## 回滚

`git revert <commit>`；业务库无需回滚。

## 验证命令

```
node backend/scripts/verify_full_credit_suffix.js
node backend/scripts/verify_full_credit_unfinished.mjs
node backend/scripts/verify_effective_hours_backend.js
node backend/scripts/verify_effective_hours_fill.mjs
node backend/scripts/verify_effective_hours_stats.mjs
node backend/scripts/verify_carry_over_rules.js
cd frontend && npx vite build
```
