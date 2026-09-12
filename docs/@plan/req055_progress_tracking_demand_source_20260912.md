# REQ-055 开发与测试实施方案

## 实施原则

本方案只在用户确认 REQ-055 冻结版后执行。采用扩展-收缩、独立来源、服务端统计和 feature flag，先保证数据可回滚，再替换前端入口。

## 任务顺序

1. 需求方目录模型、revision、权限、引用检查、缓存和审计。
2. 统计服务返回 source/scope/version/filter 元数据及加权进度明细。
3. 详情弹窗、版本页签、进度明细和服务端 Excel 下载。
4. 产品人员×需求方图表、卡片、列表、跳转、排序和奖牌。
5. 目录接入填报、粘贴、Excel 导入、周期统计和本地报告。
6. 部门双图布局、响应式和旧页签回归。
7. API、浏览器、导出、安全、并发、回滚和证据归档。

## 关键接口建议

- `GET /api/demand-sources`：目录和 revision。
- `POST/PATCH/DELETE /api/demand-sources`：管理员维护；引用删除返回 409。
- `GET /api/stats`：增加 `scope/sourceType/versionType/demandSourceId/staffId/taskId`。
- `GET /api/stats/progress-details`：只读进度明细和公式元数据。
- `GET /api/stats/export.xlsx`：服务端按相同筛选生成 Excel。

接口名称需在编码前与现有路由冲突检查后确定，不得直接照搬造成重复路由。

## 回滚与数据保护

不合并研发表和产品表，不删除旧字段；目录使用新增结构并保留旧名称映射。新统计入口由 feature flag 控制，关闭后旧入口继续读取原独立表。所有导出只读，部署前需备份本地开发数据库并在生产发布流程中另行执行生产备份。

## 测试计划

执行 `r4_cases.md`，至少覆盖单元/API、数据库隔离、最小算例、浏览器流程、1280/1920/缩放、导出内容、权限/XSS/公式注入、并发 revision、历史兼容和 feature flag 回滚。每个通过项保留请求响应、截图、文件哈希和数据库前后只读对比。

