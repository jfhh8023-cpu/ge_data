# REQ-055 本地实现记录

## 1. 基线与备份

- 需求基线提交：`8818151`，提交信息为 `chore: snapshot before req055 progress tracking development`。
- 本地 Git bundle：`D:\PythonTEST\My_Other_Tool_System\get_data\get_data_cursor\deploy\backups\local_before_req055_20260912_204355\repo.bundle`。
- 生产只读备份：`D:\PythonTEST\My_Other_Tool_System\get_data\get_data_cursor\deploy\backups\20260912_204413`。
- 生产数据未执行写操作；备份脚本仅导出数据库和运行状态。备份时发现服务器缺少 nginx 配置文件 `/etc/nginx/conf.d/notification-system.conf`，不影响数据库备份完成。

## 2. 本轮实现

### 需求方目录

- 新增 `DemandSource` 模型、目录服务与 `/api/demand-sources` 管理接口。
- AI 产品经理工时使用独立 `ProductManagerWorkRecord` 数据表，并保存稳定的 `demand_source_ids`。
- 新增、编辑、启停、删除需求方目录项；系统默认项和已引用项禁止删除，重命名保留引用关系。
- 填写工时页、人员角色配置页、统计接口从目录动态读取，不再依赖前端固定四项。

### 周期统计与进度

- 研发归属人图与 AI 产品经理需求方独立图并列展示，产品图按需求方均摊权重。
- AI 产品展示卡片、需求方柱状图、列表与分析弹窗支持跳转和来源筛选。
- 分析弹窗增加“全部追踪和进度”“普通版本（有版本号）”“无版本号版本”页签。
- 每个综合进度 KPI 和岗位进度项可打开独立需求进度明细弹窗，并提供 Excel 下载。
- 详情接口支持当前范围/全部历史、研发/AI 产品来源、人员、需求方、版本号分组筛选。
- 进度采用工时加权，公式和示例通过提示展示；历史空进度不进入分母。
- 导出接口生成“导出说明、进度明细、需求方目录快照”三个工作表。
- 研发和 AI 产品页面卡片、页面数据与图表保持来源隔离；统计页签视觉顺序为：部门展示、AI研发展示、AI产品展示、研发聚焦、产品经理聚焦。

## 3. 主要文件

- 后端：`backend/src/models/DemandSource.js`、`backend/src/services/DemandSourceService.js`、`backend/src/routes/demandSources.js`、`backend/src/routes/stats.js`、`backend/src/routes/fill.js`。
- 前端：`frontend/src/stores/demandSources.js`、`frontend/src/views/PersonnelPage.vue`、`frontend/src/views/FillPage.vue`、`frontend/src/views/StatsPage.vue`、`frontend/src/stores/stats.js`。

## 4. 约束与未覆盖项

- 生产发布不属于本轮操作；当前只启动本地服务、验证并准备推送。
- 现有静态报告 HTML 的历史生成链路仍由原报告脚本负责，本轮先保证统计页、填写页、分析详情和导出接口使用统一目录；如需让已生成的静态历史 HTML 重新生成动态目录，需要另行执行报告重生成与回归。
- 前端目录 store 保留离线默认目录作为 API 首次加载失败时的兼容兜底；成功加载后以服务端目录为准。
