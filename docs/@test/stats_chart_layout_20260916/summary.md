# 部门双图验证结果

日期：2026-09-16。最新批次：2026-09-16T13-14-17-538Z。

**本地验收：5 组最近结果全部通过。** 最后定向验证桌面 fixture 和真实只读数据：两侧柱宽均为18px，右卡440px，五项图例单行且全部位于卡片内；左右数值标签相交均为0。最新真实截图已人工复核。

| 用例 | 最近结果 | 批次 |
| --- | --- | --- |
| CHART-DESKTOP | PASS | 2026-09-16T13-14-17-538Z |
| CHART-ZERO | PASS | 2026-09-16T13-07-55-132Z |
| CHART-FILTER | PASS | 2026-09-16T13-07-02-981Z |
| CHART-MOBILE | PASS | 2026-09-16T13-09-46-547Z |
| CHART-LIVE | PASS | 2026-09-16T13-14-17-538Z |

复现：`node backend/scripts/verify_stats_chart_layout_ui.js --case=CHART-LIVE,CHART-DESKTOP`。原始结果见results.jsonl，fixture/测量/截图在evidence/<批次>/。不写业务数据，不发通知。
