# DevTracker — 项目状态快照

> **最后更新**：2026-04-17 (v1.5.0)  
> **用途**：换账号/新对话时的衔接入口文档

---

## 当前版本：v1.5.0

### 项目简介
DevTracker 是一个**工时追踪系统**，用于语音业务线团队的周度工时收集、汇总统计和报表展示。

### 技术栈
- **前端**：Vue 3 + Vite + Element Plus + Pinia
- **后端**：Node.js (Express) + Sequelize ORM  
- **数据库**：MariaDB（生产）/ MySQL 8.0（本地），数据库名 `devtracker`
- **运行环境**：Windows（开发）/ CentOS 7 + Node v16.20.2（生产）

### 项目目录结构
```
d:\PythonTEST\My_Other_Tool_System\get_data\get_data\
├── backend/
│   ├── src/
│   │   ├── app.js              # Express 入口
│   │   ├── models/             # Sequelize 模型
│   │   │   ├── index.js        # 模型注册 & 关联
│   │   │   ├── CollectionTask.js
│   │   │   ├── WorkRecord.js
│   │   │   ├── Staff.js
│   │   │   ├── FillLink.js
│   │   │   └── MatchGroup.js
│   │   └── routes/
│   │       ├── staff.js        # 人员管理
│   │       ├── tasks.js        # 任务CRUD + 链接生成 + 活动状态
│   │       ├── records.js      # 工时记录CRUD
│   │       ├── report.js       # 需求工时统计报表
│   │       ├── fill.js         # 工时填写（token认证）
│   │       ├── stats.js        # 周期统计（部门+个人）
│   │       └── permissions.js  # 权限管理
│   └── .env                    # 数据库配置
├── frontend/
│   ├── src/
│   │   ├── api/index.js        # Axios 实例（baseURL: /api）
│   │   ├── stores/
│   │   │   ├── task.js         # 任务列表 + 季度分组
│   │   │   ├── record.js       # 工时记录
│   │   │   ├── stats.js        # 统计数据
│   │   │   ├── report.js       # 报表数据
│   │   │   └── staff.js        # 人员数据
│   │   ├── utils/
│   │   │   └── sync.js         # [v1.2.0新增] BroadcastChannel 跨页面同步
│   │   ├── views/
│   │   │   ├── TaskList.vue    # 任务收集页（按季度分组）
│   │   │   ├── TaskDetail.vue  # 任务详情（提交数据/链接管理/汇总）
│   │   │   ├── FillPage.vue    # 工时填写页（含识别引擎）
│   │   │   ├── StatsPage.vue   # 周期统计（部门全观/个人聚焦）
│   │   │   ├── ReportPage.vue  # 需求工时统计
│   │   │   ├── PermissionPage.vue  # 权限管理
│   │   │   └── PersonnelPage.vue   # 人员管理
│   │   ├── components/         # 通用组件
│   │   ├── router/index.js     # Vue Router 配置
│   │   └── App.vue             # 根组件
│   └── vite.config.js          # Vite配置（proxy→3001）
└── docs/
    ├── @demand/               # 需求文档
    │   ├── requirements_v1.1.0.md
    │   └── requirements_v1.2.0.md
    ├── @plan/                 # 开发计划
    │   ├── development_plan_v1.1.0.md
    │   └── development_plan_v1.2.0.md
    ├── @development/          # 开发过程日志
    │   └── session_log_v1.2.0.md  ← 本次会话详细日志
    └── @architecture/         # 架构设计文档
```

### 启动命令
```powershell
# 后端（端口3001）
cd d:\PythonTEST\My_Other_Tool_System\get_data\get_data\backend
node src/app.js

# 前端（端口5173，proxy到3001）
cd d:\PythonTEST\My_Other_Tool_System\get_data\get_data\frontend
npm run dev
```

### 数据库信息
- 主机：localhost
- 端口：3306
- 用户：root
- 密码：123456（在 .env 中配置）
- 数据库：devtracker

---

## 版本历史

| 版本 | 日期 | 主要内容 |
|:---|:---|:---|
| v1.0.0 | 2026-04-15 | 全栈生产迁移（Vue3+Node+MySQL） |
| v1.1.0 | 2026-04-15~16 | 21项功能需求（智能匹配/周期统计/权限/活动状态等） |
| v1.1.1 | 2026-04-16 | UI/UX补丁（白屏修复/列拆分/PM高亮/一起查看） |
| v1.2.0 | 2026-04-16 | 8项优化 + 2项Bug修复 |
| v1.4.0 | 2026-04-16 | 填写页双栏布局 + 历史记录面板 |
| v1.4.1 | 2026-04-16 | 填写页UI优化 + 收集状态显示 |
| v1.4.2 | 2026-04-17 | 多页面Bug修复 + 功能增强（7类问题） |
| v1.4.3 | 2026-04-17 | 产品经理列修复 + 加载动画 + 权限链接适配 |
| v1.4.4 | 2026-04-17 | 实时报表 + 个人聚焦优化 + 图表修复 |
| **v1.5.0** | **2026-04-17** | **钉钉私聊消息发送（Playwright + 页面内二维码）** |

### v1.5.0 变更摘要

1. ✅ 新增 `DingtalkService.js`：headless Chromium 操控钉钉网页版
2. ✅ 新增 `/api/dingtalk` 路由：status / login/qrcode / login/poll / send
3. ✅ `TaskDetail.vue` 链接管理 Tab：钉钉状态指示器（绿/红） + 二维码 Popover
4. ✅ 发送按钮接入真实 API，支持 loading 状态和精确错误提示
5. ⏳ 待测试：需首次扫码验证选择器准确性（测试账号：朱俊锋）

### 特别注意

- `backend/src/config/dingtalk-session.json` 为登录会话文件，不入 Git，本地保存
- 生产环境部署前需先在本地完成选择器调试和端到端测试
- 仅对「朱俊锋」账户测试，其他人员暂不发送

---

## 生产环境信息

- **访问地址**：http://jfzhu8023.cloud/devtracker/（管理员: ?admin=1）
- **服务器**：43.138.150.37 / CentOS 7
- **前端**：Nginx 静态资源 /opt/devtracker/frontend/dist/
- **后端**：Express 3001 端口，PM2 进程名 devtracker
- **部署脚本**：`python deploy/deploy.py`（可加 `--skip-db` / `--skip-build`）

---

## 衔接须知

### 新对话开始时参考

1. 先读本文件了解项目全貌
2. 详细变更看 `docs/development/` 目录下各版本归档文档
3. 需求规格看 `docs/@demand/` 或 `docs/demand/`

### 当前进行中

v1.5.0 钉钉发送功能本地开发完成，待首次扫码测试（验证选择器）后确认功能可用。
