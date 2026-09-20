# 右侧产品图本人查看页：只读验收计划

日期：2026-09-17。来源：本轮产品图姓名点击改为新页打开本人填报，保留原查看页外观、筛选和排序；不再影响底部列表，删除图下说明。参考 `StatsPage.vue`、`PmViewPage.vue`、路由及 `/api/stats/personal/:staffId`。

| 用例 | 覆盖路径与预期 |
| --- | --- |
| PERSONAL-WINDOW | Q3 产品图姓名 → 新页；staffId、year/quarter/taskId 与个人 GET 对账；原始记录工时等图总计；源页主表选择及记录不变；说明不存在；左侧原 token 查看入口继续可用。 |
| PERSONAL-PERIOD | 单周 → 新页；本人周期及记录相符；周期正反排序、筛选、空范围正确；仅本人 records，无关联研发工时。 |
| PERSONAL-LAYOUT | 查看页桌面及 390px 截图人工核对；原卡片/筛选外观保留，页面无横向溢出。 |

基线读取：2026 Q3 张三本人 225h、2 条记录；个人接口还返回该人员参与但未填报的周期。使用本批 API 实值作为最终预期，不预设空周期的展示方式。

所有业务非 GET/HEAD/OPTIONS 请求由浏览器拦截；不改业务数据、不发送通知。访问 token 仅用于浏览器正常打开既有入口，不写入证据、日志或报告。结果记录到同目录 review/results/status 及 evidence。本轮不运行旧主列表联动测试（其“点击图表筛主表”预期已失效）。

状态：已完成 3 组验收与表格列宽、周期选择及离页导航的定向补查。详见 `product-personal-window-review.md`。
