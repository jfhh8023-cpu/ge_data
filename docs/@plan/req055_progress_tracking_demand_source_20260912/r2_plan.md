# REQ-055 第2轮开发测试计划

## 交互与接口契约

建议增加只读统计接口参数：`scope=current|all`、`sourceType=engineering|product_manager`、`versionType=versioned|no_version`、`demandSourceId`、`staffId`、`taskId`。响应返回 `scopeMeta`、`catalogRevision`、`weightedProgressMeta`。

需求方目录接口提供 GET/POST/PATCH/DELETE；DELETE 在引用数大于零时返回 409。所有接口复用管理员权限检查，服务端再次校验，不能只依赖前端按钮隐藏。

前端将硬编码四类需求方改成目录 store；产品列表用目录 ID 过滤，名称只作显示。导出采用服务端生成，禁止把表格当前页直接拼成未经转义的 CSV。

## 测试安排

先 API 合约和权限，再表单交互和弹窗，再产品图跳转，最后响应式截图。每个失败场景保存请求、响应和页面截图。

