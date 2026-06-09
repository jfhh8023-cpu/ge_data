# 问题修复日志 v3.2.0-hotfix — 交接 Bug + PM 数据合并

**日期**：2026-06-09  
**执行状态**：已修复并发版  

---

## 一、交接功能 Bug 修复

### 问题描述

产品经理交接功能"提示成功，实际未成功"。

### 根因分析

`syncPmNameInJsonColumn` 函数使用 SQL `REPLACE()` 做字符串替换：

```sql
SET product_managers = REPLACE(product_managers, '"昆仑"', '"其他-昆仑"')
```

当 `oldName` 是 `newName` 的子串时（如 `"昆仑"` 是 `"其他-昆仑"` 的子串），会产生错误替换：

- `"其他-昆仑"` → `"其他-其他-昆仑"`（子串被二次替换）

### 修复方案

重写 `syncPmNameInJsonColumn`（[pm.js](file:///d:/PythonTEST/My_Other_Tool_System/get_data/get_data_cursor/backend/src/routes/pm.js)）：

- 逐条 SELECT 包含目标值的记录
- 解析 JSON 数组，精确匹配替换（`===` 严格相等）
- 替换后自动去重
- 仅在数组确实变化时执行 UPDATE

---

## 二、PM 数据合并（生产环境）

| 源 PM | 目标 PM | work_records | match_groups |
| --- | --- | --- | --- |
| 昆仑 | 其他-昆仑 | 0 | 0 |
| 昆仑组 | 其他-昆仑 | 0 | 1 |
| 运维安全组 | 其他-运维 | 0 | 1 |
| 运维 | 其他-运维 | 0 | 1 |
| 架构组 | 其他-架构 | 0 | 1 |

合并完成后源 PM 关联记录数均为 0，可在界面上手动删除。

---

## 三、涉及文件

- `backend/src/routes/pm.js` — 重写 `syncPmNameInJsonColumn` 函数

---

## 四、验证

- 后端 API 健康检查 200 ✓
- PM transfer API 返回正确合并结果
- 合并后源 PM 关联记录数均为 0
