# REQ-068 移除卡片需求进度与覆盖脚注

2026-09-17。用户最新要求：“需求填报进度，和覆盖移除”。状态：本地实施与定向验收完成，未部署生产。见[执行验收](../@test/remove_progress_footer_20260917/execution.md)及[开发记录](../@development/remove_progress_footer_20260917.md)。

移除周期统计外卡及点击卡片弹窗摘要中成对的“需求填报进度 / 覆盖”整行。保留四项交付指标、各自Tips、总工时和原布局；保留人员列表已有实际需求进度列、填写进度、统计计算、API及导出。

只从 `StatsHoursCard.vue`、`StatsPage.vue` 的 `DeliverySummary` 调用去掉 `show-progress`，默认false；复用组件继续保留该可选能力，不删除字段或计算。此次覆盖REQ-067的卡片/摘要脚注显示要求，其他需求不变。属于两处展示开关调整，无新公式或数据变更，使用精简需求/计划/验收流程，不重复重大变更四轮门控。无生产操作、DB写入或无关文件改动。

[开发测试计划](../@plan/remove_progress_footer_20260917.md)。
