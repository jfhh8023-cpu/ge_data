# DevTracker 开发对话总结 — 2026-06-09

> **用途**：后续 AI 工具接手时，只需说"继续"并指向本文档即可恢复上下文。

---

## 一、项目概况

| 项目 | 信息 |
|------|------|
| **项目名** | DevTracker — 研发工时统计系统 |
| **代码位置** | `d:\PythonTEST\My_Other_Tool_System\get_data\get_data_cursor` |
| **技术栈** | 前端 Vue3 + Vite + Element Plus + Pinia；后端 Node.js + Express + Sequelize + MySQL |
| **生产地址** | http://jfzhu8023.cloud/devtracker/ |
| **生产服务器** | jfzhu8023.cloud (SSH root/zhujunfeng391.) |
| **生产部署路径** | `/opt/devtracker/`（前端 dist + 后端 src + pm2） |
| **远端仓库** | gitee（`git push gitee master`） |
| **发版脚本** | `uv run python deploy/deploy.py --skip-db` |
| **Python 环境** | uv + Python 3.12 |
| **规约文档** | `docs/@architecture/conventions.md`（铁律 1-17） |

---

## 二、本次对话完成的全部变更

### 2.1 产品聚焦 UI 优化（已发版 ✅）

| 功能 | 文件 | 说明 |
|------|------|------|
| 单独查看默认展开最近周期 | `StatsPage.vue` | 按 start_date 最新的有记录周期自动展开 |
| 工时排序 + 金银铜牌 | `StatsPage.vue` | 前三名显示🥇🥈🥉闪光角标 |
| 一起查看一行三列布局 | `StatsPage.vue` | grid 布局，含总工时+前后端测试工时 |
| 每产品名卡片右侧"查看全部"按钮 | `StatsPage.vue` | 跳转到对应 PM 专属页面 |
| 一起查看默认收起+展开全部周期 | `StatsPage.vue` | 长条按钮控制展开/收起 |

### 2.2 PM 专属链接优化（已发版 ✅）

| 功能 | 文件 | 说明 |
|------|------|------|
| 搜索按钮后加"全年展示"按钮 | `PmViewPage.vue` | 点击选全年/全季/全月，再点恢复当前 |
| 筛选条件选择全年/全部月份显示在框内 | `PmViewPage.vue` | 下拉选项含"全年"/"全部" |
| 搜索支持回车 | `PmViewPage.vue` | @keyup.enter 事件 |
| 从"查看全部"跳转时默认全年筛选 | `PmViewPage.vue` | 路由 query 参数初始化 |

### 2.3 部门全观金银铜（已发版 ✅）

| 功能 | 文件 | 说明 |
|------|------|------|
| 每个产品下需求工时前三显示金银铜 | `StatsPage.vue` | 同 PM 聚焦的闪光角标效果 |

### 2.4 PM 交接 Bug 深度修复（已发版 ✅）

| Bug | 根因 | 修复文件 |
|-----|------|---------|
| 交接提示成功实际未成功 | `work_records.product_managers` 中 262 条双重 JSON 转义 `"[\"xx\"]"`，`JSON_CONTAINS` 无法匹配 | `pm.js` syncPmNameInJsonColumn v2：增加 LIKE 兜底 + 二次 parse |
| SQL REPLACE 子串误替换 | `REPLACE("其他-昆仑", "昆仑", ...)` 破坏已有数据 | 改为逐条精确 `===` 匹配替换 |

### 2.5 PM 数据合并（已在生产执行 ✅）

| 源 PM | 目标 PM | 操作 |
|-------|---------|------|
| 昆仑 + 昆仑组 | 其他-昆仑 | work_records + match_groups 中的 PM 名替换 |
| 运维安全组 + 运维 | 其他-运维 | 同上 |
| 架构组 | 其他-架构 | 同上 |
| 旧 PM（昆仑/昆仑组/运维安全组/运维/架构组） | — | product_managers 表中 `is_active = 0` |

### 2.6 PM 全系统同步修复（已发版 ✅）

| 问题 | 修复文件 | 说明 |
|------|---------|------|
| FillPage 硬编码 PM_OPTIONS | `FillPage.vue` | 改为 onMounted 时从 `/api/pm` 动态获取 |
| TaskDetail 编辑 PM 为手动输入 | `TaskDetail.vue` | 改为 `el-select` 多选下拉，数据源 `pmStore.nameList` |
| 交接无事务回滚 | `pm.js` + `staff.js` | PM 和 Staff 交接均加 MySQL 事务保护 |
| syncPmNameInJsonColumn 无事务支持 | `pm.js` | 增加可选 `transaction` 参数 |

### 2.7 规约更新（已推送 ✅）

| 铁律 | 内容 |
|------|------|
| **铁律 15** | 每次变更必须 git push + 归档文档 |
| **铁律 16** | 最小影响范围修复，修复前定位根因，修复后自检 |
| **铁律 17** | 全系统字段一致性验证：禁止硬编码选项列表，交接必须事务保护，验证清单逐条执行 |

---

## 三、当前系统状态

### 3.1 PM 数据源架构

```
product_managers 表（统一真相源，11 活跃 + 5 禁用）
  ├── GET /api/pm → pmStore（前端 Pinia Store）
  │     ├── StatsPage → pmStore.activePms（PM聚焦选择器）
  │     ├── PersonnelPage → pmStore.list（PM管理+交接）
  │     └── TaskDetail → pmStore.nameList（编辑PM下拉）
  ├── GET /api/pm → FillPage.pmOptions（独立页面直接调用API）
  └── work_records.product_managers → 后端聚合（stats.js 动态读取）
```

### 3.2 活跃 PM 列表（11 个）

钟冠、吴浩鑫、杨瑞、罗晓璇、**罗思宇**、**汪晨**、其他-昆仑、其他-架构、其他-短信、**其他-运维**、不在上述

### 3.3 已禁用 PM（5 个）

昆仑、昆仑组、运维安全组、运维、架构组

### 3.4 全系统验证结果

**44/45 项通过**（1 项假阳性：Vite 代码分割导致 `/pm` 路径在共享 chunk 中）

---

## 四、已知遗留问题

| # | 问题 | 优先级 | 说明 |
|---|------|--------|------|
| 1 | **256 条双重 JSON 转义残留** | 低 | `work_records.product_managers` 中仍有 `"[\"xxx\"]"` 格式的记录，不影响功能（syncPmNameInJsonColumn v2 已能处理），会随新数据写入自动收敛 |
| 2 | **浏览器缓存** | 低 | 用户需 Ctrl+Shift+R 强制刷新才能看到最新 PM 列表 |
| 3 | **FillPage 示例文本** | 极低 | L575 有示例 `V4.633.0 用户中心改版 杨瑞 5h`，纯展示用 |

---

## 五、关键文件索引

| 文件 | 用途 |
|------|------|
| `docs/@architecture/conventions.md` | 项目规约（铁律 1-17） |
| `docs/@issue/fix_pm_transfer_v3.2.0.md` | 交接 Bug 修复日志 |
| `docs/@issue/fix_pm_consistency_v3.2.0.md` | PM 一致性修复日志 |
| `frontend/src/stores/pm.js` | PM Pinia Store（统一前端数据源） |
| `frontend/src/views/FillPage.vue` | 填写页（独立布局，动态加载 PM） |
| `frontend/src/views/TaskDetail.vue` | 任务详情页（PM 下拉编辑） |
| `frontend/src/views/StatsPage.vue` | 周期统计页（PM 聚焦 + 部门全观） |
| `frontend/src/views/PmViewPage.vue` | PM 专属查看页 |
| `frontend/src/views/PersonnelPage.vue` | 团队人员页（PM 管理 + 交接） |
| `backend/src/routes/pm.js` | PM 后端路由（CRUD + 交接 + 专属查看） |
| `backend/src/routes/stats.js` | 统计后端路由（PM 分布 + 聚焦） |
| `backend/src/routes/staff.js` | 研发人员路由（交接） |
| `deploy/deploy.py` | 生产发版脚本 |

---

## 六、发版流程

```bash
# 1. 提交代码
git add -A
git commit -m "描述信息"

# 2. 推送远端
git push gitee master

# 3. 发版（跳过数据库迁移）
uv run python deploy/deploy.py --skip-db

# 4. 验证
# 生产健康检查: curl http://jfzhu8023.cloud/devtracker/api/health
```

---

## 七、最新 Git 状态

- **最新提交**: `67042fd` — chore: cleanup temp audit scripts
- **分支**: master
- **远端**: gitee (已同步)
- **生产版本**: v3.2.0（pm2 进程 ID 28）

---

> **接手指南**：阅读本文档 + `docs/@architecture/conventions.md`（铁律）后即可继续开发。铁律 15-17 是本次新增的核心约束，务必遵守。
