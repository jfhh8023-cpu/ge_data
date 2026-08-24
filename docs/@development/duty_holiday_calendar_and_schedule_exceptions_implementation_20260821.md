# 节假日跳过与排班例外本地实施记录

## 文档信息

- 日期：2026-08-21。
- 状态：`LOCAL_SYSTEM_INTEGRATION_COMPLETE`。
- 触发请求：按已批准需求文档和技术方案执行本地开发，暂不推送、不发版。
- 需求文档：`docs/@demand/duty_holiday_calendar_and_schedule_exceptions_20260821.md`。
- 技术方案：`docs/@development/duty_holiday_calendar_and_schedule_exceptions_plan_20260821.md`。
- 发布边界：本轮不提交、不推送、不打包、不发布生产。

## 1. 已确认决策

需求文档第 15 节八项推荐方案全部采用：固定/月度连锁顺延、人员跳过双名额消耗、全部周末默认停排、仅排除离职、全局日期加规则级例外、下一未执行日生效、同日单条特殊通知、固定多人仅全部跳过时补位。

## 2. 本地数据保护

- 备份时间：2026-08-21 19:15:10（Asia/Shanghai）。
- 备份目录：`deploy/backups/local_before_duty_calendar_20260821_191510/`。
- 备份文件：`local_devtracker_before_duty_calendar_20260821_191510.sql`。
- 文件大小：1,748,088 字节。
- SHA-256：`E616E15E3A84CDD76132E3B67B279EBAEAED9F11811832C655189BE0320BF5AC`。
- 校验：文件大于 100 KB，包含 `Dump completed` 完成标记。

## 3. 官方节假日来源

- 来源：国务院办公厅《关于2026年部分节假日安排的通知》，国办发明电〔2025〕7号。
- 官方页面：`https://big5.www.gov.cn/gate/big5/www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm`。
- 发布日期：2025-11-04。
- 核对日期：2026-08-21。
- 录入范围：元旦、春节、清明节、劳动节、端午节、中秋节、国庆节放假区间及官方调休上班日。
- 业务覆盖：调休上班日若为周末，仍按已确认规则默认停排，同时保留官方标识供管理员取消。

## 4. 实施清单

- [x] 新增年度日历修订、规则日期例外、临时换班、特殊通知日志模型及幂等建表。
- [x] 新增 2026 官方节假日版本快照并校验。
- [x] 新增统一排班解析服务，接入预览、下一次执行和真实调度。
- [x] 新增全年日历查询、草稿预览和原子保存接口。
- [x] 新增特殊通知独立调度、幂等和隔离测试。
- [x] 新增设置页入口、全年日历、日期规则、特殊通知、人员跳过和临时换班交互。
- [x] 完成 API、构建、安全、数据守恒和浏览器回归。

## 5. 变更与验证

### 5.1 数据库对象

- `duty_calendar_revisions`：年度日历修订与生效日期。
- `duty_schedule_exceptions`：规则日期级人员跳过和特殊通知。
- `duty_schedule_swaps`：两日期一对一临时换班及逻辑取消。
- `duty_special_notification_logs`：特殊通知独立幂等执行日志。
- 迁移为纯新增且可重复执行；未修改现有业务表结构或历史数据。

### 5.2 后端文件

- 新增：`backend/src/models/DutyCalendarRevision.js`、`DutyScheduleException.js`、`DutyScheduleSwap.js`、`DutySpecialNotificationLog.js`。
- 新增：`backend/src/services/DutyCalendarService.js`、`backend/src/routes/dutyCalendar.js`。
- 新增：`backend/src/data/holidays/2026.json`、`backend/migration_v3.4.0.sql`。
- 新增验证脚本：`backend/scripts/verify_duty_calendar_and_exceptions.js`。
- 接入：`backend/src/models/index.js`、`backend/src/app.js`、`backend/src/services/AutoTaskService.js`、`backend/src/routes/settings.js`。

### 5.3 前端文件

- 新增：`frontend/src/components/DutyCalendarDialog.vue`。
- 接入：`frontend/src/views/SettingsPage.vue`。
- 页面能力：全年日历、官方/周末/手动颜色图例、日期规则、特殊通知、人员跳过、临时换班、影响预览、未保存保护和原子保存。

### 5.4 关键行为

- 未创建日历修订时保持旧排班结果，不自动改写历史配置。
- 周末、法定节假日、手动停排和未配置日期均不丢失队首排班单元，后续有效工作日接续。
- 人员单日跳过会顺位补位并按已确认规则消耗名额；无人可补位时返回保存级冲突。
- 换班最后应用，只影响指定两日；停排、未配置或已成功执行日期禁止换班。
- 特殊通知与正常值班事件解耦，使用独立唯一键防止重复发送。
- 保存采用年度修订号乐观锁和数据库事务；超大年度草稿及单日超量人员被服务端拒绝。
- 同日排班解析和下一次执行查询使用 5 秒进程内缓存，保存、取消和规则删除后立即失效。

## 6. 本地验证结果

| 门禁 | 结果 |
| --- | --- |
| 日历/顺延/人员跳过/换班/通知/缓存/API 自动测试 | `9 / 9 PASS` |
| 既有子通知、规则切换和值班发送模式回归 | PASS |
| 前端生产构建 | PASS，Vite 8.0.8，1686 个模块 |
| 后端语法检查 | PASS |
| `git diff --check` | PASS，仅有仓库既有换行符提示 |
| 桌面浏览器 1440 x 900 | PASS，全年四列，无横向溢出 |
| 窄屏浏览器 720 x 800 | PASS，月份单列，无横向溢出 |
| 浏览器日志 | 无 error，仅 Vite 调试日志 |
| 测试数据清理 | 修订、例外、换班、特殊日志和临时规则均为 0 |

验证命令：

```powershell
node backend/scripts/verify_duty_calendar_and_exceptions.js
node backend/scripts/verify_child_notifications_and_duty_switch.js
npm --prefix frontend run build
node --check backend/src/services/DutyCalendarService.js
git diff --check
```

证据：

- `docs/@test/duty_calendar_20260821/duty_calendar_results.jsonl`。
- `docs/@test/duty_calendar_20260821/duty_calendar_summary.md`。
- `docs/@test/duty_calendar_20260821/evidence/holiday-calendar-desktop.png`。
- `docs/@test/duty_calendar_20260821/evidence/holiday-calendar-mobile.png`。

## 7. 数据守恒与安全复核

- 自动测试仅向 `127.0.0.1` 隔离接收器发送一条特殊通知；未调用生产 webhook。
- 新 API 不返回手机号或 webhook token；测试归档不记录上述敏感值。
- 测试结束后四张新业务表和临时自动任务规则均恢复为 0 行基线。
- 候选人员沿用全局状态规则：仅排除离职，保留在职、留职和长假。
- 生产数据未连接、未读取、未写入；本轮只使用本地数据库。

## 8. 剩余风险

- 当前系统设置接口整体仍依赖既有前端管理员入口，缺少统一的服务端鉴权中间件；新接口未另造一套不一致的权限机制。生产发布前应把服务端鉴权作为独立阻塞门禁处理。
- Vite 构建保留既有大 chunk 警告，不影响功能正确性，但后续可单独做代码拆分。
- 当前仅内置经官方核验的 2026 年快照；跨年使用前必须按同样流程补录并校验新年度官方文件。

## 9. 本轮边界结论

- 本地实现与本地验收已完成。
- 未执行 `git add`、commit、push、打包或生产发布。
- 本记录不是生产发布证明；若后续获准发布，必须重新执行生产备份、迁移演练和上线前门禁。

## 10. 2026-08-22 补充实施

- 触发：节假日配置需同时对自动值班通知、自动任务创建并通知及相关倒计时实时生效。
- 当前审计：自动值班真实调度已接入统一解析；普通自动规则、子通知和子通知兜底仍使用原始周/月日期，存在全链路不一致。
- 实施口径：普通主任务和子通知在停排日顺延至下一非停排日；显式测试操作和特殊日期通知不跳过。
- 发布边界：继续仅修改和测试本地环境，不提交、不推送、不发版。
- 验证计划：见 `docs/@test/duty_calendar_20260821/` 中 H-011 至 H-016。

## 11. 2026-08-22 全系统联动完成记录

- 普通自动任务新增日历感知的到期判断、上次/下次执行计算；停排日不执行，恢复日按原时间点执行一次。
- 子通知新增日历感知的到期判断、倒计时和主任务证据回退；主任务未激活时仍不发送，激活后遇停排日顺延一次。
- 自动值班继续使用统一值班解析；特殊日期通知继续在停排日独立触发，不受普通任务跳过影响。
- 日历保存事务成功后立即失效全局日期、值班解析和下一次执行缓存；设置 API 无需重启即可返回新的主任务和子通知时间。
- 核心日历 H-001 至 H-009、系统联动 H-011 至 H-015、既有子通知与值班模式回归全部通过。
- H-010/H-016 最终门禁通过：前端 Vite 构建成功，12 个后端文件语法检查成功，`git diff --check` 成功，新浏览器会话 0 条 error/warn。
- 浏览器证据：`docs/@test/duty_calendar_20260821/evidence/h016_settings_calendar_dialog_20260822.png`，SHA-256 `E7FF916E7542D12CAB4F0B545D7BD84BECF3147FDD1D64B0D20F25CFF48C43CA`。
- 最终本地数据守恒：用户原有 2026 修订 1、日期例外 1、换班 0、特殊通知日志 0、运行日志 113、消息 242；临时规则和临时子通知均为 0。
- 本轮未执行 `git add`、commit、push、部署打包或生产发布。

## 12. 2026-08-23 全年信息、官方同步与本地通知修复

### 12.1 实现内容

- 新增年度官方节假日快照模型、迁移和同步服务；历史年份按需发现，当前年/下一年后台刷新，未来未发布年份保持 `pending`。
- 官方节假日层按已验证的最新官方快照动态覆盖人工日历修订，`source_version` 和校验时间持续留痕；官方后发修订会更新历史展示和运行时判定，这是“自动获取准确数据并实时生效”的已确认设计，不把已知错误永久冻结在旧人工修订内。
- 官方来源仅接受 `gov.cn`，逐跳验证重定向；解析后校验节日完整性、补班日期、冲突和校验和，刷新失败保留已验证缓存并标记 `refresh_failed`。
- 年份选择扩展至 2007 至 2100；未来无官方快照时前端禁用保存，后端同时返回 409，避免接口绕过。
- 补班日优先于普通周末停排，进入统一排班顺延队列；全年预览返回格子左上角真实值班人。
- 日历格增大日期与状态文字，依次显示值班人、日期、农历、节假日/周末/补班状态；当天显示九色旋转环并支持减少动态效果。
- 左键保留停排切换，右键只选中日期并打开规则上下文。
- 设置页自动值班预览改为消费后端 400 天统一排班预览，周概览、摘要、最近预览和测试目标使用相同运行时结果。
- 本地 `start_only` 缺陷修复：只显示/生成开始事件；历史 `end_message` 不再让界面误显示晚间提醒。
- webhook 服务端增加钉钉 HTTPS 白名单、公共 DNS、端口和凭据限制；本地隔离测试必须显式设置 `ALLOW_LOCAL_WEBHOOK_TEST=1`。

### 12.2 本地验证

- 官方同步历史样本：2007/2008/2020/2023/2025/2026 全部通过；2020 延期公告覆盖冲突成功。
- 日历与例外：9/9 PASS；系统联动：15/15 PASS；子通知、规则切换和发送模式回归全部 PASS。
- `start_only_start_events=[start]`、`start_only_end_events=[]`；浏览器周五卡片仅显示 `09:15`，顶部与最近预览仅显示开始提醒。
- 2026 API：`holiday_sync.status=ready`、来源主机 `www.gov.cn`、33 个法定假日日期、6 个补班日、全年 365 天、修订号 1。
- 2027 API：无官方数据时返回待同步；前端保存按钮禁用；后端保存返回 409 且修订号不变。
- Vite 构建、三个后端服务语法检查、`git diff --check` 和浏览器控制台门禁通过。
- 完整结果：`docs/@test/duty_calendar_20260823/results.jsonl` 与 `summary.md`。

### 12.3 数据与发布边界

- 本地变更前备份：`deploy/backups/local_before_holiday_auto_sync_20260823_194641/local_devtracker_before_holiday_auto_sync_20260823_194641.sql`，SHA-256 `8EBFBDBA732F65E621A109EEAFC318A66C5763859139E742A933DA9F548ABB81`。
- 自动化仅使用本地数据库和本机隔离 webhook；测试后恢复修订、例外、换班、日志和临时规则基线。
- 本轮未执行 `git add`、commit、push、打包或生产发布。
- 系统级剩余风险已归档至 `docs/@issue/duty_calendar_residual_risks_20260823.md`，不得把本地通过结论直接等同为生产发布批准。

### 12.4 周末默认预览缺口修复

- 复现时间：2026-08-23 周日；本地周五为 `start_only`，周一至周四为 `start_and_end`，当天周日未配置。
- 原因：旧逻辑只有“当天为 `start_only`”才锚定当天；周日无当天值班项时直接选择下一次周一，导致顶部摘要和最近预览显示周一结束提醒。
- 修复：运行时排班窗口扩展至过去 14 天；没有当天值班项时，若最近实际值班日为 `start_only`，摘要和列表共同锚定该日。
- 浏览器全新加载断言：周五开始摘要存在、最近周五开始存在、周一结束 0、周五结束 0、周五卡片仅 `09:15`、控制台错误/警告 0。
- 后端对照回归：`start_only_start_events=[start]`、`start_only_end_events=[]`、`start_and_end_end_events=[end]`；说明修复没有把其他日期的双通知能力错误关闭。
- 前端生产构建：PASS，1686 modules；仅保留既有大分块提示。
- 本次仍仅修改本地，未提交、未推送、未发包、未发布生产。

### 12.5 发送策略条数与真实执行加固

- 单日编辑弹窗新增独立的开始/结束预览行和条数提示：已配置周一双通知显示 2 条，已配置周五仅开始显示 1 条。
- 未排班周日选择双通知时展示 2 条模板，同时以警示文案说明实际不会触发；未把未排班模板伪装成真实任务。
- 单日与批量保存新增文案完整性检查；后端规则标准化新增不可绕过校验，轮换模板即使自身 `enabled=false`，只要按轮换范围会进入实际排班，仍必须提供结束文案。
- 后端调度回归结果：`start_only_start_events=[start]`、`start_only_end_events=[]`、`start_and_end_start_events=[start]`、`start_and_end_end_events=[end]`。
- 本地 API 负向验证：固定和轮换两种缺少结束文案的 `start_and_end` 请求均返回 HTTP 400，临时测试规则残留为 0。
- 浏览器负向定位曾无内容变化地保存现有规则两次；已精确删除本轮生成的 2 条测试消息，并将规则 `updated_at` 恢复至原最近业务保存时间 `2026-08-23T15:08:07.000Z`，排班配置内容未变化。
- 集成回归：日历与例外 9/9 PASS，系统联动 15/15 PASS；前端构建 1686 modules PASS，浏览器 0 error / 0 warn。
- 本轮继续仅修改本地；未提交、未推送、未发包、未发布生产。

### 12.6 生效日前节假日误显排班修复

- 根因：全年日历元数据使用最新官方快照着色，但统一排班预览对首个修订生效日前日期按旧逻辑返回模板人员；两者叠加后形成“红色节假日仍有人值班”的矛盾视觉。
- 后端年度日历响应新增只读字段 `first_effective_from`，供前端准确识别首个修订之前的只读范围；未改变 `resolveDutyDate`、轮换游标或自动任务调度行为。
- 前端日期姓名增加整日停排过滤；停排日详情不再泄露旧模板人员，改为明确展示不生成值班通知。
- 生效日前左键覆盖、停排日/未配置日临时换班入口一并禁用，避免产生保存后不生效或被后端拒绝的草稿。
- 回归边界：`2026-10-01` 至 `2026-10-07` 必须整日停排且无人员/事件；`2026-10-10` 官方补班必须正常排班；生效日前历史执行数据保持不变。
- 本轮仅修改本地开发环境，不推送、不发包、不发布生产。
- 既有隔离测试增加首个修订动态边界、异常残留指纹清理和时间戳恢复；本机 webhook 仅在测试进程及一次隔离后端会话中使用现有 `ALLOW_LOCAL_WEBHOOK_TEST=1`，完成后后端已恢复普通安全模式。
- 最终结果：聚焦节假日矩阵 PASS；既有日历与例外回归 9/9 PASS；浏览器 0 error / 0 warning；数据基线守恒。

### 12.7 生效日前补班展示投影

- `previewDutySchedule` 新增默认关闭的 `presentationBeforeFirstEffective` 参数；HTTP 预览接口仅在请求体严格传入 `presentation_before_first_effective=true` 时启用。
- 展示分支以当前年份最新修订或草稿为来源，将只读投影的 `effective_from` 临时前移至当年 `01-01`，复用 `simulateRevisionSegment` 计算首个真实生效日前的人员与通知事件。
- 投影结果增加 `presentation_only=true` 和 `runtime_effective_from` 标记；它只替换预览响应中的生效日前日期，不写库、不加入修订上下文、不参与换班执行，也不影响生效日及之后的真实结果。
- 前端仅在加载全年日历时显式启用该参数；单日换班预览、影响预览、自动调度及通知解析保持原入口和原行为。
- 2026 年 6 个官方补班日页面与接口全部有值班人员；4 个历史补班日标记为展示投影，2 个生效期内补班日与运行时结果逐字段一致。
