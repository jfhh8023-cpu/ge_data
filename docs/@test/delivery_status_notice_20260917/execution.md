# REQ-069 实际执行记录

2026-09-17。状态：本地定向验收完成，35组最终独立用例PASS（状态5+填报7+后端入口17+主UI4+复用UI2），最终构建及8表只读指纹通过。重跑不重复计数。四轮文件保留设计时的NOT RUN，本文件单独记录真实执行；未部署生产。

## 用例与证据

| 冻结编号 | 实际执行 | 当前结果与证据 |
| --- | --- | --- |
| DS4-E-001 | 填报纯工具7组、后端真实入口VM内存17场景；主UI WR4-E-002-FILL | PASS：[fill-math.log](fill-math.log)、[backend-input.log](backend-input.log)、[最终填报复测](ui-visual-retest.log)。100至10及1倒序，1%提交/预估、集合外拒绝、历史null/0、旧值省略与导入回滚。真实写路径用内存或浏览器拦截。 |
| DS4-E-002 | 状态/范围纯工具5组；主UI WR4-E-003-GROUP | PASS：[status-math.log](status-math.log)、[ui-group-retest.log](ui-group-retest.log)。覆盖显示两位比较、无效/空/异常优先级与历史默认值。较大/无效等不可达正常数据分支由纯工具验证，未冒称真实页面数据。 |
| DS4-E-003 | WR4-E-003-GROUP/LAYOUT与复用R4-E-002-UI、R4-I-001-UI-EXPORT | 最终PASS，见[逐次结果](results.jsonl)、[最终布局复测](ui-visual-retest.log)、[复用日志](reused-ui.log)。同卡片与远端全部周期的未完成列表、按钮不冒泡、最新周期与实际进度筛选、原四指标/人员/页签/导出已核对；390px新弹窗四列同屏已截图独立复核。 |
| DS4-E-004 | WR4-E-003-API、构建、独立代码审查、前后指纹 | PASS：Q3有效2617h、加权49.46%，产品7.59%，原314条范围内null保持。[build-final.log](build-final.log)1719模块通过，存量大chunk提示保留；[db-before.json](db-before.json)与[db-after.json](db-after.json)8表数量/hash/工时/null/0完全一致。 |

主UI最终证据按用例取最新：API批次 `06-46-29-388Z`；GROUP批次 `06-47-46-305Z`；LAYOUT/FILL批次 `06-49-46-504Z`（日期均2026-09-17 UTC）。复用两组批次 `06-46-57-394Z`。不是以最后一个单组运行替代整组验收。

## 最终截图

- [1600px卡片](evidence/2026-09-17T06-49-46-504Z/live-cards-1600.png)：状态保留原脚注位置，四指标同行，卡片约131px高。
- [1920px查看弹窗](evidence/2026-09-17T06-49-46-504Z/live-unfinished-1920.png)与[390px四列同屏](evidence/2026-09-17T06-49-46-504Z/live-unfinished-390.png)：真实当前范围仅一项60%需求，原主弹窗仍保留。
- [下拉100%在顶](evidence/2026-09-17T06-49-46-504Z/fill-options-100-first.png)与[最低1%](evidence/2026-09-17T06-49-46-504Z/fill-options-one-percent.png)。

## 失败、反馈与实际边界

- 首次主UI批次 `2026-09-17T06-46-29-388Z` 的API、LAYOUT、FILL通过；GROUP点击Element内层combobox被关闭中遮罩及placeholder遮挡超时，原失败保留。脚本改点选择器wrapper并等待远端率更新后，`2026-09-17T06-47-46-305Z` GROUP复测通过；不是把失败改成成功。
- 独立审查修复状态原始值直接比较为两位显示值比较；列表收为四列，保留0h最新记录参与分组后再过滤零工时组。未新增写接口，复用角色/人员/任务容量约束与Vue文本转义。
- 首次移动截图发现新查看弹窗当前进度列需横滚，主代理仅调整该弹窗窄屏列宽；最终LAYOUT/FILL复测及独立目视复核通过，下拉展开首尾截图齐全。原1920/1600/1280/390px四指标及下方列表保持。
- 加权大于有效的警告、无效率等边界由5组纯工具覆盖，不宣称真实库中存在该异常。各最终浏览器批次的写请求计数均为拦截fixture请求（最终布局/填报5次、GROUP复测1次）；不是业务库写入。
- 浏览器fixture所有非读请求被拦截；真实路径仅GET和只读SELECT。未迁移、回填历史或部署生产。原records鉴权风险未在本轮扩展修复，不作全系统安全或生产就绪结论。

[冻结矩阵](round4.md) · [开发记录](../../@development/delivery_status_notice_20260917.md)
