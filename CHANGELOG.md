# Changelog

## v3.3.0 — 柱状图标签优化 + 值班通知名句搭配 (2026-06-10)

### 新增

#### 名句搭配（值班通知增强）

- **句子库**：全新 `quotes` 表，支持新增（单条/批量按句号分隔）、编辑、单删、批量删除
- **每条值班规则独立配置**：开关、近 N 次内不重复（默认 20）、候选队列（默认 10 条预览）
- **自动注入**：值班开始/结束提醒发送前，自动从候选队列消费一条句子，拼接到 message 前方（句子\n原始内容）
- **去重机制**：根据 `used_history` 与 `no_repeat_count` 过滤近 N 次已用句子；池不足时优雅回退
- **互动操作**：
  - 「更换一批」：丢弃当前候选队列，重新随机生成
  - 「使用下一句」：弹出第 1 条放入 used_history（不发送），下次提醒会使用新的第 1 条
  - 「查看全部句子」：管理整个名句库
- **种子脚本**：`backend/scripts/seed_quotes.js` + `default_quotes.txt`，每行一句，重复内容自动跳过

#### 柱状图柱顶标签纵向布局

- **避免横向遮挡**：StatsPage 部门全观柱顶标签从横排（前端 26）改为纵排（上行角色名 / 下行数值），左对齐
- 字号 10px bold，正色 `#1D2129`，与原柱形 X 坐标对齐

### 后端

- 新建模型：`backend/src/models/Quote.js`、`backend/src/models/QuoteConfig.js`
- 新建服务：`backend/src/services/QuoteService.js`（候选队列 + 去重 + 消费 + 跳过逻辑）
- 新建路由：`backend/src/routes/quotes.js`（CRUD + `/config/:ruleId` 系列）
- 修改：`backend/src/models/index.js` 注册新模型与 1:1 关联
- 修改：`backend/src/app.js` 挂载 `/api/quotes`
- 修改：`backend/src/services/AutoTaskService.js` `ensureAutoTaskTables` 追加 Quote/QuoteConfig 表同步；`executeDutyEvent` 调用 `consumeQuotes` 注入句子
- 新建迁移：`backend/migration_v3.3.0.sql`（quotes + quote_config 建表）

### 联调修复

- **`/api/quotes/config/:ruleId` GET 健壮性**：原实现对不存在的 `ruleId` 强制 `findOrCreate`，触发外键约束 500。改为只读路径：新增 `findConfig` + `buildDefaultConfigPayload`，不存在则返回合成默认值而不写库
- **Sequelize JSON 列变更追踪 bug**：`parseArray` 原本对已是数组的入参返回**同一引用**，导致 `skipCurrent` / `consumeQuotes` 中 `queue.shift()` in-place 修改原数组，再赋值同一引用时 Sequelize 检测不到变更而跳过 save —— "使用下一句"与定时消费名句**完全不持久化**。修复：`parseArray` 始终返回数组拷贝 `.slice()`，并在所有写 JSON 列的位置显式 `config.changed('candidate_queue', true)` / `config.changed('used_history', true)` 兜底
- **手动发送路径漏注入名句**：`POST /api/settings/auto-tasks/test-notify` 是"测试发送 webhook"/"单条值班通知发送"按钮的路径，原本仅转发前端传入的 `dingtalk_message`，**完全没走 `executeDutyEvent`/`consumeQuotes`**，所以即便开启名句搭配，手动触发的发送依然不带名句。修复：在该路由内识别 `task_type === 'duty_notify'` 且 `test_source ∈ ['duty_today_test','duty_preview_line']` 时，调用 `consumeQuotes(rule_id, 1)` 拼接到 message 前，与定时调度共享同一候选队列与去重历史
- **UI 微调**：名句搭配面板从"自动值班通知"规则主面板移至「每周/每月值班配置」弹窗左侧"值班对象"卡片下方（每天独立配置入口可见，但数据仍按 `rule_id` 共享）；弹窗宽度由 920px → 1220px；开关文案「已开启/已关闭」→「开启/关闭」
- **发送预览**：开启名句搭配时，"发送预览"区在每段提醒前追加候选队列下一句，与后端 `${quote}\n${message}` 注入格式完全一致；关闭时维持原预览

### 前端

- 修改：`frontend/src/views/SettingsPage.vue`
  - 新增 reactive state：`quoteConfigs` / `allQuotes` / 弹窗控制
  - 新增 API 函数：`loadQuoteConfig` / `saveQuoteConfigField` / `refreshQuoteBatch` / `skipQuoteNext` / 名句库 CRUD
  - 新增 UI：`dt-duty-layout` 左侧 `dt-duty-left` 容器内嵌入「名句搭配」面板（开关 + 候选队列预览 + 操作按钮）
  - 新增弹窗：「名句库管理」全屏弹窗（添加/编辑/单删/批量删除/全选/高亮"最近一次"）
  - 新增 CSS：`.dt-quote-panel*`、`.dt-quote-queue*`、`.dt-quote-dialog*`
- 修改：`frontend/src/views/StatsPage.vue` `drawChart()` 柱顶标签改为纵排两行

### 变更的文件

- `backend/src/models/Quote.js` (新建)
- `backend/src/models/QuoteConfig.js` (新建)
- `backend/src/services/QuoteService.js` (新建)
- `backend/src/routes/quotes.js` (新建)
- `backend/scripts/seed_quotes.js` (新建)
- `backend/scripts/default_quotes.txt` (新建)
- `backend/migration_v3.3.0.sql` (新建)
- `backend/src/models/index.js` (注册新模型 + 1:1 关联)
- `backend/src/app.js` (挂载 /api/quotes)
- `backend/src/services/AutoTaskService.js` (ensureAutoTaskTables + executeDutyEvent 注入名句)
- `frontend/src/views/SettingsPage.vue` (名句搭配面板 + 弹窗 + CSS)
- `frontend/src/views/StatsPage.vue` (柱顶标签纵排)

---

## v3.0.2 — 智能匹配引擎重构 + 产品经理列显示优化 (2026-04-19)

### 修复

#### MatchService 智能匹配引擎重构
- **版本号决定一切**: 有版本号的记录按版本号精确分组，版本号相同即为同一需求，直接合并，不再依赖标题相似度
- **需求名称取首次提交者**: 同版本号多人填写不同标题时，取 `created_at` 最早的记录标题作为 `merged_title`
- **无版本号回退模糊匹配**: 无版本号的记录仍用标题相似度(0.7) + 产品经理(0.3) 匹配
- **同一员工保护**: 同一员工提交的不同无版本号记录不合并
- **修复问题**: 之前不同版本号(v4.567.0/v4.567.1/v4.567.2)因标题相似度高被错误合并为一行，导致同一格子出现多个姓名和工时

#### 产品经理列显示优化
- **换行显示**: 产品经理列从逗号分隔改为每人一行(`v-for` + `div`)，与前端/后端/测试姓名列保持一致的换行布局

### 变更的文件
- `backend/src/services/MatchService.js` (完全重构: Phase1版本号分组 + Phase2模糊匹配 + buildGroup提取)
- `frontend/src/views/ReportPage.vue` (产品经理列模板改为换行显示)

---

## v3.0.0 — 权限控制优化 (2025-07-14)

### 新增

#### 后端资源清单扩展
- **RESOURCES 扩展至 40 项**: 按 6 个模块（任务收集、需求工时统计、周期统计、团队人员、权限管理、填写工时）分组，每项包含 module、module_label、group、valid_actions 元数据
- **旧资源名迁移**: RENAME_MAP 自动将 `btn:create_task` → `btn:tasks:create` 等 4 项旧名映射
- **Lazy Migration**: GET `/api/permissions` 和 GET `/api/permissions/check/:token` 自动对已有链接执行 rename + 补齐缺失资源

#### 新建链接预设
- POST `/api/permissions` 支持 `preset` 参数（readonly / edit / full / custom）
- 前端新建弹窗增加 4 选项预设卡片

#### 权限配置 UI 重构（PermissionPage.vue）
- **分模块手风琴布局**: 6 个模块可展开/收起
- **三级全选**: 全选全部 → 全选模块 → 全选页面分组
- **valid_actions 支持**: 无效操作列显示 `—`
- **预设模板选择**: 新建链接时可选只读/编辑/完全/自定义

#### 全页面按钮权限守卫
- **TaskList.vue**: 查看/编辑/首选/启停/删除 5 个按钮受权限控制
- **TaskDetail.vue**: 导入/模板/编辑记录/删除记录 4 个按钮受权限控制
- **ReportPage.vue**: 导入/模板/导出/编辑模式/新增行/删除行 6 个按钮受权限控制
- **StatsPage.vue**: 导出Excel 按钮受权限控制
- **PersonnelPage.vue**: 新增/编辑/交接/删除/打开链接/复制链接 6 个按钮受权限控制
- **PermissionPage.vue**: 新建链接/编辑权限/启停/删除/复制链接 5 个按钮受权限控制
- **AppHeader.vue**: 新建收集按钮资源名从 `btn:create_task` 更新为 `btn:tasks:create`
- **router/index.js**: TaskDetail 路由资源从 `page:tasks` 独立为 `page:task_detail`

### 变更的文件
- `backend/src/routes/permissions.js` (重构: RESOURCES 40项 + RENAME_MAP + migratePermissions + getPresetValues + 路由更新)
- `frontend/src/stores/permission.js` (create 增加 preset 参数)
- `frontend/src/stores/auth.js` (无变更，兼容新资源名)
- `frontend/src/views/PermissionPage.vue` (全面重构: 手风琴 + 三级全选 + 预设)
- `frontend/src/views/TaskList.vue` (增加 authStore + 按钮权限守卫)
- `frontend/src/views/TaskDetail.vue` (增加 authStore + 按钮权限守卫)
- `frontend/src/views/ReportPage.vue` (增加 authStore + 按钮权限守卫)
- `frontend/src/views/StatsPage.vue` (增加 authStore + 按钮权限守卫)
- `frontend/src/views/PersonnelPage.vue` (增加 authStore + 按钮权限守卫)
- `frontend/src/components/AppHeader.vue` (btn:create_task → btn:tasks:create)
- `frontend/src/router/index.js` (TaskDetail 独立资源 page:task_detail)

---

## v2.0.0 — 导入导出功能 (2026-04-19)

### 新增

#### 基础设施
- **ExcelFile 模型** (`backend/src/models/ExcelFile.js`): 新增 Sequelize 模型，存储导入/导出的 Excel 文件到数据库
- **Excel 路由** (`backend/src/routes/excel.js`): POST `/api/excel/upload` 文件上传、GET `/api/excel/template/:page` 模板下载
- **前端 Excel 工具** (`frontend/src/utils/excel.js`): 封装解析、校验、生成、下载、上传、模板下载等通用函数
- **依赖**: 前端 `xlsx` + `file-saver`，后端 `xlsx` + `multer`

#### ReportPage（需求工时统计）
- 📤 **导出**: 将当前页面数据导出为 Excel，含版本号、需求名称、角色姓名、工时、备注
- 📥 **导入**: 解析 Excel 文件，通过 POST `/api/report/import` 批量导入 MatchGroup
- 📋 **模板下载**: 从后端下载标准导入模板
- **覆盖规则**: 相同需求名称或版本号的已有行将被覆盖，新增行 status=manual_merged

#### TaskDetail（任务详情）
- 📥 **导入**: 解析 Excel 文件，通过 POST `/api/records/import` 批量导入 WorkRecord
- 📋 **模板下载**: 从后端下载标准导入模板
- **人员校验**: 后端校验人员姓名是否存在于系统中
- **自动匹配**: 导入后自动触发智能匹配生成 MatchGroup

#### FillPage（填写工时）
- 📥 **左栏导入**: 解析 Excel 填充到当前编辑表格行（追加或替换空行）
- 📋 **模板下载**: 从后端下载标准导入模板
- 📤 **右栏历史导出**: 将全年历史数据按季度分 Sheet 导出为 Excel

#### StatsPage（周期统计）
- 📤 **全量导出**: 生成 3 个 Sheet 的 Excel：角色工时汇总、PM 工时明细、PM 柱状图数据

### 后端新增路由
- `POST /api/report/import` — 批量导入 MatchGroup（覆盖逻辑）
- `POST /api/records/import` — 批量导入 WorkRecord（含人员校验 + 自动匹配）
- `POST /api/excel/upload` — Excel 文件存档到数据库
- `GET /api/excel/template/:page` — 下载导入模板

### 变更的文件
- `backend/src/models/ExcelFile.js` (新增)
- `backend/src/models/index.js` (注册 ExcelFile)
- `backend/src/routes/excel.js` (新增)
- `backend/src/routes/report.js` (新增 import 路由)
- `backend/src/routes/records.js` (新增 import 路由)
- `backend/src/app.js` (注册 excel 路由)
- `frontend/src/utils/excel.js` (新增)
- `frontend/src/views/ReportPage.vue` (导入/导出/模板按钮 + 逻辑)
- `frontend/src/views/TaskDetail.vue` (导入/模板按钮 + 逻辑)
- `frontend/src/views/FillPage.vue` (导入/模板/历史导出按钮 + 逻辑)
- `frontend/src/views/StatsPage.vue` (导出按钮 + 逻辑)
