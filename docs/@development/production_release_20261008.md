# 生产发布记录 v3.6.0 — 系统启用设置（2026-10-08）

## 内容

- REQ-074 系统启用设置：设置页「节假日跳过设置」右侧新增「系统启用设置」按钮；弹窗内系统开关 + 关闭时必填的展示内容，可反复修改。
- 系统关闭时填写工时页仅显示不可关闭弹窗（无关闭按钮、遮罩/Esc 无效、表单不渲染）；后端 `GET /api/fill/:token` 返回 `blocked/system_disabled`，`draft`/`submit`/`editing` 403。
- 新表 `system_settings`（键值，启动时 `sync()` 自动建表）；既有表结构与数据未改动。
- 提交 `dafc152`，tag `v3.6.0`，已推送 gitlab / github / gitee（`master` 与 `codex/effective-hours-20260917`）。

## 发布

- 备份：`/opt/devtracker/.release-backups/20261008_030322`（mysqldump + 应用 tar），本地 `deploy/backups/release_20261008_030322`。
- 发布：`python deploy/release.py backup` → `deploy`，03:04:45Z 切换代码并 `pm2 restart devtracker`。
- 验证：health `3.6.0`、PM2 online、公网 `/`、`/stats`、`/tasks`、`/api/health` 均 200；表行数对比仅新增 `system_settings`（0 行），其余不变；`GET /api/settings/system-access` → `enabled: true`；填写链接正常返回非阻断数据；PM2 日志无新错误。
- 证据：`docs/@test/production_release_20261008/`。

## 回退

- 代码回退：`bash /opt/devtracker/.release-backups/20261008_030322/rollback.sh`（仅还原代码，保留数据库）。
- `system_settings` 表为新增且无其他表引用，回退后可保留或手动 `DROP TABLE system_settings`。

## 使用说明

1. 设置页 → 「系统启用设置」→ 关闭开关 → 填写展示内容 → 提交；所有填写链接立即显示该内容且不可操作。
2. 重新开启：再次打开弹窗，开关打开后提交；内容会保留，下次关闭时可直接修改。
