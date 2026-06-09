# 问题修复日志 v3.2.0-hotfix2 — 交接 Bug 深度修复 + 双重转义 + PM 数据合并

**日期**：2026-06-09  
**执行状态**：已修复并发版  

---

## 一、交接功能 Bug 修复（第二轮深度修复）

### 问题描述

1. 产品经理交接功能"提示成功，实际未成功"
2. 交接后数据仍在原 PM 名下

### 根因分析（双层 Bug）

**Bug 1 — SQL REPLACE 子串误替换**（上轮已修）

`syncPmNameInJsonColumn` 使用 SQL `REPLACE()` 做字符串替换，oldName 是 newName 子串时会破坏数据。

**Bug 2 — work_records 双重 JSON 转义**（本轮发现）

生产环境 `work_records.product_managers` 中有 **262 条** 记录存在双重 JSON 转义：
- 正常格式：`["杨瑞"]`（`JSON_TYPE = ARRAY`）
- 双重转义：`"[\"昆仑\"]"`（`JSON_TYPE = STRING`）

`JSON_CONTAINS()` 只能匹配 ARRAY 类型，STRING 类型的记录被完全跳过，导致交接"提示成功但数据没变"。

### 修复方案

重写 `syncPmNameInJsonColumn v2`：

1. 查询条件增加 `LIKE` 兜底匹配双重转义记录
2. 解析时自动处理二次 `JSON.parse()`
3. 增加 `arr.includes(oldName)` 精确校验
4. 写入时统一为标准 JSON ARRAY 格式（自动修复双重转义）

### 涉及文件

- `backend/src/routes/pm.js` — `syncPmNameInJsonColumn` v2
- `backend/src/scripts/fixDoubleEscapedPm.js` — 批量修复脚本

---

## 二、PM 数据合并（最终结果）

| 源 PM | 目标 PM | work_records | match_groups |
| --- | --- | --- | --- |
| 昆仑 | 其他-昆仑 | 1 | 0 |
| 昆仑组 | 其他-昆仑 | 1 | 1 |
| 运维安全组 | 其他-运维 | 2 | 1 |
| 运维 | 其他-运维 | 1 | 1 |
| 架构组 | 其他-架构 | 1 | 1 |

最终验证：所有源 PM 在 work_records 和 match_groups 中的关联记录数均为 **0** ✅

---

## 三、规约更新

在 `conventions.md` 中新增：
- **铁律 15**：变更推送与文档归档
- **铁律 16**：最小影响范围原则

---

## 四、验证清单

- [x] 源 PM 关联记录全为 0
- [x] 交接 API 正确处理双重转义记录
- [x] 健康检查 200
- [x] pm2 devtracker online
