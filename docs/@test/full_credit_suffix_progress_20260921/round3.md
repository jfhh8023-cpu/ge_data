# REQ-071 第3轮：接线细化 — 改动点、文案、脚本更新、回滚

2026-09-21；设计审查，运行 NOT RUN。反哺来源：FC2-V-001、FC2-T-001、R2 反哺列表。

## 改动点（最小范围）

### 后端

| 文件 | 改动 |
| --- | --- |
| `services/EffectiveHoursService.js` | `isFullCreditRecord` 改后缀识别（剥尾部非汉字 + 繁→简 + endsWith）；`normalizeFullCreditRecord` 保留 `delivery_progress`（空→100）、新增 `options.allowedVersions` 沿用；新增 `fullCreditProgress(value, label)`；导出 `TRADITIONAL_MAP` 不必要，内部即可。 |
| `services/DeliverySummaryService.js` | `buildDeliverySummary`：五类进入分组（version 恒有效），加权 = 工时 × (最新进度 ?? 100)/100，新增 `fullCreditWeightedHours`，`requirementProgress` 改减该值；`buildCarryOverRows` 去掉五类排除；`DELIVERY_FORMULA` 文案。 |
| `routes/fill.js` | `validateDeliveryProgress` 五类分支：`fullCreditProgress`；submit/draft 前查询本人五类 `(title, version)` 集合传入 `normalizeSavedRows` → `normalizeFullCreditRecord`。 |
| `routes/records.js` | POST/PUT/import 三处 `isFullCreditRecord ? null : ...` → `fullCreditProgress(...)`。 |
| `routes/stats.js` | 读时五类 `delivery_progress` = `normalizeProgress ?? 100`；`progress_status` 走通用分支。 |

### 前端

| 文件 | 改动 |
| --- | --- |
| `utils/effectiveHours.js` | `isFullCreditRecord` 同后端；`initializeSpecialRow`/`syncSpecialRow` 进度 null→100（带出 0 例外）、带出行沿用 `vYYMMDD`；`isValidSubmittedProgress` 五类走合法集合；`summarizeDraftWeightedHours` 五类 × 进度；`FULL_CREDIT_NOTE` 文案。 |
| `utils/deliverySummary.js` | `groupRequirementProgress` 纳入五类（标记 `fullCredit`，进度 null→100）；`summarizeDelivery` 拆分五类加权；`DELIVERY_NOTE`/`deliveryMetricTip` 文案。 |
| `utils/progress.js` | `WEIGHTED_PROGRESS_TIP` 末句文案。 |
| `views/FillPage.vue` | 进度列五类改为下拉；payload 进度不再置 null；提交后 `_original_progress_missing` 逻辑不变。 |
| `views/StatsPage.vue` | 两处提示文案。 |

## 文案统一

"请假、培训、公司会议、出差、团建（含以其结尾的标题）：工时手填，版本自动锁定 vYYMMDD，进度默认100%可编辑；有效已交付全额计入，加权交付按填报进度计入；历史空进度按100%。"

## 提交路径版本沿用查询

仅当提交/草稿行中存在五类且 `existing_record_id` 为空的行时，`Model.findAll({ where: { staff_id }, attributes: ['requirement_title','version'] })`，过滤五类，构建 `Set("title\u0000version")`。system/legacy 两分支相同；产品经理模型同。

## 既有脚本更新（不弱化，改为新预期）

- `verify_effective_hours_fill.mjs`：新增后缀/繁体/字母用例；五类进度断言 null → 100/保留。
- `verify_effective_hours_stats.mjs` FC "five categories empty/versioned count once"：加权仍 = 10（null→100）；新增五类 40% 用例。
- `verify_effective_hours_backend.js`：五类 null 断言 → 100；`allowedVersions` 沿用用例。
- `verify_carry_over_rules.js`：E 五类改为"五类 <100 带出、null 不带出"。
- 新增 `verify_full_credit_suffix.js`：识别矩阵 + `fullCreditProgress` + `normalizeFullCreditRecord` 版本沿用 + `buildDeliverySummary` 五类加权。

## 用例

| 用例 | 内容 |
| --- | --- |
| FC3-A-001 | fill submit 五类行 `{title:'张三请假', hours:8}` 无进度 → DB 100、版本今日。 |
| FC3-A-002 | 同上 `delivery_progress: 40` → 40。 |
| FC3-A-003 | 五类行 `delivery_progress: 5` → 400。 |
| FC3-A-004 | 带出五类行携带上周版本 → 沿用；伪造版本 → 今日。 |
| FC3-U-001 | 填写页输入 `张三请假` → 版本自动、PM 不适用、进度 100 可改。 |
| FC3-U-002 | 五类 40 提交后统计"查看未完成"列出该行；下周带出。 |
| FC3-U-003 | 历史任务五类 null 行编辑模式显示 100。 |
| FC3-I-001 | Excel 导入五类无进度 → 100；文本识别五类行 → 100。 |
| FC3-E-001 | revert 单提交后构建通过；DB 无结构变更。 |

## 反哺

- FC3-U-003：编辑历史五类 null 行并提交 → 会把 null 写成 100（用户可见默认值即所提交值），可接受；不做 `_preserveOriginalProgress` 特例，简化。
- 统计中五类 `missingProgress` 永不成立（null→100），进度覆盖率不含五类，一致。
- `MatchService` 五类键含精确标题，后缀标题各自独立键，不合并，符合"一天一次"语义。
