# DevTracker v1.0.0 — 开发会话日志

> **创建时间**：2026-04-15 17:31  
> **当前里程碑**：M3 高级报表功能 ✅ 全部完成  
> **技术栈**：Vue 3 + Vite + Element Plus | Node.js + Express + Sequelize | MySQL 8.0  
> **MySQL 凭证**：root / 123456 | 数据库名：devtracker

---

## 环境确认

| 组件 | 版本 | 状态 |
|:---|:---|:---:|
| Node.js | v25.2.1 | ✅ |
| npm | 11.6.2 | ✅ |
| MySQL | 8.0.43 | ✅ Running (服务名:MySQL80) |
| MySQL 路径 | `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe` | ✅ |

---

## M1: 项目骨架搭建 ✅ 全部完成

### Step 1: 归档 Demo ✅
- [x] 创建 `demo/` 目录
- [x] 复制 `index.html`, `css/`, `js/` 到 `demo/`

### Step 2: 创建 MySQL 数据库 ✅
- [x] 创建数据库 `devtracker`
- [x] 创建 5 张表（collection_tasks, staff, fill_links, work_records, match_groups）
- [x] 插入 Mock 数据（6人员 + 1任务 + 6链接 + 8记录 + 3匹配组）

### Step 3: 初始化后端项目 ✅
- [x] `npm init` + 安装依赖（express, sequelize, mysql2, cors, uuid, dotenv）
- [x] 创建项目结构（config/, models/, routes/, middleware/）
- [x] 配置 Sequelize 连接（.env + database.js）
- [x] 定义 5 个数据模型 + 关联关系（models/index.js）
- [x] 实现全部 6 组路由（staff/tasks/records/report/fill/stats）
- [x] 后端启动成功 http://localhost:3001，API 验证通过

### Step 4: 初始化前端项目 ✅
- [x] Vite + Vue 3 项目 + 安装依赖（Element Plus, Pinia, Axios, Vue Router）
- [x] 配置 Vue Router（6条路由） + Pinia stores（task/staff/report）
- [x] 迁移 CSS 设计系统 → `styles/main.css`（从 Demo 1481行精简至关键令牌+布局）
- [x] AppHeader 组件（导航 + 团队徽章 + 新建按钮）
- [x] BackButton 组件
- [x] App.vue 布局（管理端 vs 填写页独立布局 + 页面过渡动画）
- [x] 6 个 View 页面组件
- [x] 配置 API 代理（vite.config.js → localhost:3001）
- [x] 删除 Vite 默认 boilerplate（style.css, HelloWorld.vue）

### Step 5: 前后端联调验证 ✅
- [x] 后端 http://localhost:3001 运行正常
- [x] 前端 http://localhost:5173 运行正常
- [x] 浏览器验证：Header 导航正常，页面切换正常
- [x] API 连通：TaskList 成功加载 Mock 数据，PersonnelPage 显示 6 名人员
- [x] 零 JS 错误

---

## M2: 核心 CRUD 前端实现 ✅ 全部完成

### Step 1: PersonnelPage CRUD ✅（M1 已提前完成）
- [x] 人员列表（角色Tag + 在职状态徽章）
- [x] 新增弹窗（姓名 + 角色单选）
- [x] 编辑弹窗
- [x] 删除确认
- [x] 集成 staffStore + Element Plus 组件

### Step 2: TaskDetail 完整交互 ✅
- [x] RecordsTab：内联编辑（编辑→input→保存/取消） + 删除确认 + API 联动
- [x] LinksTab：预设通知文本 + 复制链接 + 模拟发送 + 生成链接按钮
- [x] 新增 record store（`stores/record.js`）
- [x] 浏览器验证通过：8条记录正确展示，内联编辑流畅

### Step 3: CreateTaskModal ✅
- [x] 左右双栏布局（表单 + 日历）
- [x] 7种时间维度选择 + 日期自动计算
- [x] 日历双向联动（切维度→高亮，点日历→更新表单）
- [x] 快捷周期列表（最近5周）
- [x] 自动生成标题
- [x] 集成到 AppHeader

### Step 4: FillPage ✅
- [x] Token 加载数据 + 历史记录回显
- [x] 动态表格行（增/删）
- [x] Element Plus 多选下拉（产品经理）
- [x] 工时总计实时统计
- [x] 提交 API 调用

---

## M3: 高级报表功能 ✅ 全部完成

### Step 1: 智能匹配引擎 ✅
- [x] MatchService.js — Jaccard + 编辑距离相似度算法
- [x] 版本号匹配(0.3) + 标题相似度(0.5) + PM匹配(0.2) 加权
- [x] 自动归并(≥0.7) / 待确认(0.5~0.7) / 独立(<0.5) 阈值策略
- [x] POST /api/report/match 触发匹配 API

### Step 2: 汇总报表页 ✅
- [x] ReportPage.vue — 独立顶层页签
- [x] 任务选择器 + 排序切换（PM/前端/后端/测试）
- [x] 数据表格（序号/版本号/需求名称/PM/前端/后端/测试/总计/备注）
- [x] 列合计行 + 右上角总工时
- [x] 可编辑备注（blur 自动保存）
- [x] 手动添加行 + 分页控件
- [x] TaskDetail Tab 3 汇总报表快捷入口

### Step 3: 周期统计 — 部门全观 ✅
- [x] 三级联动筛选器（年度/季度/任务周期）
- [x] 四大概要卡片（总工时/记录数/人员数/任务数）
- [x] Canvas 柱状图（分组柱形 + 圆角 + 柱顶数值 + 图例）
- [x] 部门汇总明细表

### Step 4: 周期统计 — 个人聚焦 ✅
- [x] 后端 `/api/stats/personal/:staffId` API（按人员+时间范围查询）
- [x] 人员平铺选择器（角色色标圆点 + 选中态高亮）
- [x] 个人概要卡片（头像+姓名+角色Tag+总工时/记录数/参与周期数）
- [x] 参与任务手风琴面板（折叠/展开 + 工时明细表格）

### Step 5: Bug 修复 ✅
- [x] 修复 Stats 路由日期计算（`month-31` → `getLastDayOfMonth()` 安全计算）

---

## 变更记录

| 时间 | 操作 | 说明 |
|:---|:---|:---|
| 17:31 | 创建会话日志 | M1 开始执行 |
| 17:32 | Step 1 完成 | Demo 归档至 demo/ 目录 |
| 17:33 | Step 2 完成 | MySQL devtracker 数据库创建，5表+Mock数据 |
| 17:37 | Step 3 完成 | 后端全部文件创建，npm依赖安装，服务启动成功 |
| 17:52 | 新对话继续 | 继续 M1 Step 4 前端骨架 |
| 17:58 | Step 4 完成 | CSS设计系统 + App.vue + AppHeader + BackButton + 6个View |
| 18:01 | Step 5 完成 | 前后端联调验证通过，零JS错误 |
| 18:01 | **M1 全部完成** | 项目骨架搭建完毕，进入 M2 |
| 18:04 | M2 Step 1 | PersonnelPage CRUD 已完成（M1提前实现） |
| 18:05 | M2 Step 2 开始 | 新增 record store，重写 TaskDetail.vue |
| 18:07 | M2 Step 2 完成 | TaskDetail 三Tab全功能：内联编辑+删除+链接管理 |
| 18:10 | M2 Step 3 完成 | CreateTaskModal 日历联动弹窗，集成到 AppHeader |
| 18:11 | M2 Step 4 完成 | FillPage 动态表格+提交 |
| 18:12 | **M2 验证通过** | 浏览器全链路验证，零JS错误 |
| 20:33 | M3 Bug 修复 | 修复 stats 路由日期 Invalid date 错误 |
| 20:35 | M3 个人统计 API | 新增 `/api/stats/personal/:staffId` 后端端点 |
| 20:37 | M3 个人聚焦 | StatsPage 双Tab（部门全观+个人聚焦）实现 |
| 20:41 | **M3 全部完成** | 浏览器验证通过：智能匹配+汇总报表+周期统计全功能 |
| 21:42 | UI 修复 | 新建任务弹窗加宽(800→960px)、日历栏加宽(300→380px) |
| 21:43 | 功能增强 | 快捷周期列表支持未来2周（🔮未来/📌本周/过去4周） |
| 23:10 | **v1.0.0 结束** | 收到 v1.1.0 共 21 项需求变更 |
| 23:14 | v1.1.0 规划开始 | 编写需求文档 `requirements_v1.1.0.md` |
| 23:18 | v1.1.0 计划完成 | 编写开发计划 `development_plan_v1.1.0.md` |
| 23:20 | 等待确认 | 实施计划已提交，等待用户审批后执行 |
| 23:30 | S1-S3 完成 | Sprint 1-3 全部实施并通过浏览器验证 |
| 00:00 | S4 开始 | 后端 stats 路由改为 WorkRecord+Staff.role 聚合 |
| 00:03 | S4 前端 | StatsPage 重写：pm 柱状图+合并表+角色卡片 |
| 00:05 | **S4 验证通过** | 部门全观+个人聚焦 Tab 双验证通过 |
| 00:08 | S5 数据库迁移 | 执行 migration_v1.1.0.sql，创建 access_links/link_permissions 表 |
| 00:08 | S5-1 完成 | PersonnelPage 改为 CSS Grid 卡片布局 |
| 00:11 | S5-2 后端 | fill.js 新增编辑标记 API，tasks.js 新增活动状态查询 |
| 00:12 | S5-2 前端 | FillPage 编辑通知 + TaskList 5s 轮询活动状态 |
| 00:14 | S5-3 后端 | AccessLink/LinkPermission 模型 + permissions 路由 CRUD |
| 00:16 | S5-3 前端 | PermissionPage + permission store + AppHeader 入口 |
| 00:18 | **S5 验证通过** | 全部页面浏览器验证，零 JS 错误 |
| 00:19 | **v1.1.0 完成** | 21 项需求全部实施完毕 |

