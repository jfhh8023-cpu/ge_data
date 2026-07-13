# 工时分析报告注意说明与静态访问优化记录

日期：2026-06-22

## 变更内容

- 报告顶部注意说明改为两条编号内容：
  - 第 1 条保留人工填报统计口径说明。
  - 第 2 条补充 AI Agent 需求对应开发测试工时未纳入当前分析的说明。
- 产品经理归属页签的“产品经理归属 Top：三端拆分”标题补充“未包含AI_Agent需求开发测试工时”。
- 生产 Nginx 增加 `/devtracker/api/local-reports/` 静态直出规则，并对报告静态文件启用 gzip，减少报告访问经过 Node 静态转发带来的等待。

## 2026-06-29 更新

- `workload-analysis` 报告已改为经过后端动态路由返回，访问时会先检查系统库数据签名，数据变化或目标周期页缺失时自动执行 `backend/scripts/analyze_workload.js` 重新生成报告。
- Nginx 对 `/devtracker/api/local-reports/workload-analysis/` 增加更长前缀的后端代理规则；其它 `/devtracker/api/local-reports/` 文件仍保留静态直出。
- 生产验证：第26周 `2026-06-22~2026-06-28` 已识别为 ready，22 条记录，258h，并生成 `devtracker_workload_period_week_2026-_26_2026-06-22_2026-06-28_latest.html`。

## 涉及文件

- backend/scripts/analyze_workload.js
- deploy/nginx-devtracker.conf

## 验证要求

- 本地重新生成报告后，确认顶部注意说明显示两条编号。
- 确认产品经理归属页签标题包含补充说明。
- 发布后确认 Nginx 配置测试通过，并验证生产报告响应头、页面加载和核心表行数。
