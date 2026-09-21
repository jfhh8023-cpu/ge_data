# REQ-071 实际执行记录

2026-09-21 17:45–18:40（北京时间）。本地 backend 3001（preload 暂停自动通知）+ vite 5176，本地 MariaDB 镜像库。开发前备份提交 `eb9627d`（含四轮文档）已推三远端。决策 D1~D4 按授权采用默认。

## 结果总览

| 编号 | 结果 | 证据 |
| --- | --- | --- |
| FC4-M-001/002、FC4-P-001/002、FC4-S-001/002 | PASS 6/6 | `node backend/scripts/verify_full_credit_suffix.js` |
| FC4-A-001（fill submit 默认100/40/0→400/带出版本沿用与伪造重生成）、FC4-A-002（CRUD/import） | PASS | `verify_effective_hours_backend.js` 全部 PASS（按新规约更新断言，不弱化） |
| FC4-A-003 | PASS | `GET /api/stats/progress-details`：`李四培训!!` 60→部分完成、带出 `张三请假【【23` 100→已完成，W36 原行 40 不变 |
| FC4-U-001 | PASS | 新行输入 `李四“出差”@@12` → 版本 `v260921` 锁定、PM 不适用、进度 100 下拉可改；`王五‘公司會議’@@`（繁体+符号）同样命中；`evidence/fill-suffix-progress-1920.png`、`-390.png` |
| FC4-U-002 | PASS | 改回 `李四出差报销` → 版本空、PM 必选、进度请选择 |
| FC4-U-003 | PASS | fixture W36 `张三请假【【23` 40% 被带出（标签"第36周未完成 · 上次进度 40%"，版本 `v260901`）；提交 100 后 DB 当前周版本仍 `v260901` 与历史同组；`verify_full_credit_unfinished.mjs` 未完成列表含五类 <100、排除 null/100 |
| FC4-U-004 | 代码审查 | `initializeSpecialRow` null→100；历史编辑模式沿同一初始化 |
| FC4-I-001 | 代码审查 + 脚本 | Excel/识别调用 `normalizeRows(...,{newRows:true})`→`initializeSpecialRow` 默认 100；import 路由 `fullCreditProgress` 在 backend 脚本中覆盖 |
| FC4-H-001 | PASS（附说明） | fixture 清理后 880 条 / 11273.5h / 15 人；`work_records` sha 由 `dcd3655ae035` 变为 `99255f2f05ea`，差异为用户本人在 18:13 通过本地填写页对真实人员（ai_quality，W37）提交的 2 条记录（80%/100%，`staff_fill_links.last_action=editing 18:16`），非本次代码所致，保留不回滚 |
| FC4-E-001 | 设计验证 | 无迁移，单 revert |
| 前端纯函数/一致性 | PASS | `verify_effective_hours_fill.mjs` 7/7、`verify_effective_hours_stats.mjs` 16/16（前后端同口径）、`verify_carry_over_rules.js` 9/9、`verify_delivery_summary.js`、`verify_work_hours_completion.js` |
| 构建 | PASS | `vite build`（存量 chunk 提示） |

## 过程中纠正

- 设计用例把 `出差（北京）`/`出差（2天）` 列为命中，运行 FC4-M-001 即暴露：剥尾部非汉字后最近汉字为"北京"/"天"，按用户规则**不命中**。已同步更正 round2/round4/冻结需求与脚本（改用 `出差（2）` 作命中例）。

## 隔离 fixture

复用 `verify_carry_over_api.js` fixture（`REQ070_测试员`，KEEP_FIXTURE=1），额外在 W36 加一条 `REQ070_张三请假【【23 v260901 40%`；浏览器提交 W37 两条后 `CLEANUP_ONLY=1` 全部删除，remaining 0。

## 备注

- 五类历史 null 在 DB 保持 null；读取显示 100%/已完成（D2）。编辑历史五类 null 行并提交会写入 100（用户可见默认值即所提交值）。
- 未部署生产。
