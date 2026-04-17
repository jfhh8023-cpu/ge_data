# DevTracker — 开发人员工时统计系统

> 东方极简 SaaS · 轻量化工时采集与多维统计

## 仓库地址

- **GitHub**: <https://github.com/jfhh8023-cpu/ge_data.git>
- **生产环境**: <http://jfzhu8023.cloud/devtracker/>（管理员: `?admin=1`）

## 当前版本

**v1.4.4** (2026-04-17)

## 快速开始

```bash
# 后端（端口 3001）
cd backend
npm install
node src/app.js

# 前端（端口 5173，自动代理到 3001）
cd frontend
npm install
npm run dev

# 生产部署（需配置 deploy/.env.production）
python deploy/deploy.py
```

## 核心功能

| 模块 | 功能 |
|:---|:---|
| 任务收集 | 按年度/季度分组、新建收集周期、查看详情 |
| 任务详情 | 提交数据（内联编辑）+ 链接管理（发送/复制）+ 汇总报表 |
| 需求工时统计 | 智能匹配引擎、多维排序、可编辑备注、分页、列合计 |
| 周期统计 | 部门全观（Canvas 柱状图）+ 个人聚焦（手风琴列表） |
| 填写页 | 一键识别引擎（PM 匹配 + 工时解析 + 符号清洗） |
| 权限控制 | 访问链接管理、Token 鉴权 |
| 团队人员 | 人员增删管理、角色分类 |

## 技术栈

- **前端**: Vue 3 + Vite + Element Plus + Pinia
- **后端**: Node.js (Express) + Sequelize ORM
- **数据库**: MariaDB / MySQL
- **图表**: Canvas 2D API（零依赖）
- **部署**: Nginx + PM2 + Python 自动化脚本

## 文档目录

| 目录 | 说明 |
|:---|:---|
| `docs/@demand/` | 需求文档 |
| `docs/@plan/` | 实施计划 |
| `docs/@development/` | 开发过程记录 |
| `docs/@architecture/` | 架构设计 |
| `docs/development/` | 版本归档文档 |
| `docs/PROJECT_STATUS.md` | 项目状态快照（衔接入口） |

## Git 提交指南

```bash
# 日常提交并推送到 GitHub
git add -A
git commit -m "feat: 描述你的变更"
git push github master
```
