# 2026-08-23 节假日与值班通知回归总结

## 结论

- 本轮本地需求验收：`14 功能 PASS / 2 ISSUE / 0 FAIL / 0 BLOCKER`；另有 `2 TOOL PASS` 用于证据脱敏和测试隔离校验。
- 节假日全年日历、官方历史/未来年度同步、补班正常排班、右键选日、姓名/农历/状态展示、当天九色环均已实现并通过本地验证。
- 自动值班 `start_only` 已修复：周五配置只显示 `09:15`，顶部和最近一次通知预览只有“开始”通知；后端结束事件数量为 0。
- 周末补充回归已通过：周日默认打开页面时回看最近值班日周五，不再跳到周一显示结束提醒；周一至周四原有双通知配置仍保持不变。
- 双通知一致性已加固：已排班双通知明确显示 2 条并生成开始、结束两个真实事件；仅开始显示 1 条且结束时刻无事件；缺少结束文案的双通知请求由前端和后端共同阻止。
- 本轮没有提交、推送、打包或发布生产，也没有调用真实 webhook。

## 自动化结果

| 验证项 | 结果 |
| --- | --- |
| 官方节假日历史同步 | 2007/2008/2020/2023/2025/2026 全部 PASS |
| 日历与例外规则 | 9/9 PASS |
| 系统联动集成 | 15/15 PASS |
| 子通知、值班切换、发送模式 | PASS |
| 发送策略条数 | `start_only=1`、`start_and_end=2`；未排班实际为 0 |
| 双通知接口校验 | 固定与轮换缺少结束文案均返回 HTTP 400，残留测试规则 0 |
| 未来年份保护 | 2027 无官方数据时前端禁用保存，后端返回 409 |
| 安全校验 | 私网 webhook 默认拒绝，仅显式本地测试开关可用 |
| 前端构建 | PASS，1686 modules；仅既有 chunk size warning |
| 后端语法与 diff | PASS |
| 浏览器控制台 | 0 error / 0 warn，仅 Vite debug 日志 |

## 证据

- `docs/@test/duty_calendar_20260823/evidence/holiday-calendar-desktop-20260823.png`
  - 116,870 字节
  - SHA-256 `09862017CD03E9C3B18EB236F4312D9C452F4A69B74EA63504E3CEE567957B4B`
- `docs/@test/duty_calendar_20260823/evidence/start-only-browser-assertions.txt`
  - 脱敏浏览器 DOM 断言，记录顶部摘要、周五卡片、最近预览和否定匹配结果。
  - 1,288 字节
  - SHA-256 `C98BE4FC0BF388B645C296AC0454E7B1C5BBFF7EB13D24E6CE5D69A50F3ECD3A`
- `docs/@test/duty_calendar_20260823/evidence/duty-send-mode-both-two-items.png`
  - 已排班周一双通知的 2 条独立预览。
  - 119,554 字节
  - SHA-256 `EFC705A9234DF99DCFBBFA5B39E4BD4FF94F740869F7E8EB90BEBE4FF0E54A19`
- `docs/@test/duty_calendar_20260823/evidence/duty-send-mode-unconfigured-both.png`
  - 未排班周日可预览 2 条模板，但明确提示实际不会触发。
  - 120,030 字节
  - SHA-256 `4041EDD2C1D59630AD8855C3CF37AC8E541102351C356CAF2FD6CD71FDD86B50`
- 本地变更前备份：`deploy/backups/local_before_holiday_auto_sync_20260823_194641/local_devtracker_before_holiday_auto_sync_20260823_194641.sql`
  - 1,219,275 字节
  - SHA-256 `8EBFBDBA732F65E621A109EEAFC318A66C5763859139E742A933DA9F548ABB81`

## 命令与运行边界

```powershell
node backend/scripts/verify_official_holiday_sync_20260823.js
$env:ALLOW_LOCAL_WEBHOOK_TEST='1'; node scripts/verify_duty_calendar_and_exceptions.js
$env:ALLOW_LOCAL_WEBHOOK_TEST='1'; node scripts/verify_duty_calendar_system_integration.js
$env:ALLOW_LOCAL_WEBHOOK_TEST='1'; node scripts/verify_child_notifications_and_duty_switch.js
npm.cmd run build
node --check backend/src/services/OfficialHolidaySyncService.js
node --check backend/src/services/AutoTaskService.js
node --check backend/src/services/DutyCalendarService.js
git diff --check
```

- webhook 自动化只向本机隔离接收器发送；测试开关仅存在于当前本地后端进程环境中，默认生产行为仍是严格钉钉白名单。
- 首次从仓库根目录执行测试时，测试脚本未读取 `backend/.env`；改为后端目录执行后通过，属于执行路径问题，不是产品失败。
- 官方来源同步曾出现一次 10 秒网络超时，立即重试成功；有效缓存未被空结果覆盖。
- 值班回归脚本首次重跑时，本地常驻调度器抢先消费了临时测试事件；暂停调度器后隔离重跑通过，并立即恢复本地 3001 服务。该现象归类为测试竞争，不是产品发送失败。
- 浏览器负向校验产生的 2 条无内容变化保存日志已删除，规则更新时间恢复为测试前最近业务保存时间；最终 `temporary_rules=0`、`remaining_test_messages=0`、`invalid_active_both=0`。

## 剩余风险

1. 当前系统写接口整体缺少统一服务端认证/授权中间件；这是发布前必须独立治理的系统级问题。
2. 跨年通知日期、跨年轮换游标和多实例同步锁仍需专项验证；本轮不把年度样本通过扩大解释为这些边界已认证。

详细风险见 `docs/@issue/duty_calendar_residual_risks_20260823.md`。
