# 周期统计记录倒序与完成状态绿色验证

日期：2026-09-16。需求来源：本轮用户要求周期统计与卡片内记录按创建时间倒序；已完成进度/状态使用绿色背景。

## 用例

| ID | 输入与链路 | 预期 |
| --- | --- | --- |
| SORT-API | 本地只读 stats / personal / pm / progress-details / export.xlsx | 每个原始记录数组 created_at 倒序；导出明细与API一致 |
| SORT-UI | 旧90h@100%、中10h@50%、新1h@0%，返回顺序故意混乱 | 部门/研发明细、产品明细、个人/归属聚焦均最新记录在前 |
| SORT-CARD | 同需求包含旧记录和最新记录 | 卡片进度列表按组内最近创建时间倒序，无工时或进度二次排序 |
| GREEN-UI | 完成100%、部分50%、未开始0% | 100%绿色背景，其他进度不使用完成样式；卡片和追踪状态一致 |
| MOBILE-UI | 390px卡片与进度弹窗 | 截图、文档无水平溢出、绿色完成状态保留；无console/page errors |

仅使用localhost5176/3001。UI边界数据由 route fixture 返回；拦截所有非GET API请求，不修改真实业务数据，不发送通知。真实API仅使用GET。自动结果逐用例追加results.jsonl，截图存evidence/<运行时间>/。

运行：`node backend/scripts/verify_stats_record_order_ui.js`；可用 `--case=SORT-API` 或 `--case=SORT-UI,SORT-CARD,GREEN-UI,MOBILE-UI` 定向复测。
