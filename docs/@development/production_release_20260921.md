# v3.5.0 生产发布与可撤回记录

状态：`RELEASED_AND_VERIFIED`。用户要求：先确认线上版本在远端仓库有备份，再按发版模式发布当前最新状态，不得影响线上数据。已于 **2026-09-21 20:30:48 北京时间（12:30:48 UTC）** 上线。

## 发布前：线上版本备份确认

- 只读预检 `deploy/release_preflight.py`：线上 `backend/src`（67 文件）与 `backend/package.json` 逐文件 SHA-256（归一化换行）与标签 `v3.4.0`（提交 `c1b19af`）**完全一致**，health 3.4.0，PM2 PID 31937 online。证据：[preflight.json](../@test/production_release_20260921/preflight.json)。
- 标签 `v3.4.0`（对象 `5c0d344` → `c1b19af`）原仅在 gitee，本次补推至 github、gitlab；三远端 `master` 均为 `f164325`（含全部待发功能）。`c1b19af` 为 HEAD 祖先，线上代码可从任一远端按标签完整恢复。

## 发布标识与范围

- 版本 **v3.5.0**，源提交 `a9189c9771945cbf28758f13f275f46df3341d14`；前后端 package/lock、`frontend/src/version.js` 统一 3.5.0，health 读取后端包版本。
- 内容：REQ-070 未完成需求跨周带出、REQ-071 五类标题后缀匹配与可编辑进度、REQ-072 累计工时展示/按周期存增量、填写页行级提示预留与识别示例文案；变更摘要见 `CHANGELOG.md`。
- 变更文件：`backend/src` 7 个（`models/FillLink.js`、`models/StaffFillLink.js` 仅增 getter，无 schema 变更）、`frontend/src` 5 个。**无表结构变更、无数据迁移、依赖清单与 v3.4.0 相同**（脚本比对 `dependencies` 相等后才放行，复用线上 `node_modules`）。
- 仅切换 `backend/src`、`backend/package.json`、`backend/package-lock.json`、`frontend/dist`；保留线上 `.env`、Nginx、`tianji-zeji` 等其他进程。

## 发布前备份与恢复门控

| 项目 | 实际结果 |
| --- | --- |
| 备份位置 | 服务器 `/opt/devtracker/.release-backups/20260921_122848`（700 权限）；本机 `deploy/backups/release_20260921_122848`（忽略目录，不入 Git）。 |
| 数据库 | `mysqldump --single-transaction` 流式 gzip，解压 2011204 字节、26 表、`Dump completed` 标记完整；SHA-256 `dab8e963…7d76df`（343027 字节）。 |
| 应用 | `application.tar.gz` 13512070 字节、5146 成员，含 backend 代码/依赖/.env、frontend/dist、ecosystem.config.js；SHA-256 `251d734f…aeb2fa`。 |
| 校验 | 服务器 `SHA256SUMS` 与下载后本地哈希逐文件一致。 |
| 回退入口 | `/opt/devtracker/.release-backups/20260921_122848/rollback.sh`；`sh -n` 与 `--check` 通过，返回 `ROLLBACK_READY: code only; database preserved`。仅恢复代码，不回灌数据库。 |

证据：[备份清单](../@test/production_release_20260921/backup-manifest.json)、[发布前快照](../@test/production_release_20260921/production-before.json)。

## 发布执行

工具：`deploy/release.py`（受限路径，不使用含默认导库/覆盖 .env 风险的旧 deploy.py）。

1. 本地 `vite build`（[build.log](../@test/production_release_20260921/build.log)）。
2. SFTP 上传至 `/opt/devtracker/.release-stage/a9189c977194`，**全部发布文件双端 SHA-256 一致**（[candidate-manifest.json](../@test/production_release_20260921/candidate-manifest.json)）。
3. 线上 Node 16.20.2 对 stage 内全部 `backend/src/**/*.js` 执行 `node --check` 通过。
4. 即时基线快照后按目录 `mv/cp -a` 切换，旧代码保留为 `backend/src.__prev_20260921_123030`、`frontend/dist.__prev_20260921_123030`；`pm2 restart devtracker`。
5. 脚本内置自动回退：health 未在 30s 内报告 3.5.0 即恢复旧目录并重启（本次未触发）。

## 发布后验收（规约 14.4）

- health `{"code":0,"version":"3.5.0"}`；PM2 `devtracker` PID 30234 online，restart_time 3；其他进程 `tianji-zeji` online 不变。
- **26 表行数发布前后完全一致**；`work_records` 916 条、总工时 11749.5h、进度 NULL 881 / 0 值 0、字段 CRC 校验和 `1992344318310` 前后相同。
- Nginx 两份共享配置 SHA-256 前后不变；`.env` 未触碰。
- `error.log` 自新进程启动后未被修改（末尾仍为 2026-09-15 旧记录）。
- 公网 `https://jfzhu8023.cloud/devtracker/{api/health,/,stats,tasks}` 均 200。
- 浏览器真实访问（1920px，安装写请求拦截）：任务页标题正常、页面显示 v3.5.0、统计页渲染、`pageerror` 0、失败请求 0、写请求 0；截图 [prod-tasks-1920.png](../@test/production_release_20260921/prod-tasks-1920.png)。
- 数分钟后 `release.py verify` 复检：同一 PID、结论不变。

证据：[即时基线](../@test/production_release_20260921/production-immediate-before.json)、[发布后快照](../@test/production_release_20260921/production-after.json)、[发布结果](../@test/production_release_20260921/deployment-result.json)。

## 回退与保留风险

- 回退：`sh /opt/devtracker/.release-backups/20260921_122848/rollback.sh`（先 `--check`）。仅恢复 v3.4.0 代码/dist 并重启本项目，**数据库保持上线后状态**。若需数据恢复，须先保全当前库再评估，不得自动覆盖。
- 填写页在生产上未创建 token / 未提交记录（不产生业务数据），REQ-070~072 行为以本地 fixture 与脚本验证为证据；首个真实周期填写后建议抽查带出行与统计口径。
- 生产仍为 Node 16.20.2，未重装依赖；旧 `dist.__previous_20260520_*` 与本次 `__prev_*` 目录保留，可在下次发版确认稳定后清理。
