# DevTracker v3.2.1 — PM 显示遗漏修复 + "未分配"数据迁移

> **日期**：2026-06-09  
> **版本**：v3.2.1

---

## 一、变更内容

### 1. 修复：周期统计柱状图/明细表未显示所有活跃产品经理

| 项目 | 内容 |
|------|------|
| **根因** | `stats.js` 中 `pmDistribution` 仅从有工时数据的 `work_records` 构建 PM 分组，新增的无数据 PM 不会出现 |
| **修复文件** | `backend/src/routes/stats.js` |
| **修复方案** | 在遍历 records 前，先从 `product_managers` 表查询所有活跃 PM，预初始化 `pmMap` 空条目 |
| **影响范围** | 部门全观 Tab → 柱状图 + 明细表 + 导出 Excel |

### 2. 优化：将"未分配"默认值改为"不在上述"

| 项目 | 内容 |
|------|------|
| **根因** | `stats.js` 第 110 行默认值硬编码为 `'未分配'`，但业务上应归入 `'不在上述'` |
| **修复文件** | `backend/src/routes/stats.js` |
| **修复方案** | 常量 `PM_DEFAULT_NAME = '不在上述'` |

### 3. 数据迁移脚本

| 项目 | 内容 |
|------|------|
| **脚本** | `backend/migration_v3.2.1_fix_unassigned.sql` |
| **操作** | 将 `work_records` 和 `match_groups` 中 `product_managers` 含 `"未分配"` 的记录替换为 `"不在上述"` |
| **状态** | 待在生产服务器执行 |

---

## 二、涉及文件

| 文件 | 变更类型 |
|------|---------|
| `backend/src/routes/stats.js` | 修改 |
| `backend/migration_v3.2.1_fix_unassigned.sql` | 新增 |
| `docs/@development/fix_pm_display_v3.2.1.md` | 新增（本文档） |

---

## 三、自检结果（铁律 17）

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | 柱状图显示所有活跃 PM | ✅ |
| 2 | 明细表显示所有活跃 PM | ✅ |
| 3 | PM 排序按 sort_order | ✅ |
| 4 | 导出 Excel 包含所有 PM | ✅ |
| 5 | 产品聚焦 Tab 不受影响 | ✅ |
| 6 | PM 专属查看页不受影响 | ✅ |
| 7 | 全系统无 '未分配' 硬编码残留 | ✅ |
| 8 | 语法检查通过 | ✅ |

---

## 四、发版步骤

```bash
# 1. 提交代码
git add -A
git commit -m "fix(stats): 预初始化活跃PM确保柱状图/明细表完整显示 + 未分配→不在上述"
git push gitee master

# 2. 生产数据库迁移（SSH 到生产后执行）
mysql -u root -p devtracker < /opt/devtracker/backend/migration_v3.2.1_fix_unassigned.sql

# 3. 发版
uv run python deploy/deploy.py --skip-db

# 4. 验证
# curl http://jfzhu8023.cloud/devtracker/api/health
# 检查柱状图是否显示所有活跃 PM
```
