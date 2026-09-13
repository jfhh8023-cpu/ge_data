# 已完成需求探索与反哺范围

日期：2026-09-14。用户要求已完成需求至少三轮探索反哺，最终统一测试并修复。按项目铁律18执行四轮；本轮修复已有契约缺陷，不引入待确认的新产品决策。

## 需求到实现覆盖矩阵

| 需求 | 实现入口 | 验证方式 |
| --- | --- | --- |
| 042 失败重试/幂等 | AutoTaskService、现有 verify 脚本 | 安全审阅；可隔离逻辑测试；涉及真实调度的写库验证须标记范围 |
| 043/046 日期规则/换班 | DutyCalendarService、SettingsPage | 只读页面、服务纯函数；不操作现有排班 |
| 044 历史分页 | SettingsPage、settings 路由 | 本地 UI 默认收起、只读 API 分页 |
| 045 webhook | AutoTaskService DNS/URL | mock DNS 回调、恶意 URL 拒绝；不发真实群消息 |
| 047 版本报告导出 | workload_version_page、WorkloadVersion* | 真实聚合函数、生成工作簿/解析对照 |
| 048/050/052 填报与进度 | FillPage、progress、fill 路由 | 本地浏览器内存夹具、纯函数、只读数据 |
| 049/051/053/054/059 分视图与图表 | StatsPage | API+UI 基线、多人/同名/小数/目录/布局夹具 |
| 055 目录与追踪 | DemandSourceService、stats | ID引用、停用、改名、权重、详情与导出契约 |
| 056 弹窗分页/卡片 | StatsPage | 真点击、翻页、容量、各页签独立性 |
| 057 历史完成 | stats、progress | 当前/历史周边界、空值、北京时区 |
| 058 周列 | StatsPage | 版本统计周列/跨周去重 |

源：docs/@demand/requirements.md REQ-042~059；各 docs/@development 文档；backend/tests/req059_feedback_loop.mjs。

冲突优先级：057 覆盖历史周展示的旧空进度规则；本周/未来未填仍不可伪造成0；059 覆盖产品页旧需求方横轴，部门产品图仍按需求方。

## 安全与证据

生产、远端服务器、真实 webhook 均不访问；不运行会批量触发现有规则或改写全局日历的旧测试。现有本地数据只读；浏览器 mock 明确标注，不声称落库链路通过。每条执行立即写 JSONL 与 status，保留修复前和修复后证据。未覆盖分支明确标记，不用“文件存在”替代功能验收。
