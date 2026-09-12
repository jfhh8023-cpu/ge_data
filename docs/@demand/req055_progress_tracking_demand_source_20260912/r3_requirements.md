# REQ-055 第3轮需求修订

状态：`REVIEW_REQUIRED`。

## 统计与存储冻结候选

- `work_records` 和 `product_manager_work_records` 继续独立；统一 DTO 只增加 `source_type`、`demand_source_id/name`、`catalog_revision`，禁止合并写入。
- 需求键至少为 `source_type + staff_id + task_id + version_normalized + requirement_title`；需求方维度另带 catalog ID，不能把同名需求方跨人员错误合并。
- 版本统计按 `source_type + version_normalized`，明细保留人员、任务、需求方和记录数；无版本号单独集合。
- 产品多选需求方按保存权重分配图表和维度列表；卡片、原始列表总工时按记录只计一次。权重合计按百分比精度校验，最后一项吸收舍入差额。
- 综合进度按记录级有效工时加权；产品需求方分配工时只用于需求方分组进度，不改变产品人员原始总进度。
- “全部追踪”不直接把全部历史倒入当前卡片；它是独立查询结果，所有 DTO 和导出均带 `scopeMeta`。
- 静态报告快照保存 catalog revision 和显示名称；新报告使用当前目录，旧快照不被静默重写。

## 最小算例

产品人员 A：10h，内部/客户各 50%，进度 100%；产品人员 B：2h，客户 100%，进度 50%；另有 5h 空进度。原始产品总工时 17h；内部 5h，客户 7h；有效进度为 `(10×100+2×50)/12=91.67%`，5h 不进分母。

