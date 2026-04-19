# Changelog

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
