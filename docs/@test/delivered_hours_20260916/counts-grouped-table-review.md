# 部门计数与分组主表验收

日期：2026-09-17。结论：本轮静态审查与 4 组定向集成验收通过，其中 3 组使用真实本地数据，1 组使用隔离 route fixture。仅允许业务 GET，未写入业务数据或发送通知。

## 验收结果

| 用例 | 结果 | 证据摘要 |
| --- | --- | --- |
| COUNTS-PEOPLE | PASS | Q3 为 147 条记录、142 个需求、7 个周期、16 人（研发 11、产品 5），含未填报人员；主列表岗位及人员筛选不改变部门计数。4 个计数入口进入对应内容，名单姓名排序可用。W29 为 17/17/1/15，W33 为 18/15/1/16。 |
| GROUPED-LIVE | PASS | 恢复序号、AI产品经理、版本号、需求名称、人员、角色、工时 7 列。147 个唯一 source:id，原始工时与 14 组小计均为 2504h；27 个合并单元格、56 个奖章。组内工时排序及恢复新增顺序通过。AI开发筛选为 40 条、724h，主表无分页。 |
| COUNTS-EMPTY-FIXTURE | PASS | 注入重复原始记录与双 PM 归属后，148 条输入仍只显示 147 条、2504h，研发仅首 PM 分组；注入无记录周期后计数为 8，周期列表显示该周期及全部 0 值。 |
| COUNTS-LAYOUT | PASS | 1600、1920、1280、390 宽度下，6 张工时卡与计数卡等高，页面无横向溢出；人员弹窗桌面双列、手机纵向堆叠并可滚动。 |

| 视口 | 7 张卡高度 |
| --- | --- |
| 1600 × 900 | 115.5px |
| 1920 × 1080 | 115.5px |
| 1280 × 720 | 115.5px |
| 390 × 844 | 110.59px |

已人工查看主卡片、恢复后的合并表格、桌面及手机人员弹窗截图。1280 下卡片按三列换行；390 下两列，计数卡随文档滚动展示。控制台运行错误及业务写请求记录均为空。

静态审查发现未接入的外部 `sortState` 属性存在边界状态覆盖，主代理已移除该无调用路径；页面实际排序交互不变。主代理另确认最终前端构建（1713 modules）与 `git diff --check` 通过。组件代理的 6 组独立 fixture 验证不计入上述 4 组。

## 可复现与证据

- 命令：`node backend/scripts/verify_counts_grouped_table_ui.js`
- [结果 JSONL](counts-grouped-table-results.jsonl)
- [本批运行详情](evidence/2026-09-17T02-25-24-785Z/counts-grouped-runtime.json)
- [1600 卡片](evidence/2026-09-17T02-25-24-785Z/counts-grouped-cards-1600.png)
- [恢复后的主表](evidence/2026-09-17T02-25-24-785Z/counts-grouped-main-table-desktop.png)
- [桌面人员名单](evidence/2026-09-17T02-25-24-785Z/counts-grouped-people-desktop.png)
- [手机人员名单](evidence/2026-09-17T02-25-24-785Z/counts-grouped-people-mobile.png)
- [390 卡片](evidence/2026-09-17T02-25-24-785Z/counts-grouped-cards-390.png)
- [无记录周期 fixture](evidence/2026-09-17T02-25-24-785Z/counts-grouped-zero-task-fixture.png)

本轮未重复旧版主表全量回归；旧版分页主表断言已不适用于恢复后的分组合并表。
