# REQ-066 实际执行验收

2026-09-17。状态：本地实现与定向验收完成，未部署生产。四轮文件是设计审查，NOT RUN为当时状态；实际结果单列如下。

## 冻结矩阵与实际证据

| 用例 | 实际验证 | 结果 |
| --- | --- | --- |
| PW4-E-001 | 前后端统计15组、交付13项、容量/API及XLSX35项，含缺填周、历史、容量有效性及分组 | PASS。40/80=50%、8/80=10%、null/0/五类16/40=40%、不等个人容量24/64=37.5%；保留缺填unit容量且该unit率0；无容量/invalid为null、超额120%。[统计](verify_effective_hours_stats.mjs.log)、[交付](verify_delivery_summary.js.log)、[容量/API](verify_work_hours_completion.js.log)。 |
| PW4-E-002 | 主脚本4组，复用脚本7组，真实GET、导出与1920/1600/1280/390px截图 | PASS。四指标同行，原列表保持；历史note条件正确、覆盖转悬浮；主卡/详情/人员/API/导出按周期同值。 |
| PW4-E-003 | 后端真实入口VM隔离内存17场景；浏览器填表及保存拦截 | PASS。原正数约束、历史原值、伪ID/清空保护、两角色五类与导入事务保持；未在业务库试写。[入口17项](verify_effective_hours_backend.js.log)。 |
| PW4-E-004 | 本地非敏感字段8表只读指纹、历史原值检查 | PASS。[db-before.json](db-before.json)与[db-after.json](db-after.json)8表计数、非敏感行hash、工时及进度空/零计数完全一致；研发880条null仍为空。纯计算不改输入亦独立验证。 |

独立审查使用另写的最小手算夹具复核前后端：32h历史null/两周80h=40%，缺填周std40且weighted0%；普通无版或明确0有容量显示0%，无容量/invalid返回null；原null和真实coverage0不变。[独立执行日志](independent-review.log)。

六套定向回归共91项通过（15+17+13+35及[填表7组](verify_effective_hours_fill.mjs.log)、[详情竞态4项](verify_stats_details_race.js.log)）。[构建](build.log)1714模块通过；保留已有vendor-ui约952KB体积提示，不声称零警告。

## 浏览器每个用例最新结果

主脚本 `verify_weighted_delivery_refinement_ui.js` 已维护为REQ-066契约；沿用原稳定WR编号，映射本轮PW矩阵。完整批次 `2026-09-17T05-41-47-168Z`，见[stdout](ui-final.log)和[results.jsonl](results.jsonl)。

| 稳定ID | 最新结果 | 证据摘要 |
| --- | --- | --- |
| WR4-E-003-API | PASS | Q3部门49.46%、产品7.59%；研发87.78%、VOIP3.3%、质量68.48%、嵌入式11.36%；有效2617h不变，接口314条null保持；服务端XLSX同值。 |
| WR4-E-003-GROUP | PASS | 8h@100与32h@50、各40h容量：组30%、人员20/40%；null/0组10%；全部进度100但只填一半容量为50%；增加缺填周降25%；无有效工时有容量0%，空脚注不显示。前端Excel组30%。 |
| WR4-E-003-LAYOUT | PASS | 1920/1600/1280/390四指标同行、无重叠/内容溢出/页面横向溢出；数量卡等高，原人员及下表页签保留。桌面卡片约130~135px。 |
| WR4-E-002-FILL | PASS | 历史null预估20%且提交原值仍null；原0预估0，显式提交被拒；新行空进度待补，选项10..100；预估算法保持。 |

复用 `verify_effective_hours_ui.js` 的7项最新状态均PASS，批次 `2026-09-17T05-42-25-461Z`，见[stdout](reused-ui.log)及[完整结果](reused_effective_hours/results.jsonl)：R4-E-002-MATH、R4-P-001-MATH、R4-E-002-UI、R4-E-001-FILL、R4-I-001-UI-EXPORT、R4-E-001-FILL-SAVE、R4-E-003-UI-LIVE。覆盖真实范围/人员、五类手填3.5h固定版本/恢复普通值、导出、新输入和历史null/0兼容。

已实际打开查看[1600主卡](evidence/2026-09-17T05-41-47-168Z/live-cards-1600.png)、[390弹窗](evidence/2026-09-17T05-41-47-168Z/live-dialog-390.png)，并有[1280主卡](evidence/2026-09-17T05-41-47-168Z/live-cards-1280.png)、[缺填周](evidence/2026-09-17T05-41-47-168Z/unfilled-week-keeps-capacity.png)、[无有效工时](evidence/2026-09-17T05-41-47-168Z/no-effective-hours-zero-rate.png)证据。历史卡片显示“历史未填进度按100%计”，产品有真实进度则显示85.64%，覆盖不常驻。

## 真实数据、审查与边界

本地Q3仍为316条、4124h原始、2617h有效、5280h应交付、12人；有效率49.56%不变。加权2611.4h÷5280h＝49.46%，产品33.4h÷440h＝7.59%。真实需求进度85.64%、覆盖1.49%和缺失2578h保持，默认100未被记作真实填写。

独立代码审查确认主/个人/单位共用容量公式，保留invalid/null边界和零分子；输入写接口未改。审查补充了悬浮提示中的真实需求进度值，防止混合历史null时信息随脚注隐藏。未发现本轮新增阻塞。浏览器fixture全部非读API请求拦截，本地主4组5次写均被拦截；真实API/导出只用GET。测试证据写入新目录，不覆盖REQ-064/065归档。

既有 records 管理入口owner鉴权为存量风险，未扩展为认证架构改造或全系统安全审计。真实业务库写路径以隔离内存测试替代；未部署生产、回填历史或触发通知。无迁移；回滚仅撤销本轮代码，保留原脏工作区内容。最终构建与8表指纹均已通过归档。
