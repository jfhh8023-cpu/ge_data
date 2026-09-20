# REQ-070 实际执行记录

2026-09-20 19:40–20:20（北京时间）。本地 backend 3001（preload 暂停自动通知）+ vite 5176，本地 MariaDB 镜像库。用户决策：D1 采用默认"所有更早周期"；D2/D3 未选即默认（可编辑 + 工时留空）。

## 结果总览

| 编号 | 结果 | 证据 |
| --- | --- | --- |
| CO4-D-001~003 | PASS 9/9 | `node backend/scripts/verify_carry_over_rules.js` |
| CO4-A-001~004 / CO4-H-001 | PASS 7/7 | `node backend/scripts/verify_carry_over_api.js`（隔离 fixture，见下） |
| CO4-S-001 / CO4-H-001 提交后 | PASS 4/4 | `node backend/scripts/verify_carry_over_after_submit.js` |
| CO4-U-001 | PASS | 3 行带出：B 40%、C 0%→空、G 60%（第35周），PM 回显，工时空；`evidence/fill-carry-over-1920.png` |
| CO4-U-002 | PASS | C 行未选进度直接提交 → "第 2 行交付进度请选择1%或10%至100%…"，未发出 submit 请求 |
| CO4-U-003 | PASS | 改标题 → 追加"（已修改，将作为新需求统计）"；改回恢复 |
| CO4-U-004 | PASS | 3×8h → "共 3 条，总工时 24.00 小时"；✕ 删除 G 行后提交 2 条成功 |
| CO4-U-005 | PASS（修复后） | 暂存后刷新：提示"已恢复上次暂存的草稿"，`carry_over_records=[]`，标签经草稿保留（优于冻结文档"已知降级"） |
| CO4-U-006 | PASS（修复后） | 历史第36周编辑模式 4 行均无标签；返回首选任务恢复草稿 3 行；`evidence/fill-carry-over-390.png` |
| CO4-P-001 | PASS（代码审查） | blocked 分支早于 `loadCarryOverRows`，不返回该字段；提交路径未改 |
| CO4-I-001 | PASS（代码审查 + 回归） | `normalizeRows(..., {newRows:true})` 识别/导入调用点未改；`verify_effective_hours_backend.js` 全部 PASS |
| CO4-E-001 | 设计验证 | 无迁移；改动 5 文件均可单次 revert |
| 8 表只读指纹 | PASS | 清理 fixture 后 `work_records` 880 条 / 11273.5h / sha `dcd3655ae035…`，与 09-17 归档 `weighted_delivery_refinement_20260917/fingerprint.log` after 值完全一致 |

## 过程中发现并修复的缺陷（铁律 8 溯源）

1. **草稿恢复失效（存量缺陷，REQ-070 暴露）**：MariaDB 将 `staff_fill_links.draft_data` / `fill_links.draft_data`（JSON 列）以字符串返回，`GET /api/fill/:token` 原样透传，前端 `Array.isArray(draft_records)` 为假 → 草稿从不被恢复、直接落到已提交记录/空行；本次因带出行覆盖草稿而被发现。修复：两个模型 `draft_data` 增加 getter 解析字符串（上游单点），路由/前端零改动。生产同为 MariaDB 10.6，此缺陷在线上同样存在，属本次顺带修复。
2. **返回首选任务忽略草稿（存量）**：`returnToPreferred` 仅按记录/空行初始化；改为与首次加载相同的 草稿 → 记录 → 带出 → 空行 顺序。
3. `verify_effective_hours_backend.js` 路由隔离夹具的依赖白名单未含 `DeliverySummaryService` 与 `Op.ne`，按新增依赖补齐（不弱化任何断言）。

## 隔离 fixture 说明

本地库无任何 <100 进度数据（生产镜像 880 条全为空进度），无法自然复现。`verify_carry_over_api.js` 在本地库（`DB_HOST` 必须为 localhost）创建 `REQ070_测试员`（ai_dev）+ 专属 token + 第35/36周 7 条记录（A 40→100、B 100→40、C 0、D null、G 60），默认在 `finally` 删除；浏览器验证期间以 `KEEP_FIXTURE=1` 保留，结束后 `CLEANUP_ONLY=1` 清理并用指纹脚本核对回到基线。fixture 期间在第37周真实提交过 B=100/C=10 两条并随后删除，最终库状态与测试前一致。

## 未覆盖 / 备注

- AI 产品经理（`ProductManagerWorkRecord`）路径以纯函数用例（需求方 + 权重 JSON 字符串）与代码路径共用 `loadCarryOverRows(Model,…)` 覆盖，未做浏览器级 fixture。
- legacy `FillLink` token 走同一函数与 getter，仅代码审查。
- 未部署生产。
