# 当天未完成值班临时换班修复

日期：2026-09-08

状态：已推送并完成生产发布。

## 触发背景

日历保存逻辑此前只要发现当天存在成功的 `duty_start` 日志，就拒绝新增或编辑临时换班。开始提醒成功并不等于当天值班已完成，导致当班人员在未结束时无法处理临时换班。

## 需求决策

1. 当天开始提醒已成功，但当前北京时间尚未到该日期配置的结束时间时，允许新增、编辑和取消临时换班。
2. 历史日期、当前日期已到结束时间、或已经成功发送当天结束提醒时，继续禁止换班变更。
3. 只发送开始提醒的规则没有结束通知事件，仍以配置的 `end_time` 为完成边界。
4. 已成功发送的开始提醒不可撤回或补发；保存后尚未执行的结束提醒、日历预览和运行时排班均读取最终换班结果。
5. 保存年度日历时，未变更的历史换班记录不得因随附在请求中而重新写入或取消。

## 实施范围

| 文件 | 调整 |
| --- | --- |
| `backend/src/services/DutyCalendarService.js` | 新增日期可编辑性判定；保存时仅对新增、编辑、取消的换班日期进行完成态校验。 |
| `backend/src/routes/dutyCalendar.js` | 取消换班复用同一完成态校验，返回明确的锁定原因。 |
| `backend/scripts/verify_duty_calendar_and_exceptions.js` | 回归覆盖开始提醒成功但未完成可改、到结束时间锁定、结束提醒成功锁定。 |
| `docs/@demand/requirements.md` | 归档 REQ-046。 |
| `docs/@demand/duty_holiday_calendar_and_schedule_exceptions_20260821.md` | 替换旧的“开始提醒成功即锁死”规则。 |

## 验收点

1. `duty_start` 成功后、`end_time` 前保存换班返回成功。
2. 当前日期到达 `end_time` 后换班状态为不可编辑。
3. `duty_end` 成功后，即使测试时间仍早于结束时间，也判定为完成且不可编辑。
4. 删除接口和日历保存接口使用同一套判断。
5. 前端构建、后端语法检查与节假日日历回归脚本均通过；测试数据清理后数据库基线守恒。

## 风险与边界

- 当天开始提醒已经发送后，接收方可能已经看到原值班人员；系统不重写已发送内容，只使未执行事件和实时排班跟随新结果。
- 本次只调整临时换班，不放宽已发送开始通知后的人员跳过限制。
- 生产发布采用无数据库导入方式；未执行会改变生产业务数据的迁移或初始化操作。

## 本地验证记录

- `node backend/scripts/verify_duty_calendar_and_exceptions.js`：9 个 API/运行时用例通过；包含开始提醒成功后的未完成换班、结束时间锁定、结束提醒成功锁定，测试数据已清理并恢复到原有日历基线。
- `node backend/scripts/verify_same_day_unfinished_duty_swap.js`：真实本地接口新增、编辑、取消均返回 `200`；开始提醒已成功但未结束时可编辑；结束时间到达或结束提醒成功后均不可编辑；换班后的未发送结束事件人员名单已按最新最终排班重建。
- `node --check`：日历服务、日历路由和两份回归脚本通过。
- `npm run build`（`frontend`）：构建通过；仅保留既有大包体积提示，无构建错误。
- 数据清理核验：`DutyCalendarRevision=1`、`DutyScheduleSwap=0`、隔离规则数 `0`，与测试前基线一致。

## 生产发布记录

- 代码提交：`0bfe980 fix: 支持未完成值班当天临时换班`，已推送至 `gitee/master`。
- 发布前备份：`deploy/backups/20260908_094432/devtracker_20260908_094432.sql`，大小 `1,366,785` 字节，SHA-256 为 `5194DE42F7FFB2057EFF754778A64FBF542D78C51CACF3882DFBD349BC582BAD`。
- 发布方式：前后端构建文件上传后，仅重启生产 `devtracker` PM2 进程加载新代码；未导入本地数据库，未执行数据库迁移。
- 配置保护：部署脚本的 Nginx 配置校验未通过时，已立即恢复原配置；恢复后 `nginx -t` 与 reload 均通过。
- 服务验证：生产 `devtracker` 进程在线；内部健康检查通过；公网设置页返回 HTTP `200`。
- 构建完整性：生产前端 `dist` 的 41 个文件与本地构建逐一 SHA-256 一致；两处换班核心后端源码的 SHA-256 与本地一致。
- 数据守恒：发布后只读复核 `collection_tasks=33`、`staff=13`、`product_managers=14`、`work_records=849`、`work_hours=10859.50`、`match_groups=553`、`auto_task_rules=3`、`auto_task_run_logs=151`、`auto_task_messages=358`、`auto_task_child_notifications=2`、`duty_schedule_swaps=1`、`duty_calendar_revisions=1`，与发布前基线一致。
