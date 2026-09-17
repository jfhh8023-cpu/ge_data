# REQ-068 移除卡片进度脚注开发记录

2026-09-17。状态：本地实现与定向验收完成，独立diff审查及构建通过；未部署生产。

按用户最新要求“需求填报进度，和覆盖移除”，只从 `frontend/src/components/StatsHoursCard.vue` 及 `frontend/src/views/StatsPage.vue` 的 `DeliverySummary` 调用删除 `show-progress`。外卡与弹窗摘要不再显示该脚注整行；四交付指标和各自Tips、人员列已有真实进度、填写进度、计算/API/导出均保留。复用组件可选能力仍在。

独立审查确认业务diff仅两行、Boolean默认false与原v-if条件正常，无计算或数据写逻辑变化。已有两个UI脚本仅更新受影响断言，证据放新目录，不覆盖REQ-067归档。构建1714模块通过，保留既有大chunk提示：[build.log](../@test/remove_progress_footer_20260917/build.log)。

定向主UI GROUP/LAYOUT两组与复用UI一组全部PASS；主代理实际查看1600主卡/1920弹窗，脚注均移除，四指标及人员表保留，图表上移；1920/1600/1280/390布局检查通过。主批次`2026-09-17T06-07-16-528Z`，复用批次`2026-09-17T06-07-16-477Z`。详细结果与截图见[执行验收](../@test/remove_progress_footer_20260917/execution.md)。

本轮为展示开关修正，沿用REQ-067统计基线，不重复全套回归或DB指纹。主UI1次非读请求已拦截，无业务库写入、生产部署或迁移；保护原无关 `ReportPage.vue` 及敏感目录。回滚只恢复两处参数。

[需求](../@demand/remove_progress_footer_20260917.md) · [计划](../@plan/remove_progress_footer_20260917.md)
