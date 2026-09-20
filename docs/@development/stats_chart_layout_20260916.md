# 周期统计双柱状图布局调整

日期：2026-09-16。依据：用户两张截图及本轮图表调整要求。状态：READY（本地实现、构建与最终视觉复核完成）。

## 实现

- 部门展示右侧产品图复用产品展示页的“按人员与需求方”分组：每名产品经理展示需求方系列和红色总计，目录当前为四类需求方，共五个系列。
- 新组件 `frontend/src/components/ProductHoursChart.vue` 同时用于部门右图与产品展示页。保留数值、人员姓名按钮、隐藏零值、图例换行；总计来自原始工时，来源分项继续按保存权重分摊。
- 两侧柱宽固定为 18px，间距至少 8px；长数值标签自动增加共同间距。`StatsPage.vue` 根据各图的人员组数与完整系列数分配横向空间，产品图最小面板宽度 440px；零值开关不改变面板宽度。
- 左图画布与右图 DOM 在图内横向滚动，保证组数增加时柱子不被压窄；900px 以下两图上下排列。图例移到可换行的 HTML 区域，隐藏零值开关放在标题旁。
- 部门右图点击姓名进入产品展示并筛选该人员；产品展示内再次点击姓名可恢复。左侧归属人姓名跳转保持原逻辑。
- 删除旧按需求方绘制右图的 Canvas 路径，避免两套展示口径继续分叉。后端接口、工时计算、进度计算不变。
- 真实数据发现左图相邻 `400.0` 等标签交叠，已将整数的多余 `.0` 去掉；最长数值字符串用于估算所需间距，左右仍保持相同柱宽和间距。

## 验证与边界

- `npm --prefix frontend run build` 通过，保留原有 vendor-ui 大包提示。
- `ProductHoursChart.vue` 的脚本、模板、样式编译和 SSR 检查通过。
- `node backend/scripts/verify_stats_chart_layout_ui.js`：CHART-DESKTOP、CHART-ZERO、CHART-FILTER、CHART-MOBILE 最新结果通过；实测画布绘制柱宽和 DOM 柱宽均为 18px。
- 390px 文档无横向溢出，内部滚动保留相同柱宽；零值开关、四来源加总计、人员筛选通过。
- CHART-LIVE 真实数据复测通过：此前三对数值交叠已消除，两侧相交均为 0；产品卡实测 440px，五项图例单行且均位于卡内。最终桌面截图：`../@test/stats_chart_layout_20260916/evidence/2026-09-16T13-14-17-538Z/department-charts-live-desktop.png`。
- 最新共五组浏览器场景通过；`git diff --check` 通过。最终构建日志保存在 `.codex-local/stats-chart-final-build.log`。
- 测试使用本地只读数据和独立浏览器 fixture，未写业务数据库或发送通知。首次零值开关测试点击隐藏 input 的超时保留在结果中，改为点击可见开关后通过。
- 证据：`../@test/stats_chart_layout_20260916/summary.md`、`results.jsonl`、`evidence/`。
