# v3.5.1 生产发布记录（REQ-073 自动任务假期提前执行）

状态：`RELEASED_AND_VERIFIED`。上线时间见 `docs/@test/production_release_20260928/deployment-result.json`（`releasedAt`，UTC）。

## 问题与根因

- 用户反馈：生产周期时间区间与设置页定时任务倒计时和实际日期对不上。
- 排查：服务器 `Asia/Shanghai`、Node 偏移 -480、MariaDB `SYSTEM/CST`、浏览器北京时间，**无时区偏差**。
- 根因：`getGlobalScheduleSourceDates` 将停排日（法定假日/周末/手动停排）的执行时机向后顺延到下一个工作日。9-25（周五，中秋）三条"自动生成下一周任务"规则被顺延至 9-28（周一）14:00，导致周一显示倒计时 4 小时、39 周任务未在周五生成（用户 09:42 手动创建、09:58 停用三条规则）。
- 决策（用户选 B）：`task_create_notify` 主规则改为**提前**到停排区间前最后一个工作日同一时间执行；值班提醒与子通知保持顺延。设计见 `REQ-073_holiday_advance_20260928.md`。

## 变更

- 版本 3.5.0 → **3.5.1**，源提交 `fa0d964`。
- `DutyCalendarService.getGlobalScheduleAdvanceSourceDates`（新）、`AutoTaskService.getCalendarAwareScheduledAt` 增加 `advance` 选项，主规则启用。
- 设置页说明文案；无表结构变更、无数据迁移、依赖不变。

## 备份与发布（`deploy/release.py`）

- 备份：服务器 `/opt/devtracker/.release-backups/20260928_025239`（数据库 dump + 应用全量 tar，双端 SHA-256 一致，`rollback.sh --check` 通过）；本机 `deploy/backups/release_20260928_025239`。
- 发布：本地构建 → stage 双端哈希一致 → `node --check` → 依赖比对相等 → 仅切换 `backend/src` / `package*.json` / `frontend/dist` → `pm2 restart devtracker`。
- 验证：health 3.5.1、PM2 online、公网 4 个页面 200、26 表行数与 `work_records` 校验和前后一致、Nginx 哈希不变、error.log 未增长。
- 生产只读校验：`verify_req073_holiday_advance.js` 以生产日历运行 **16/16 PASS**（9-24 提前、9-28 周一不再触发、9-28 视角下次为 9-30 14:00、10-01 视角为 10-09、子通知 10-05 仍顺延至 10-08）。

## 待用户操作

- 三条"自动生成下一周任务"规则当前为**停用**状态（09:58 手动停用）。重新启用后，下次执行为 **2026-09-30（周三）14:00**（10-02 周五为国庆假期，提前至 9-30），将生成第 40 周（09-28~10-04）任务；之后 10-09（周五）14:00 正常执行。
- 39 周任务已手动创建，无需补跑。

## 回退

`sh /opt/devtracker/.release-backups/20260928_025239/rollback.sh`（先 `--check`）；仅恢复代码，数据库保持。旧目录 `backend/src.__prev_*`、`frontend/dist.__prev_*` 保留。
