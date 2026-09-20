# REQ-070 第4轮：冻结用例矩阵

2026-09-20；设计审查，运行 NOT RUN。反哺来源：CO3-U-006、CO3-A-001、CO3-D-001。本轮只做收敛与覆盖映射，不再新增规则；冻结需求见 `docs/@demand/carry_over_unfinished_20260920.md`，冻结计划见 `docs/@plan/carry_over_unfinished_20260920.md`。

## 第3轮反哺落实

- 草稿恢复后 `_carry_over` 标签丢失 → 冻结为**已知降级**，不改草稿结构。
- 候选源统一按 `staff_id` 查询（非 `link_id`），system/legacy 共用。
- 不按 `time_dimension` 过滤更早任务。

## 冻结用例（最终执行清单）

| 编号 | 类型 | 内容 | 来源 |
| --- | --- | --- | --- |
| CO4-D-001 | 纯函数 | `buildCarryOverRows`：A(上上周40→上周100) 不带；B(上上周100→上周40) 带40；C(0) 带、进度 null 标 0；D(null) 不带；E 五类不带；F 无版本不带；G 仅上上周 60 带 60。 | CO2-F-002~006, CO3-D-001 |
| CO4-D-002 | 纯函数 | 当前任务记录/草稿含 B → 整体不带（由路由层条件控制，函数本身不判断）。 | CO2-F-007 |
| CO4-D-003 | 纯函数 | D1=紧邻模式（若用户选择）只取 `start_date` 最大的更早任务。 | CO2-F-001 |
| CO4-A-001 | API | system token：无记录无草稿 → `carry_over_records` 非空；有记录 / 有草稿 / 无任务 / blocked → `[]`。 | CO3-A-001 |
| CO4-A-002 | API | legacy token 同 CO4-A-001。 | CO2-R-002 |
| CO4-A-003 | API | 返回项字段：`requirement_title, version, product_managers, demand_sources, demand_source_ids, demand_source_weights, delivery_progress, _carry_over{source_task_id, source_task_title, source_week_number, previous_progress}`；无 `id`。 | CO2-A-001, CO3-A-002 |
| CO4-A-004 | API | AI 产品经理：需求方与权重原样返回。 | CO2-R-001 |
| CO4-U-001 | UI | 打开填写页出现带出行 + 标签；工时空；进度预填。 | CO1-F-001, CO3-U-001 |
| CO4-U-002 | UI | 进度 0 → 空 + 标签 0%；直接提交被拦截。 | CO3-U-002 |
| CO4-U-003 | UI | 改标题 → "已修改"标签；改回恢复。 | CO3-U-003 |
| CO4-U-004 | UI | 删除全部带出行 → 一行空行；填 8h 提交成功。 | CO3-U-004/005 |
| CO4-U-005 | UI | 暂存后刷新 → 恢复草稿、不重复带出、标签消失（已知降级）。 | CO3-U-006 |
| CO4-U-006 | UI | 编辑历史任务无带出；返回首选任务重新初始化。 | CO3-U-007 |
| CO4-S-001 | 统计 | 提交 B=100 后：选上周 B 40%；选两周 B 100%；未完成列表不含 B。 | CO1-S-001, CO3-S-001 |
| CO4-H-001 | 历史 | 提交后上周行 `delivery_progress`/`updated_at` 不变，8 表只读指纹一致。 | CO1-D-001, CO3-D-002 |
| CO4-P-001 | 权限 | 离职 blocked 响应无带出；提交路径校验不变。 | CO2-P-001 |
| CO4-I-001 | 导入导出 | Excel 导入、文本识别、历史导出无回归。 | CO3-I-001 |
| CO4-E-001 | 回滚 | 回退三文件后构建通过、页面按旧逻辑初始化、DB 无变化。 | CO3-E-001 |

## 覆盖映射（铁律 18.6）

| 覆盖项 | 用例 |
| --- | --- |
| UI | CO4-U-001~006 |
| API | CO4-A-001~004 |
| 数据库 | 无结构变更；CO4-H-001 |
| 历史数据 | CO4-D-001（null/100 排除）、CO4-H-001 |
| 权限 | CO4-P-001 |
| 导入导出 | CO4-I-001 |
| 统计报表 | CO4-S-001 |
| 空值/零值 | CO4-D-001（C/D 项）、CO4-U-002 |
| 跨角色冲突 | CO4-A-004（AI 产品）、CO4-A-002（legacy） |
| 回滚验证 | CO4-E-001 |

## 待用户确认的产品决策（铁律 18.5）

| 编号 | 问题 | 默认（推荐） | 备选 |
| --- | --- | --- | --- |
| D1 | "上一周"范围 | 所有更早任务中该需求最新进度 <100（漏填一周也不丢） | 仅紧邻前一个采集任务 |
| D2 | 带出行标题/版本 | 可编辑，改动后标注"将作为新需求统计" | 锁定只读，需改则删行重填 |
| D3 | 带出行工时 | 留空由本人填写 | 复制上周工时 |

未获确认前不进入业务代码开发。
