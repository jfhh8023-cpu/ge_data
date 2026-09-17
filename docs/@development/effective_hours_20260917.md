# REQ-064 有效工时与加权交付率开发记录

日期：2026-09-17。状态：本地实现与定向验收完成；未部署生产。

## 1. 需求与范围

依据用户“好了，可以按此并根据规约执行最小范围改动的开发”，将此前已确认的研究演示落地。先归档 REQ-064、冻结需求/计划与四轮设计反馈，再进入业务实现。四轮文档保留当时“运行未执行”的事实，实际结果另见[运行汇总](../@test/effective_hours_20260917/execution.md)。

工作开始时仓库已有大量历史任务未提交修改。本轮基于该状态实现，保留此前图表、列表、双页签、范围和数据同步成果；累计 Git 大差异不能全部解释为本轮新代码。提交包由主代理选择本轮修改及必要的既有功能依赖，排除部署交接敏感资料、数据库备份及无关修改。

## 2. 实现结果

- 五类完整标题“请假、培训、公司会议、出差、团建”统一归为有效工时，工时始终人工填写。标题精确识别后版本自动只读；中国日期 `vYYMMDD`，保存和重编辑保留首次版本，服务器忽略伪造日期版本。普通↔五类切换保留工时及普通输入草稿；导入/识别的新行使用当天自动版本，真实保存历史保留旧版。
- 五类不要求产品经理、需求方及进度，进度为不适用；工时一次性全额计入有效及加权指标。普通无版本只计原始工时。历史空进度维持 null，显式0有效；不做迁移或历史回填。
- 周期卡片及详情增加有效已交付、有效交付率、加权交付率、需求填报进度与覆盖率，每个数字独立显示公式 Tips。按同人/同版本/同标题累计、最新所选周期进度加权；缺进度显示“待补进度”，不展示部分和作为完整加权值。
- 当前离职人员排除全部历史统计；非离职人员只在筛选范围存在记录时出现。入选后按完整所选周期工作日容量，避免未填一周就错误缩小分母。空范围 personal/PM 身份和容量均为空；恢复非离职后使用原数据。
- 填写页两个预估指标采用紧凑两列，说明合并；桌面实测约88px。外卡不增加人员明细，弹窗继续上方摘要/人员、下方列表页签。1280px卡片改4列两排，图表起点由检查时约779px降至510px；手机上区允许滚动，人物与下方记录均可到达。
- 填报整批替换及批量导入使用事务，失败时回滚；保留旧记录 ID / 创建时间。前端与服务端 Excel 使用同有效/加权口径，保留普通无版本记录。

## 3. 主要代码触点

| 层级 | 文件 |
| --- | --- |
| 后端规则与统计 | `backend/src/services/EffectiveHoursService.js`、`DeliverySummaryService.js`、`WorkHoursCompletionService.js`、`PersonStatusService.js`、`MatchService.js` |
| 后端入口 | `backend/src/routes/fill.js`、`records.js`、`stats.js`、`tasks.js`、`report.js` |
| 前端规则 | `frontend/src/utils/effectiveHours.js`、`deliverySummary.js` 及其原统计工具调用 |
| 前端展示 | `frontend/src/views/FillPage.vue`、`StatsPage.vue`；`HoursCompletion.vue`、`DeliverySummary.vue`、`StatsHoursCard.vue`、`StatsCountsCard.vue`、`StaffDeliveryList.vue` 等现有统计组件 |
| 测试与归档 | `backend/scripts/verify_effective_hours_{backend,ui,fingerprint}.js`、`verify_effective_hours_{fill,stats}.mjs`、相关原回归脚本；本次需求、计划、四轮及执行证据 |

该表只描述本轮主要触点，不宣称所有这些文件都是本轮新建或全部内容均由本轮新增。

## 4. 已执行验证

| 命令 / 检查 | 真实结果 | 证据 |
| --- | --- | --- |
| `node backend/scripts/verify_effective_hours_backend.js` | 14场景通过；包含真实路由处理器内存执行、日期防伪、两种填报来源、历史null与事务故障回滚，不连接业务库写入 | [backend-focused.log](../@test/effective_hours_20260917/backend-focused.log) |
| `node backend/scripts/verify_delivery_summary.js` | 13场景通过 | [backend-delivery.log](../@test/effective_hours_20260917/backend-delivery.log) |
| `node backend/scripts/verify_work_hours_completion.js` | 最终31场景通过，含实际stats/export内存处理器及空范围身份null | [backend-capacity.log](../@test/effective_hours_20260917/backend-capacity.log) |
| `node backend/scripts/verify_effective_hours_fill.mjs` | 5组通过 | [frontend-fill.log](../@test/effective_hours_20260917/frontend-fill.log) |
| `node backend/scripts/verify_effective_hours_stats.mjs` | 7组通过，含跨周期最新null及同周期时间点比较 | [frontend-stats.log](../@test/effective_hours_20260917/frontend-stats.log) |
| `node backend/scripts/verify_effective_hours_ui.js` 与定向追加 | 数学、真实GET、页面、写请求拦截、Excel、空范围共11个稳定用例的最新结果均PASS；详情见执行矩阵 | [execution.md](../@test/effective_hours_20260917/execution.md)、[results.jsonl](../@test/effective_hours_20260917/results.jsonl) |
| `node backend/scripts/verify_stats_details_race.js` | 主代理最终执行4项通过 | 主代理本轮执行输出 |
| `npm run build`（frontend） | 主代理最终构建1714模块通过，仅既有bundle体积提示 | 主代理本轮构建输出 |
| 本地只读数据库前后指纹 | 8个业务表数量、非敏感列行hash、工时及进度空/零计数完全相同 | [db-before.json](../@test/effective_hours_20260917/db-before.json)、[db-after.json](../@test/effective_hours_20260917/db-after.json) |

浏览器所有非 GET API 请求均被拦截，包括填报提交、暂存、编辑心跳和导出上传；自动通知暂停。没有往实际业务表插入测试记录，也没有向人员发送消息。

### 实际数据核对

本地真实 Q3 API、主卡及详情一致：316条、原始总工时4124h、有效2617h、应交付5280h、有效交付率49.56%、12人。普通有版本缺进度2578h，故加权交付率为“待补进度”；需求填报进度85.64%仅代表已知进度，覆盖率1.49%，二者同时显示避免误读。

数据库研发880条11273.5h，880条进度仍为null；产品2条39h，原字段不变。工作日、人员资格等只影响计算，不改历史工时或状态记录。2027 Q1空范围真实GET返回零记录/零容量，个人与PM身份为null。

### 视觉证据与反馈闭环

- [真实周期页](../@test/effective_hours_20260917/evidence/2026-09-17T04-49-51-802Z/live-stats-desktop.png)、[真实卡片详情](../@test/effective_hours_20260917/evidence/2026-09-17T04-49-51-802Z/live-stats-dialog.png)。
- [最终1600px填写页](../@test/effective_hours_20260917/evidence/2026-09-17T04-48-40-485Z/fill-manual-hours-desktop.png)、[1280px周期页](../@test/effective_hours_20260917/evidence/2026-09-17T04-48-40-485Z/stats-1280.png)、[390px人物可达](../@test/effective_hours_20260917/evidence/2026-09-17T04-48-40-485Z/stats-dialog-mobile-people.png)。截图已实际打开检查。
- 前期定位器随placeholder变更导致的测试超时，以及开发尚未接入弹窗指标的失败保留于结果日志。实际看图发现1280图表被卡片下推、390人员表受挤压后，已反馈修复并增加更严格的可见/滚动断言；不以原先较宽阈值的PASS替代最终截图复核。

## 5. 边界、风险与回滚

- 本次只针对新增规则做输入校验、历史ID真实性、事务和只读范围复核。现有 records 管理入口缺少完整owner级鉴权属于存量风险；本轮没有扩大为认证架构改造，不宣称全系统安全审计或生产就绪。
- 实际写入成功/失败通过隔离内存处理器及拦截浏览器请求验证，未在业务数据库执行真实写入。生产环境、真实钉钉通知和发布流程未验证也未执行。
- 没有数据库结构变更或数据迁移，回滚以本轮代码为边界，保护原工作区已有修改；自动日期版本仍存于既有字符串字段。事务故障注入证明失败不会留下部分替换/导入结果；未执行生产回滚。
- 历史空进度需人员后续真实补填，系统不会擅自生成进度。公开演示记录未导入业务库。

需求/计划入口：[REQ-064](../@demand/effective_hours_20260917.md)、[冻结计划](../@plan/effective_hours_20260917.md)。
