# Issues And Review Findings

## 已修复

1. `withRoleAliases` 曾把 PM 聚合对象中的 `records` 数组按数字处理，导致 `records.push is not a function`。现只处理已注册角色和兼容别名，运行统计接口恢复正常。
2. 需求报表导入曾假定 `product_managers` 必然是字符串；数组输入会失败或双重编码。现统一通过 `normalizeNameArray` 保存结构化数组。
3. 动态角色加入后，需求工时报表表头可能换行或裁剪。现完整名称可容纳时显示全称，空间不足使用简称，表头固定单行。
4. 离线 HTML 报告有 4 处动态角色图例文本未转义。现统一使用 `escapeHtml`，角色名称不能注入 HTML 或破坏报告结构。
5. 角色 schema 启动检查曾可能重复执行 `ALTER TABLE staff`。现仅在列类型不是 `VARCHAR(50)` 时转换，后续启动保持幂等。

## 非产品问题

- Codex 内置浏览器运行环境出现 `failed to write kernel assets: os error 3`，因此改用项目已有 Playwright 依赖执行同等浏览器验证；API、页面、截图和控制台证据均已归档。

## 剩余风险

- 前端构建仍有既有的单个大于 500 kB chunk 警告，不影响本次角色功能。
- 移动端整体导航和宽表格仍沿用现有横向布局；本次只验收新增角色标签和表头不换行，没有扩展为整站移动端重构。
- 角色配置 API 沿用当前系统既有的管理接口安全边界，本次未新增独立认证体系。
