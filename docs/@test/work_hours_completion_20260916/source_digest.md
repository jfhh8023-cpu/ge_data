# REQ-060 工时完成度验证来源

日期：2026-09-16。

- 需求：`docs/@demand/work_hours_completion_20260916.md`，用户确认同时显示工时完成度与交付进度；48/40 显示 120%，超额 20%。
- 实施计划：`docs/@plan/work_hours_completion_20260916.md`，WH-01～WH-11。
- 计算实现：`frontend/src/utils/workHours.js`、`frontend/src/utils/progress.js`。
- 组件：`HoursCompletion.vue`、`ProgressExplanation.vue`。
- UI 验证限定 `http://localhost:5176`（当前 Vite 监听 IPv6 ::1），API 限定 `http://127.0.0.1:3001/api`。
- 所有边界场景使用自有 REQ060 fixture，通过 Playwright route 返回内存响应，不写业务数据库。浏览器所有非 GET API 请求均拦截；填写页自动 editing 心跳与导出归档上传也只返回本地模拟成功。
- 真实 API 只读验证返回字段及汇总一致性；不保存人员 token、电话等无关信息。后端日历容量、补班和历史状态由后端测试补充，浏览器不声称验证未执行链路。
