# AI 岗位架构重构本地实施记录

日期：2026-07-25  
环境：本地开发环境  
发布状态：已推送远端，暂未发生产

## 本次实施范围

本次按“先本地优化”的要求，已在代码层落实以下内容：

1. 新增统一角色工具：
   - 后端：`backend/src/services/RoleService.js`
   - 前端：`frontend/src/utils/roles.js`
2. 研发岗位口径：
   - `frontend/backend` 归一为 `ai_dev`，展示为 AI开发工程师。
   - `test` 归一为 `ai_quality`，展示为 AI质量工程师。
3. AI产品经理口径：
   - 页面、模板、导出、关键接口报错提示统一展示“AI产品经理”。
4. 需求工时统计页：
   - 手动新增行整行编辑。
   - AI产品经理、AI开发工程师、AI质量工程师字段自动保存。
   - 保存后广播数据变更，触发全系统同步刷新。
5. 周期统计页：
   - 部门全观卡片改为总工时、AI开发工程师、AI质量工程师等。
   - 研发聚焦“一起查看”改为两列布局。
   - 产品聚焦改为 AI产品经理聚焦。
   - 分析弹窗和导出按新岗位口径输出。
6. 静态工时数据分析报告：
   - 报告生成脚本已从三端展示改为 AI开发/AI质量展示。
   - 历史前端/后端工时在生成报告时合并进 AI开发工程师。
7. 初始化脚本：
   - `backend/init.sql` 的人员角色枚举和样例数据改为新岗位口径。

## 本地迁移机制

后端启动时调用 `ensureStaffRoleSchema()`：

1. 扩展 `staff.role` enum，兼容新旧值。
2. 本地数据迁移：
   - `frontend` -> `ai_dev`
   - `backend` -> `ai_dev`
   - `test` -> `ai_quality`
3. 迁移只作用于当前连接的数据库；当前代码变更已允许远端推送，但生产发布仍需单独执行。

## 数据兼容策略

短期兼容：

| 历史字段 | 新语义 |
| --- | --- |
| `staff.role=frontend/backend` | AI开发工程师 |
| `staff.role=test` | AI质量工程师 |
| `match_groups.frontend + backend` | `ai_developers` |
| `match_groups.test_role` | `ai_quality` |
| `roleSummary.frontend/backend/test` | 兼容别名 |

新增/编辑策略：
- 新页面只写 `ai_developers` 和 `ai_quality` 语义。
- 后端为兼容旧表结构，将 `ai_developers` 落到 `frontend` 列，`backend` 列置空。
- 旧模板导入仍可读，旧前端/后端导入合并为 AI开发工程师。

## 待验证清单

后端：
- `node --check` 覆盖新增/修改的主要 JS 文件。
- 启动服务后执行本地角色迁移。
- 验证 `GET /api/staff` 返回 `ai_dev/ai_quality`。
- 验证 `GET /api/stats` 的 `roleSummary.ai_dev` 等于历史前端+后端。
- 验证 `GET /api/stats` 的 `roleSummary.ai_quality` 等于历史测试。
- 验证 `GET /api/report` 返回 `ai_developers/ai_quality`。

前端：
- `npm run build`。
- 本地浏览器打开：
  - 团队人员页
  - 填写页
  - 需求工时统计页
  - 周期统计页
  - AI产品经理专属查看页
- 检查页面无旧三端展示。
- 手动新增需求工时行，编辑全字段，等待自动保存，再刷新验证数据仍存在。

报告：
- 运行 `node scripts/analyze_workload.js`。
- 打开生成的 `devtracker_workload_all_latest.html`。
- 检查卡片、图表、表格、公式步骤都为新岗位口径。

## 暂不处理项

1. 不推送远程。
2. 暂不发布生产。
3. 不修改生产数据。
4. `demo/` 静态演示目录暂未纳入主应用验证路径，若后续要作为对外 demo，需要单独重构。

## 后续发布前注意

生产发布前建议执行：

1. 拉取生产最新代码前确认本地变更已提交或备份。
2. 生产数据库完整备份。
3. 生产发布前只读统计对比：
   - 新 AI开发工程师 = 历史前端 + 历史后端。
   - 新 AI质量工程师 = 历史测试。
4. 发布后验证：
   - PM2 服务状态。
   - `/api/health`。
   - `GET /api/staff`。
   - `GET /api/stats`。
   - 核心页面可访问且数据未清空。
