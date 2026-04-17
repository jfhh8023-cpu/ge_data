# DevTracker v1.4.0 开发归档

> 归档时间：2026-04-16 23:49
> 作者：2698-jfzhu8023
> 生产地址：http://jfzhu8023.cloud/devtracker/

## 一、版本概述

v1.4.0 是 DevTracker 工时统计系统的一次大版本迭代，包含 **7项功能增强** + **多轮bug修复** + **数据迁移**。

## 二、已完成的功能清单

### 第一批：7项核心增强（T1-T7）

| 编号 | 需求描述 | 修改文件 | 状态 |
|------|---------|---------|------|
| T1 | 任务标题加"语音业务线"前缀 | `CreateTaskModal.vue` | ✅ |
| T2 | 生产环境URL路径适配 | `PermissionPage.vue` | ✅ |
| T3 | 底部版本信息 v1.4.0 + 作者 | `App.vue`, `main.css` | ✅ |
| T4 | 雷达追踪风格SVG Logo | `AppHeader.vue`, `main.css` | ✅ |
| T5 | 权限控制页访问链接跳转修复 | `PermissionPage.vue` | ✅ |
| T6 | 任务收集页分页+季度Tab | `TaskList.vue` | ✅ |
| T7 | 周期统计需求名称合并去重 | `StatsPage.vue` | ✅ |

### 第二批：UI/UX优化

| 编号 | 需求描述 | 修改文件 | 状态 |
|------|---------|---------|------|
| U1 | Q1-Q4大页签（卡片式，显示数量） | `TaskList.vue` | ✅ |
| U2 | 所有URL使用 jfzhu8023.cloud 域名 | `deploy.py` | ✅ |
| U3 | 填写页双栏布局+右侧历史面板 | `FillPage.vue`, `fill.js`(后端) | ✅ |

### 第三批：Bug修复 + 数据纠正

| 编号 | 问题描述 | 修改文件 | 状态 |
|------|---------|---------|------|
| B1 | 周期从周日-周六→周一-周日 | DB迁移脚本 `fix_week_dates.py` | ✅ |
| B2 | Q4跨年周归入Q1 → 改用end_date判季度 | `TaskList.vue`, `FillPage.vue` | ✅ |
| B3 | 第14周(03-30~04-05)应归Q2 | `TaskList.vue`, `FillPage.vue` | ✅ |
| B4 | 权限链接打开后一直加载 | `router/index.js`, `stores/auth.js` | ✅ |
| B5 | 版本号列合并显示 | `StatsPage.vue` | ✅ |
| B6 | 选中行颜色加深 | `main.css` | ✅ |
| B7 | 需求工时统计默认最新任务 | `ReportPage.vue` | ✅ |
| B8 | deploy.py Unicode编码异常 | `deploy.py` | ✅ |

## 三、关键技术决策

### 3.1 季度归属规则
```
规则：使用 end_date 判定任务所属季度
原因：跨季度/跨年的周任务应归入结束日所在的季度
示例：第14周(03-30~04-05) → end_date=04-05 → Q2
```

### 3.2 周期计算公式（周一~周日）
```javascript
// CreateTaskModal.vue - calculateRange('week', refDate)
const dayOfWeek = today.getDay() || 7  // Sun=7, Mon=1
const lastMonday = new Date(today)
lastMonday.setDate(today.getDate() - dayOfWeek - 6) // 上周一
const lastSunday = new Date(lastMonday)
lastSunday.setDate(lastMonday.getDate() + 6)        // 上周日
```

### 3.3 权限链接传递
```javascript
// router/index.js - 路由守卫传递 to.query
await authStore.init(to.query)

// stores/auth.js - init() 优先读路由参数
async init(routeQuery = null) {
  const queryToken = routeQuery?.token || urlParams.get('token')
}
```

### 3.4 填写页历史API
```
GET /api/fill/:token/history
返回该 staff 的全部历史任务及工时记录，按 start_date DESC 排序
前端按年份+季度筛选，支持展开/收起
```

## 四、部署信息

| 项目 | 值 |
|------|-----|
| 服务器 | jfzhu8023.cloud (43.138.150.37) |
| 前端路径 | /opt/devtracker/frontend/dist/ |
| 后端路径 | /opt/devtracker/backend/ |
| 进程管理 | pm2 (name: devtracker) |
| 后端端口 | 3001 |
| Nginx子路径 | /devtracker/ |
| BASE_URL | /devtracker/ (vite.config.js) |
| 数据库 | MySQL devtracker |
| 部署命令 | `python deploy.py --skip-db` |

## 五、当前周数确认

```
2026年4月13日（周一）起 = 第16周
2026年4月6日（周一）起  = 第15周
2026年4月20日（周一）起 = 第17周
```

## 六、已知遗留问题

1. **旧任务标题格式不统一**：第16周之前的任务标题是旧格式（"语音业务线-2026年第N周工时统计"），新创建的会自动使用新格式（"XXXX年XX月XX日-XXXX年XX月XX日，本年度第N周语音业务线工作统计"）
2. **第6-8周数据缺失**：Q1中第6-8周没有创建任务（数据库中无对应记录）
3. **服务器Node版本**：生产环境 Node.js v16.20.2，部分依赖要求>=18（body-parser等有警告但不影响运行）
