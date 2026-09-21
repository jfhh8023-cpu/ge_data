# REQ-071 第2轮：规则收敛 — 识别边界、版本沿用、进度切换

2026-09-21；设计审查，运行 NOT RUN。反哺来源：FC1-M-002、FC1-C-001、FC1-P-001。

## 第1轮反哺落实

1. **识别边界（D1 默认）**：尾部"非汉字"一律忽略——数字、ASCII/全角标点、引号、括号、空白、**英文字母**均剥离；随后归一繁体、`endsWith`。`请假abc` 命中；`请假申请开发` 不命中（末尾汉字为"开发"）。汉字范围：`\u4e00-\u9fff`、`\u3400-\u4dbf`。
2. **五类带出行版本沿用**：`normalizeFullCreditRecord(record, previous, now, { allowedVersions })`——当无已存原记录、客户端版本形如 `vYYMMDD`、且该 `(标题, 版本)` 存在于**本人已保存的五类记录**中（服务端查询）时沿用；否则按今日重生成。REQ-064 "日期只能来自服务端已存数据"原则保持：客户端只能**选择**已存在的版本，不能伪造。
3. **进度切换**：标题由普通改为五类 → 备份普通字段，进度置 100；由五类改回普通 → 恢复备份。已存/草稿/带出的五类行按其自身进度初始化，null → 100（带出行 `previous_progress=0` 的 null 保留为空）。
4. **历史 null 展示（D2 默认）**：统计/任务详情读到五类 null 进度显示 `100%`（默认值口径，与加权计算一致），状态"已完成"；DB 不回填。
5. **需求进度平均与需求总数**：五类**不参与** `requirementProgress`/`progressCoverage`/需求总数（保持现状）；仅参与加权交付率、未完成列表、带出。
6. 写入：`fullCreditProgress(value)`——空 → 100；显式值须 ∈ {1,10,…,100}，否则 400；用于 fill 提交/草稿、records POST/PUT/import。

## 用例

| 用例 | 输入/预期 |
| --- | --- |
| FC2-M-001 | `请假abc`、`请假ABC 12`、`出差（2）`、`团建!!!` → 命中；`出差（北京）` 不命中（末尾汉字为"北京"）。 |
| FC2-M-002 | `请假开发`、`abc`、`123`、`“”` → 不命中。 |
| FC2-M-003 | 繁体混排 `張三公司會議`、`培訓` → 命中；`公司会` 不命中。 |
| FC2-V-001 | 上周 `张三请假 v260914 40%` 带出，提交时客户端版本 `v260914` → 服务端沿用 `v260914`，DB 同组。 |
| FC2-V-002 | 客户端伪造 `v250101`（本人历史不存在） → 按今日日期。 |
| FC2-V-003 | 编辑已存五类记录 → 版本仍沿原记录（原逻辑）。 |
| FC2-T-001 | 行标题 `需求A` 进度 40 → 改 `需求A请假` → 进度 100、版本自动；改回 `需求A` → 进度 40 恢复。 |
| FC2-T-002 | 五类行选 0%？下拉无 0；历史 0 保留只读选项不变。 |
| FC2-R-001 | stats 读五类 null → `delivery_progress:100`、`progress_status:已完成`；DB 仍 null。 |
| FC2-R-002 | 五类 40 → 状态"部分完成"。 |
| FC2-W-001 | records PUT 五类记录 `delivery_progress: 50` → 50；`""` → 100；`5` → 400。 |
| FC2-S-001 | 需求总数不含五类；requirementProgress 不含五类；加权含五类×进度。 |

## 反哺

- FC2-V-001 需要提交路径多一次按 `staff_id` 查询本人五类记录 → R3 定义查询范围与成本（仅五类行存在时查询）。
- FC2-T-001 前端 `syncSpecialRow` 现把进度置 null → 改置 100；`isValidSubmittedProgress` 五类分支需改为合法集合校验。
- 前端 `FillPage.vue` 进度列五类显示"不适用" → 改为下拉；PM/需求方列保持"不适用"。
- 统计口径文案（`DELIVERY_FORMULA`、`DELIVERY_NOTE`、`WEIGHTED_PROGRESS_TIP`、`FULL_CREDIT_NOTE`、StatsPage 提示）需同步"五类按填报进度（默认100%）加权" → R3 列清单。
- 既有脚本 `verify_effective_hours_fill.mjs`、`verify_effective_hours_stats.mjs`、`verify_effective_hours_backend.js`、`verify_carry_over_rules.js` 中"五类进度为 null / 五类不带出"断言需按新规约更新（不弱化，改为新预期）→ R3。
