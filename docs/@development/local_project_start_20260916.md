# 本地项目启动记录

- 日期：2026-09-16 20:17（Asia/Shanghai）。
- 用户请求：启动本地项目。
- 环境：Windows；Node.js v25.2.1；本机 MySQL 8.0.43，数据库 devtracker。
- 依据：backend/package.json、backend/.env、frontend/package.json、frontend/vite.config.js。

## 启动结果

| 服务 | 地址 | 进程 PID | 受管理终端会话 |
| --- | --- | --- | --- |
| 后端 | http://localhost:3001/api/health | 61112 | 25138 |
| 前端管理员入口 | http://localhost:5176/tasks?admin=1 | 28192 | 72219 |

PID 与会话编号仅代表本次启动。前端实际端口为 5176，README 的 5173 与当前配置不一致。

## 本地启动行为

本地数据库存在两条启用的自动通知规则。本次通过 `.codex-local/local-start-20260916/preload.cjs` 暂停当前后端进程的自动通知调度，避免本地运行向真实钉钉接收方发送消息。该预加载文件只允许连接 localhost、127.0.0.1 或 ::1 数据库，不修改数据库内规则的启用状态。应用自身启动时仍执行现有 schema 检查；没有执行导入、清库或生产操作。

后端启动命令（backend 目录）：

```powershell
node --require ../.codex-local/local-start-20260916/preload.cjs src/app.js
```

前端启动命令（frontend 目录）：

```powershell
node node_modules/vite/bin/vite.js
```

尝试使用隐藏后台进程的复合命令被工具策略拒绝；随后改用受管理的终端会话，两个服务均启动成功。进程输出保留在对应会话中。

## 验证

使用 Invoke-WebRequest 实际请求以下地址，全部返回 HTTP 200：

- 后端 `/api/health`：返回 code=0，DevTracker API is running。
- 前端 `/tasks?admin=1`：返回页面 HTML。
- 前端代理 `/api/health`：返回后端健康结果。
- 前端代理 `/api/roles`：返回本地数据库角色数据。

Get-NetTCPConnection 确认 3001 和 5176 正在监听。验证范围为启动、HTTP 页面与数据库 API 连通性，未执行完整浏览器交互回归。

## 文件

- 新建 `.codex-local/local-start-20260916/preload.cjs`，仅供本次本地启动使用。
- 新建本记录；业务源码与生产配置未修改。

## 2026-09-17 重新启动

本轮检测原服务已停止，沿用上述本地预加载方式重启后端与 Vite。后端受管理终端会话 34727，前端会话 22127；编号仅代表本次启动。后端仍暂停本地自动通知调度并限制本地数据库。

实际 HTTP 检查：后端 http://127.0.0.1:3001/api/health、前端 http://localhost:5176/stats?admin=1、前端代理 /api/health 全部返回 200。继续完成周期统计数量卡和原分组表工作，未重复创建产品演示人员或导入业务数据。

## 2026-09-17 生产数据同步后启动

同步前停止原后端session34727，恢复后以session70761启动，继续使用本地preload暂停自动通知，并设置进程环境HOLIDAY_SYNC_DISABLED=1。前端5176仍运行。三项health/页面HTTP检查通过；数据库同步与备份细节见[本次同步记录](production_data_sync_20260917.md)。
