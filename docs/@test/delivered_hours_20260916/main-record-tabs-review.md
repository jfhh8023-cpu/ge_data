# 主列表两个身份页签验收

日期：2026-09-17。最终批次：`2026-09-17T02-35-38-137Z`。结论：3 组定向验收通过。只读本地 API 与浏览器，无业务写请求、通知或运行错误。

| 用例 | 结果 | 主要证据 |
| --- | --- | --- |
| TABS-DATA | PASS | 默认左侧“研发及其他人员”129 条、2103h，右侧“AI产品经理”18 条、401h；按 API 原始记录 ID 比对，两集合无交集、并集为部门 147 条/2504h。左右分别 9/5 个分组，组小计相符；合并单元格、奖章、组内工时排序及恢复新增顺序均保留。 |
| TABS-LINKS | PASS | AI开发卡切左侧对应岗位，AI产品经理卡切右侧；产品图张三切右侧并按本人筛选。跨页签清除不兼容岗位及人员。部门卡和部门记录数入口的分析仍为全部部门。 |
| TABS-MOBILE | PASS | 390px 两个页签完整可见且可切换，研发在左、产品在右；下划线位于选中页签范围内。表格内部横向滚动，页面 scrollWidth 为 390。 |

## 分析范围对账

通过独立 GET `/api/stats/progress-details?scope=current&year=2026&quarter=Q3`，附对应 `sourceType` / `staffId` 参数，与界面摘要及记录总数核对：

| 入口 | 记录数 | 应交付工时 | 含版本号已交付 | 交付率 |
| --- | ---: | ---: | ---: | ---: |
| 研发及其他人员 | 129 | 2952h | 1541h | 52.2% |
| AI产品经理 | 18 | 1400h | 132h | 9.43% |
| 产品经理张三 | 2 | 280h | 0h | 0% |
| 部门卡 / 部门记录数入口 | 147 | 4352h | 1673h | 38.44% |

已人工查看两张桌面截图与手机产品页签截图，确认分组合并、汇总、左右顺序及手机工具栏可见。移动端页签 x 坐标分别为 44、162，右侧结束于约 252px；桌面分别为 56、174，顺序符合要求。

## 测试脚本修正记录

首批 `2026-09-17T02-34-50-067Z` 的 DATA、LINKS 为 **TOOL：数字解析误判**：摘要含千位逗号，直接转 Number 得到 NaN；实际界面数据正确。修正解析并增加实际页签坐标/下划线断言后，最终 3 组通过。初始失败保留在 JSONL，无覆盖删除。

## 复现与证据

- 命令：`node backend/scripts/verify_main_record_tabs_ui.js`
- [计划](main-record-tabs-plan.md) · [状态](main-record-tabs-status.md) · [追加式结果](main-record-tabs-results.jsonl)
- [最终运行详情](evidence/2026-09-17T02-35-38-137Z/main-record-tabs-runtime.json)
- [桌面研发表](evidence/2026-09-17T02-35-38-137Z/main-record-tabs-engineering-desktop.png)
- [桌面产品表](evidence/2026-09-17T02-35-38-137Z/main-record-tabs-product_manager-desktop.png)
- [手机研发表](evidence/2026-09-17T02-35-38-137Z/main-record-tabs-engineering-mobile.png)
- [手机产品表](evidence/2026-09-17T02-35-38-137Z/main-record-tabs-product_manager-mobile.png)

仅覆盖本轮主列表身份分流、相关筛选联动及响应式变化，未重复旧版主表全量回归。
