# DevTracker 全系统链接清点与 HTTP/HTTPS 兼容修复 — 2026-06-15

> 目标：先逐项遍历系统所有链接、跳转、复制地址、API 代理与部署入口，再执行 HTTP/HTTPS 全协议支持，避免遗漏生产深链。

---

## 1. 根因定位

| 项 | 检查结果 |
|---|---|
| 生产 HTTP 深链 | `http://jfzhu8023.cloud/devtracker/tasks?admin=1` 返回 `200 OK` |
| 生产 HTTPS 深链 | `https://jfzhu8023.cloud/devtracker/tasks?admin=1` 返回 Nginx `404` |
| HTTP 无尾斜杠 | `http://jfzhu8023.cloud/devtracker?admin=1` 被 HTTP catch-all 转发到其他服务，返回 JSON `404` |
| 前端路由模式 | `createWebHistory(import.meta.env.BASE_URL)`，生产 base 为 `/devtracker/`，必须依赖 Nginx SPA fallback |
| 线上 Nginx 实况 | `/etc/nginx/conf.d/unified.conf` 的 80 server 有 `/devtracker/`，`/etc/nginx/conf.d/sandilizi-ssl.conf` 的 443 server 没有 `/devtracker/` |

结论：截图中的 404 是 HTTPS server block 缺少 DevTracker location 与 SPA fallback；同时 `/devtracker` 无尾斜杠缺少精确重定向。

---

## 2. 全系统链接清单

### 2.1 前端生产路由

| 路由 | 入口/来源文件 | 类型 | HTTP/HTTPS 要求 |
|---|---|---|---|
| `/` | `frontend/src/router/index.js` | redirect 到 `/tasks` | 两协议均由 `/devtracker/` fallback 到 `index.html` |
| `/access?token=...` | `router/index.js`、`PermissionPage.vue` | 权限链接入口 | 两协议均支持，保留 query 并跳转 `/tasks` |
| `/tasks` | `AppHeader.vue`、默认首页 | 管理端页面 | 两协议深链直开 |
| `/tasks/:id` | `TaskList.vue`、`BackButton.vue` | 任务详情 | 两协议深链直开 |
| `/report` | `AppHeader.vue` | 需求工时统计 | 两协议深链直开 |
| `/stats` | `AppHeader.vue` | 周期统计 | 两协议深链直开 |
| `/personnel` | `AppHeader.vue`、`BackButton.vue` | 团队人员 | 两协议深链直开 |
| `/permissions` | `AppHeader.vue`、`BackButton.vue` | 权限控制 | 两协议深链直开 |
| `/settings` | `AppHeader.vue` | 设置 | 两协议深链直开 |
| `/pm/view/:token?year=&quarter=&month=` | `PersonnelPage.vue`、`StatsPage.vue` | PM 专属查看外链 | 两协议生成绝对地址，深链直开 |
| `/fill/:token` | `PersonnelPage.vue` | 研发人员填写外链 | 两协议生成绝对地址，深链直开 |
| `/403` | `router/index.js` | 无权限页 | 两协议深链直开 |

### 2.2 页面内跳转与打开新窗口

| 来源文件 | 链接/跳转 | 检查结论 |
|---|---|---|
| `AppHeader.vue` | 主导航 `/tasks` `/report` `/stats`；徽章 `/personnel` `/permissions` `/settings` | Vue Router 内部跳转，跟随当前协议 |
| `BackButton.vue` | 返回 `/tasks` 或 `router.back()` | Vue Router 内部跳转，跟随当前协议 |
| `TaskList.vue` | `router.push(/tasks/:id)` | Vue Router 内部跳转，深链依赖 Nginx fallback |
| `StatsPage.vue` | Canvas PM 标签 `window.open(routeData.href)` | `router.resolve` 生成 base-aware 地址，跟随当前协议 |
| `StatsPage.vue` | PM 卡片 `<router-link target="_blank">` | Vue Router 生成 base-aware 地址，跟随当前协议 |
| `PersonnelPage.vue` | 打开填写链接、PM 链接 | 已统一为 `buildAppUrl()`，跟随当前页面 HTTP/HTTPS |
| `PermissionPage.vue` | 访问链接 `<a target="_blank">` | 已统一为 `buildAppUrl()`，跟随当前页面 HTTP/HTTPS |
| `utils/excel.js` | 模板下载 `window.open(/devtracker/api/excel/template/:page)` | 已统一为 `getApiBasePath()`，两协议走同源 API |

### 2.3 复制到外部的链接

| 链接 | 来源文件 | 格式 | 修复结果 |
|---|---|---|---|
| 研发人员填写链接 | `PersonnelPage.vue` | `{origin}{BASE_URL}fill/{token}` | 当前 HTTP 页复制 HTTP，HTTPS 页复制 HTTPS |
| 研发人员填写链接+通知文本 | `PersonnelPage.vue` | `{姓名}同学 + 预设文本 + 链接` | 同上，复制函数兼容 HTTP/HTTPS |
| PM 专属查看链接 | `PersonnelPage.vue` | `{origin}{BASE_URL}pm/view/{token}` | 当前协议生成 |
| 权限访问链接 | `PermissionPage.vue` | `{origin}{BASE_URL}access?token={token}` | 当前协议生成；HTTP 下也可复制 |

### 2.4 API 与下载入口

| 类别 | 路径 | 来源 | HTTP/HTTPS 要求 |
|---|---|---|---|
| Axios API | `/devtracker/api/*` | `frontend/src/api/index.js` | 两协议同源代理到 `127.0.0.1:3001/api/*` |
| Excel 上传 | `/devtracker/api/excel/upload` | `frontend/src/utils/excel.js` | 两协议同源代理 |
| Excel 模板 | `/devtracker/api/excel/template/:page` | `frontend/src/utils/excel.js` | 两协议同源代理 |
| 后端路由组 | `/api/staff` `/api/tasks` `/api/records` `/api/report` `/api/fill` `/api/stats` `/api/permissions` `/api/excel` `/api/settings` `/api/pm` `/api/quotes` `/api/health` | `backend/src/app.js` | 均经 Nginx `/devtracker/api/` 代理 |

### 2.5 非生产/历史链接

| 位置 | 链接 | 处理 |
|---|---|---|
| `index.html`、`demo/index.html`、`js/core.js`、`demo/js/core.js` | Hash 路由 `#/tasks` 等 Demo 链接 | 非当前 Vue/Vite 生产入口，不参与本次生产协议修复 |
| `backend/src/services/AutoTaskService.js` | 钉钉 webhook URL | 外部 webhook，不属于 DevTracker 页面深链 |

---

## 3. 实施清单

| 模块 | 文件 | 改动 |
|---|---|---|
| 前端 URL 工具 | `frontend/src/utils/url.js` | 新增 `buildAppUrl()`、`getApiBasePath()`、`copyToClipboard()` |
| API base | `frontend/src/api/index.js`、`frontend/src/utils/excel.js` | 移除硬编码 `/devtracker/api`，改由统一工具生成 |
| 人员/PM 链接 | `frontend/src/views/PersonnelPage.vue` | 填写链接和 PM 链接统一按当前 origin + BASE_URL 生成 |
| 权限链接 | `frontend/src/views/PermissionPage.vue` | 访问链接统一按当前 origin + BASE_URL 生成，并支持 HTTP 复制降级 |
| Nginx 片段 | `deploy/nginx-devtracker.conf`、`deploy/nginx-notification-system.conf` | 增加 `/devtracker` 精确重定向、HTTP/HTTPS 可复用 location、转发协议头 |
| 部署脚本 | `deploy/deploy.py`、`deploy/ensure_nginx_devtracker.py` | 部署时同时修复 80/443 Nginx server block |
| 需求基准 | `docs/@demand/requirements.md` | 新增 REQ-039 |

---

## 4. 验证清单

| 验证项 | 结果 |
|---|---|
| `npm run build` | 通过；仅有 Vite chunk size warning |
| `python -m py_compile deploy/ensure_nginx_devtracker.py deploy/deploy.py` | 通过 |
| `git diff --check` | 通过 |
| 生产数据库备份 | 已完成：`deploy/backups/20260615_114325/devtracker_20260615_114325.sql`，约 988.5 KB |
| `nginx -t` | 通过 |
| Nginx HTTP 配置备份 | `/etc/nginx/conf.d/unified.conf.bak.before-devtracker-https-20260615114350` |
| Nginx HTTPS 配置备份 | `/etc/nginx/conf.d/sandilizi-ssl.conf.bak.before-devtracker-https-20260615114350` |
| `http://jfzhu8023.cloud/devtracker/tasks?admin=1` | `200 OK` |
| `https://jfzhu8023.cloud/devtracker/tasks?admin=1` | `200 OK` |
| `http://jfzhu8023.cloud/devtracker?admin=1` | 跟随重定向后 `200 OK` |
| `https://jfzhu8023.cloud/devtracker?admin=1` | 跟随重定向后 `200 OK` |
| `http://jfzhu8023.cloud/devtracker/api/health` | `200 OK` |
| `https://jfzhu8023.cloud/devtracker/api/health` | `200 OK` |
| `https://jfzhu8023.cloud/devtracker/report?admin=1` | `200 OK` |
| `https://jfzhu8023.cloud/devtracker/stats?admin=1` | `200 OK` |
| `https://jfzhu8023.cloud/devtracker/personnel?admin=1` | `200 OK` |
| `https://jfzhu8023.cloud/devtracker/permissions?admin=1` | `200 OK` |
| `https://jfzhu8023.cloud/devtracker/settings?admin=1` | `200 OK` |
| `https://jfzhu8023.cloud/devtracker/403` | `200 OK` |
| 有效研发填写页 `/fill/<token>` | 页面 `200 OK`，API `200 OK` |
| 有效 PM 专属页 `/pm/view/<token>` | 页面 `200 OK`，API `200 OK` |
| 有效权限入口 `/access?token=<token>` | 页面 `200 OK`，权限检查 API `200 OK` |
| Playwright 浏览器验证 | `tasks`、无尾斜杠入口、`stats` 均显示业务页面且 `has404=false`；截图：`docs/@development/https_tasks_verify_20260615.png` |
| PM2 状态 | `devtracker` online，版本 `3.3.0` |
| 核心数据行数 | `collection_tasks=21`、`staff=10`、`work_records=513`、`match_groups=298`、`product_managers=11`、`staff_fill_links=10`、`access_links=1` |

---

## 5. 规约回溯

[回溯✅] 第1次回溯，已重读 `requirements.md` 与 `conventions.md`，本次变更已补充 REQ-039，并按铁律 15-17 准备归档、验证、提交、推送。
