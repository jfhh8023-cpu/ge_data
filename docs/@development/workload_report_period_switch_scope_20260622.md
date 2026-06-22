# 工时分析报告周期切换范围修复记录

日期：2026-06-22

## 问题现象

- 打开 `devtracker_workload_period_quarter_2026-Q2_latest.html` 后，右上角周期下拉只有 `2026-Q2`，不能切换到其他季度。

## 原因

- 全量报告会生成共享周期页 `devtracker_workload_period_*_latest.html`，这些页面应携带完整周期目录。
- 单独生成 `--year=2026 --quarter=Q2` 报告时，也会写同名共享周期页，导致 Q2 周期页被覆盖成只包含 Q2 的目录。

## 变更内容

- 仅全量报告写入共享周期页。
- 年度、季度、月份、周等筛选报告只写自身报告文件，不覆盖共享周期页。

## 涉及文件

- backend/scripts/analyze_workload.js

## 验证记录

- 本地先生成全量报告，再生成 2026 Q2 筛选报告。
- 验证 `devtracker_workload_period_quarter_2026-Q2_latest.html` 中季度选项保留 `2026-Q2` 和 `2026-Q1`。
