# DevTracker v1.2.0 — 完整开发会话日志

> **会话ID**：`0e6dc129-b6a5-438c-a044-bc512c9359e9`  
> **开始时间**：2026-04-16 12:00  
> **最后更新**：2026-04-16 13:04  
> **技术栈**：Vue 3 + Vite + Element Plus + Pinia | Node.js + Express + Sequelize | MySQL 8.0  
> **服务地址**：前端 `http://localhost:5173/` 后端 `http://localhost:3001/`

---

## 一、本次会话完成的全部工作

### 阶段1：v1.2.0 需求分析与计划（12:00-12:17）

1. 查看了所有关键文件的当前状态：
   - `backend/src/routes/stats.js` — 统计路由
   - `backend/src/routes/tasks.js` — 任务路由
   - `frontend/src/views/StatsPage.vue` — 周期统计页（936行）
   - `frontend/src/views/FillPage.vue` — 工时填写页（350行）
   - `frontend/src/views/TaskDetail.vue` — 任务详情页（368行）
   - `frontend/src/views/ReportPage.vue` — 需求工时统计页（408行）
   - `frontend/src/stores/task.js` — 任务store
   - `frontend/src/stores/record.js` — 记录store
   - `frontend/src/stores/stats.js` — 统计store
2. 查询数据库确认第1周 `start_date=2025-12-28`，`end_date=2026-01-03`
3. 编写了需求文档 `docs/@demand/requirements_v1.2.0.md`（8项需求）
4. 编写了开发计划 `docs/@plan/development_plan_v1.2.0.md`（3个Sprint）

### 阶段2：Sprint 1-3 实施（12:17-12:30）

#### Sprint 1：数据修正 + 图表 + 列头 ✅

| 需求 | 文件 | 具体改动 |
|:---|:---|:---|
| REQ-22 | `backend/src/routes/stats.js` | 任务查询改用 `year + end_date` 判定 |
| REQ-23 | `frontend/src/views/StatsPage.vue` L279-284 | 柱顶标签改为 `${BAR_LABELS[bi]} ${val.toFixed(0)}` |
| REQ-24 | `frontend/src/views/StatsPage.vue` L161-167 | `rowClassName()` 合计行也参与PM选中高亮 |
| REQ-29 | `frontend/src/views/ReportPage.vue` L286/304/322 | 三处 `工时/H` 列添加 `header-class-name="dt-nowrap-header"` + CSS + 列宽70→80 |

#### Sprint 2：个人聚焦 + 排序 + 链接管理 ✅

| 需求 | 文件 | 具体改动 |
|:---|:---|:---|
| REQ-25a | `StatsPage.vue` L384-395 | 新增 `allExpandedMap` + `toggleAllTask()` + `isAllExpanded()` |
| REQ-25b | `StatsPage.vue` 模板 | 统一周期工时字体为 `font-weight:700; font-size:13px` |
| REQ-25c | `StatsPage.vue` L363-366 | `loadAllPersonalData()` 中添加 `tasks.sort` 降序 |
| REQ-25模板 | `StatsPage.vue` L701-800+ | 三列模板重写：折叠箭头+点击展开+详细记录 |
| REQ-26a | `TaskDetail.vue` L72-93 | 新增 `ROLE_SORT_ORDER` + `sortedRecords` + `sortedLinks` computed |
| REQ-26b | `TaskDetail.vue` L94-100 | 新增 `parsePM()` 安全解析函数，模板改用 `parsePM(row.product_managers)` |
| REQ-28a | `TaskDetail.vue` L131 | 预设文本改为「请填写上周工作内容，您的专属链接如下：」 |
| REQ-28b | `TaskDetail.vue` L154-175 | 拆分 `copyLinkOnly()` + `copyAll()`，操作列宽220px |

#### Sprint 3：识别引擎增强 ✅

| 需求 | 文件 | 具体改动 |
|:---|:---|:---|
| REQ-27a | `FillPage.vue` L141-184 | 新增 `matchPM()` 函数（完整匹配→回退单字模糊匹配） |
| REQ-27b | `FillPage.vue` L189-216 | 新增 `parseHoursFromText()` 函数（天/d/D/日 → ×8） |
| REQ-27c | `FillPage.vue` L210-214 | 尾部纯数字范围限制1-60 |

### 阶段3：Bug修复 - 任务收集页Q4分组（12:40-12:45）

**问题**：第1周被归到Q4（因 `start_date` 月份=12月）  
**修复文件**：`frontend/src/stores/task.js` L15-17  
**改动**：`grouped` getter 中季度判定从 `start_date` 改为 `end_date`

### 阶段4：Bug修复 - 统计双重计算 + 数据实时同步（12:46-13:04）

#### 问题1：跨季度双重计算
- **根因**：`stats.js` 的 `Op.or` 条件使第14周同时出现在Q1和Q2
- **修复**：`backend/src/routes/stats.js` 两处查询改为仅用 `end_date: { [Op.between]: [...] }`
- **结果**：Q1=2981H（10任务），Q2=490H（2任务），无重复

#### 问题2：跨页面数据实时同步
- **方案**：新建 `frontend/src/utils/sync.js`（BroadcastChannel API）
- **发送端**：`FillPage.vue` 提交成功后调用 `broadcastDataChange()`
- **接收端**：4个页面（TaskDetail/StatsPage/ReportPage/TaskList）监听广播自动刷新
- **结果**：填写页提交后，其他标签页即时更新

---

## 二、当前文件变更清单

| 分类 | 文件路径 | 操作 | 行数/大小 |
|:---|:---|:---|:---|
| **后端路由** | `backend/src/routes/stats.js` | 修改 | ~230行 |
| **前端Store** | `frontend/src/stores/task.js` | 修改 | 70行 |
| **前端工具** | `frontend/src/utils/sync.js` | **新增** | 47行 |
| **前端视图** | `frontend/src/views/StatsPage.vue` | 修改 | ~1000行 |
| **前端视图** | `frontend/src/views/TaskDetail.vue` | 修改 | ~415行 |
| **前端视图** | `frontend/src/views/FillPage.vue` | 修改 | ~400行 |
| **前端视图** | `frontend/src/views/ReportPage.vue` | 修改 | ~425行 |
| **前端视图** | `frontend/src/views/TaskList.vue` | 修改 | ~260行 |
| **文档** | `docs/@demand/requirements_v1.2.0.md` | **新增** | 需求文档 |
| **文档** | `docs/@plan/development_plan_v1.2.0.md` | **新增** | 开发计划 |

---

## 三、关键技术决策记录

### 1. 季度归属统一用 `end_date`
- 前端 `task.js` grouped getter 和后端 `stats.js` 查询均使用 `end_date` 判定季度归属
- 原因：跨年/跨季度周（如第1周/第14周）的 `start_date` 和 `end_date` 跨两个季度，用 `end_date` 可以确保每个任务只归属一个季度

### 2. 跨页面同步选用 BroadcastChannel
- 不用 WebSocket（太重）、不用 localStorage event（兼容性限制）
- BroadcastChannel 是专为同源多标签页通信设计的原生 API
- 每个接收端在 `onUnmounted` 中调用 cleanup 函数关闭 channel

### 3. PM匹配策略
- 优先完整名字匹配 → 无匹配时回退单字模糊匹配
- 模糊匹配按「匹配比例」排序取最佳（避免误匹配）

---

## 四、当前项目运行状态

- ✅ 后端运行在 `http://localhost:3001/`（需手动启动 `node src/app.js`）
- ✅ 前端运行在 `http://localhost:5173/`（Vite dev server，需手动启动 `npm run dev`）
- ✅ MySQL 8.0 运行中，数据库名 `devtracker`
- ✅ 所有页面无JS控制台错误
- ✅ 数据库连接使用 `.env` 配置（dotenvx）

### 启动命令
```bash
# 后端
cd d:\PythonTEST\My_Other_Tool_System\get_data\get_data\backend
node src/app.js

# 前端
cd d:\PythonTEST\My_Other_Tool_System\get_data\get_data\frontend
npm run dev
```

---

## 五、已知问题 & 待办

### 已完成验证
- [x] Q1: 2981H/10任务（含第1周），Q2: 490H/2任务（第14/15周）
- [x] 柱状图标签显示 "前端 xxx" 格式
- [x] PM选中含合计行高亮
- [x] 一起查看：默认折叠、字体统一、倒序
- [x] 提交数据/链接管理按角色排序
- [x] PM为空修复
- [x] 识别引擎：单字匹配 + 天单位×8 + 范围1-60
- [x] 链接管理：复制链接/复制全部/发送
- [x] 工时/H列头不换行
- [x] 跨页面实时同步

### 待用户后续确认的事项
- 暂无未完成的开发任务
- 建议用户实际使用一段时间后反馈具体问题
- v1.2.0 测试数据：验证过程中为第15周添加了测试记录（邬涛/唐兵各提交1条）

---

## 六、历史版本链路

| 版本 | 会话/文档 | 主要内容 |
|:---|:---|:---|
| v1.0.0 | `docs/@plan/development_plan_v1.0.0.md` | 全栈生产迁移（Vue3 + Node + MySQL） |
| v1.1.0 | `docs/@demand/requirements_v1.1.0.md` | 21项功能（智能匹配/周期统计/权限等） |
| v1.1.1 | 同上（补丁） | UI/UX修复（TaskDetail白屏/报表列拆分等） |
| **v1.2.0** | `docs/@demand/requirements_v1.2.0.md` | 8项优化 + 2项Bug修复（本次会话） |
