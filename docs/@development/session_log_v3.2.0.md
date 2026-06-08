# 开发日志 v3.2.0 — 产品聚焦 Tab + 金银铜排名 + PM 专属链接优化

**日期**：2026-06-08  
**执行状态**：已发版到生产环境  

---

## 一、完成内容

### 1.1 周期统计 — 新增「产品聚焦」Tab

在「周期统计（季度）」页面新增第三个 Tab **产品聚焦**，位于「个人聚焦」后面。

**后端**：新增 `GET /api/stats/pm/:pmId` 接口
- 按产品经理维度聚合工时数据
- 返回 roleSummary（前端/后端/测试工时分布）
- 支持 year / quarter / taskId 筛选

**前端 — 单独查看模式**：
- 紫色主题 PM chip 选择器
- 概要卡片（总工时 + 角色工时分布）
- 手风琴任务列表，展开后显示 el-table（含排序 + 金银铜牌）
- 默认展开最近一个有记录的周期

**前端 — 一起查看模式**：
- 三列网格卡片布局（响应式适配）
- 每个 PM 卡片显示总工时 + 前后端测试角色工时
- 默认只显示最新周期，其余收起在「展开全部周期」长条按钮下
- 展开后底部显示「▲ 收起」按钮
- 每个 PM 卡片右侧「查看全部 →」按钮，跳转 PM 专属链接（带全年参数）

### 1.2 部门全观 — 金银铜排名

每个产品经理分组内，工时前三名的需求显示 🥇🥈🥉 金银铜闪光角标效果。

### 1.3 PM 专属链接优化

- **全年展示按钮**：搜索按钮后新增「📆 全年展示」切换按钮
  - 点击切换到当前年 + 全年 + 全部月份并自动搜索
  - 再点恢复当前年季月
- **回车搜索**：筛选栏支持 Enter 键触发搜索
- **路由参数初始化**：支持从 query 参数读取 year/quarter/month，从「查看全部」跳转时默认全年
- **筛选框显示修复**：「全年/全部月份」选中后正确显示在框内（value 从 '' 改为 0）

---

## 二、涉及文件

### 新增文件

| 文件 | 说明 |
|------|------|
| `backend/src/models/ProductManager.js` | PM 数据模型 |
| `backend/src/routes/pm.js` | PM 路由（CRUD + 专属链接查看） |
| `backend/src/scripts/initPmData.js` | PM 初始数据脚本 |
| `backend/migration_v3.2.0.sql` | 数据库迁移 SQL |
| `frontend/src/stores/pm.js` | PM Pinia Store |
| `frontend/src/views/PmViewPage.vue` | PM 专属查看页 |

### 修改文件

| 文件 | 说明 |
|------|------|
| `backend/src/app.js` | 挂载 PM 路由 |
| `backend/src/models/index.js` | 注册 PM 模型 |
| `backend/src/models/Staff.js` | Staff 模型调整 |
| `backend/src/routes/staff.js` | Staff 路由调整 |
| `backend/src/routes/stats.js` | 新增 PM 聚焦统计接口 |
| `frontend/package.json` | 版本号升级 |
| `frontend/src/router/index.js` | PM 查看页路由 |
| `frontend/src/stores/stats.js` | PM 聚焦数据状态和方法 |
| `frontend/src/views/StatsPage.vue` | 产品聚焦 Tab + 部门全观金银铜 |
| `frontend/src/views/PersonnelPage.vue` | 人员页调整 |

---

## 三、部署注意事项

- **数据安全**：发版脚本使用 `--skip-db` 跳过数据库导入，不影响已有数据
- **服务隔离**：pm2 仅重启 devtracker 进程，不影响其他服务
- **Nginx**：配置已存在，无需重新注入
- **数据库变更**：PM 表通过 Sequelize `sync({ alter: true })` 自动创建/更新，无需手动执行 SQL

---

## 四、验证记录

- 后端 `stats.js` 语法检查通过
- 前端 `stats.js` Store 语法检查通过
- 本地功能验证通过
