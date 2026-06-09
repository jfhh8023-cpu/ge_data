# 变更日志 — PM 数据一致性修复 + 事务回滚 + 全系统审计

**日期**：2026-06-09  
**版本**：v3.2.0-hotfix3

---

## 一、PM 选项数据源统一

### 问题

FillPage（填写页）中产品经理下拉选项使用**硬编码列表** `PM_OPTIONS`，导致：
- 新增的 PM（罗思宇、汪晨）不出现在填写页下拉中
- 新增的 PM 不出现在一键识别匹配中
- 填写页与其他页面的 PM 数据不一致

### 修复

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/views/FillPage.vue` | 删除硬编码 `PM_OPTIONS`，改为 `onMounted` 时从 `/api/pm` 动态获取 |

---

## 二、交接事务回滚保护

### 问题

PM 交接和研发人员交接操作无事务保护，中途失败可能导致数据不一致。

### 修复

| 文件 | 修改内容 |
|------|----------|
| `backend/src/routes/pm.js` | PM transfer 加 MySQL 事务，失败自动 rollback |
| `backend/src/routes/staff.js` | Staff transfer 加 MySQL 事务，失败自动 rollback |
| `backend/src/routes/pm.js` | `syncPmNameInJsonColumn` 增加可选 transaction 参数 |

---

## 三、旧 PM 禁用

| PM 名 | 操作 |
|--------|------|
| 昆仑 | is_active → 0 |
| 昆仑组 | is_active → 0 |
| 运维安全组 | is_active → 0 |
| 运维 | is_active → 0 |
| 架构组 | is_active → 0 |

---

## 四、规约更新

新增**铁律 17：全系统字段一致性验证**

---

## 五、全系统验证结果

共 31 项检查，**全部通过** ✅

- product_managers 表：11 活跃 PM + 5 已禁用 PM ✅
- work_records / match_groups 源 PM 残留：全为 0 ✅
- 重复值检查：全为 0 ✅
- PM 聚焦数据：无旧 PM ✅
- PM 专属页面：正常返回 ✅
- 系统健康检查：200 ✅
