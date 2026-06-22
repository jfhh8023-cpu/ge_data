# 工时数据分析周维度展示与生产发布记录

日期：2026-06-22

## 变更范围

- 工时数据分析报告中，选择周维度时，趋势图统一改为柱状图，展示当前周的总计、前端、后端、测试工时。
- 非周维度仍保留原趋势折线图；跨年月份标签使用紧凑年月显示，例如 2026 年 6 月显示为 2606。
- 报告初始化期间增加居中加载提示：正在加载。。。。。。
- 需求投入 Top 20 增加说明提示，解释单周期需求工时排行的统计口径。
- 周期统计页面跳转分析报告时，修正季度和具体周期筛选传参，避免跨季度任务编号造成范围不一致。
- 生产 Nginx 配置片段补充静态资源长期缓存和页面入口禁用缓存，降低旧前端资源导致按钮延迟出现的概率。

## 涉及文件

- backend/scripts/analyze_workload.js
- backend/src/routes/stats.js
- frontend/src/views/StatsPage.vue
- deploy/nginx-devtracker.conf

## 验证记录

- 已执行 `node --check scripts\analyze_workload.js`。
- 已执行 `node --check src\routes\stats.js`。
- 已重新生成本地工时分析报告。
- 已用浏览器脚本验证周维度报告不再出现折线图，改为柱状图展示。
- 已执行前端生产构建 `npm run build`。

## 发布注意

- 生产发布必须先备份线上数据库。
- 常规发布使用 `deploy/deploy.py --skip-db`，不得导入或覆盖生产业务数据。
