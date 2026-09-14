# 本地虚拟机首次部署

- 日期：2026-09-14。
- 用户要求：发布到本地电脑的虚拟机服务器。
- 目标：192.168.17.133，CentOS Stream 10。
- 应用源码提交：f86bd4f。
- 构建版本：frontend 3.2.0、backend 3.3.0（沿用现有版本，按提交标识本次部署）。
- 当前状态：已完成并验收。

## 部署决策

- 目标尚无 `/opt/devtracker`，MySQL 中也不存在 `devtracker` 数据库，属于首次安装。
- 创建独立目录 `/opt/devtracker`、独立数据库 `devtracker` 和专用应用账号。
- 访问端口 8088，前端沿用 `/devtracker/` 路径，API 反向代理到 3001。
- 80 和 8020 已由其他项目使用，保持其配置和数据原样；发布前后核对服务响应。
- 默认新建空业务库，模型建表后加载系统角色与需求方目录。不导入业务数据。
- 首次安装无既有 DevTracker 数据可备份，记录不存在基线并保存新库初始结构备份。
- SSH 和数据库口令不进入 Git；数据库口令随机生成，仅保存在虚拟机权限为 600 的环境文件。

## 文件

- `deploy/install_local_vm.py`：目标受限的首次安装脚本，拒绝覆盖已有应用、库、账号和端口。
- `deploy/nginx-devtracker-vm.conf`：独立监听 8088 的 Nginx 站点。
- `.codex-local/vm-deployment/`：本机发布包、哈希清单与逐步执行记录（Git 忽略）。

## 待验收

- 发布文件 SHA-256 一致。
- 健康接口、人员、角色、需求方、统计、任务、设置接口正常。
- 页面、静态文件、直接刷新深链接可访问。
- PM2 进程在线并配置开机启动。
- 其他项目服务前后保持可用。

## 实际发布结果

- 发布提交：`d67521ca6e1357fc3a5142d92d05b4fcb7236dc6`。
- 发布包与哈希清单：本机 `.codex-local/vm-deployment/20260914_181208/`。
- 虚拟机备份与执行记录：`/opt/devtracker-deployment-backups/20260914_181208/`。
- 初始数据库备份：`/opt/devtracker-deployment-backups/20260914_181208/devtracker-initial.sql`。
- PM2：`devtracker` online，重启次数 0，已配置 `pm2-root` 开机启动。
- 数据库初始化结果：`staff=0`、`work_records=0`、`product_manager_work_records=0`、`auto_task_rules=0`、`staff_roles=5`、`demand_sources=4`。
- 外部验收：`/devtracker/`、`/devtracker/stats?admin=1`、`/devtracker/api/health`、`/devtracker/api/roles`、`/devtracker/api/demand-sources`、`/devtracker/api/stats?year=2026&quarter=Q3` 均 HTTP 200。
- 既有服务验收：80 和 8020 前后均 HTTP 200，`yuyin` 容器和 MySQL/Nginx/Docker 服务保持 active。
- 访问地址：`http://192.168.17.133:8088/devtracker/`。
