# 角色显示与统计逻辑全系统巡检记录

日期：2026-07-25

触发需求：
- “还有很多地方这个名称换行导致列撑的很大不好看；需要全系统遍历确保都不换行，若是显示不到的就用AI开发/AI质量/AI产品描述，只要能显示全的都显示全称。”
- “再在所有页面，所有模块，所有字段，所有逻辑拿出来一个一个遍历，检查所有内容，逻辑均准确。”

## 显示规则

| 场景 | 显示 |
| --- | --- |
| 宽卡片、表单、正式表头、导出模板、接口错误提示 | AI开发工程师 / AI质量工程师 / AI产品经理 |
| 窄角色列、图表、徽标、小弹窗、排序按钮、紧凑汇总 | AI开发 / AI质量 / AI产品 |
| 所有彩色标签 | `white-space: nowrap`，禁止换行 |

## 已修改内容

| 文件 | 内容 |
| --- | --- |
| `frontend/src/utils/roles.js` | 新增 `ROLE_SHORT_LABEL`、`PM_LABEL`、`PM_SHORT_LABEL`，保留全称与短名双口径 |
| `frontend/src/styles/main.css` | `.dt-tag` 全局增加 `white-space: nowrap`、`line-height`、`flex-shrink: 0` |
| `frontend/src/views/StatsPage.vue` | 窄角色列、研发人员明细弹窗、分析弹窗列、PM 聚焦紧凑汇总改用短名；角色徽标统一不换行 |
| `frontend/src/views/PmViewPage.vue` | 头部角色统计与明细窄列改用短名，角色徽标不换行 |
| `frontend/src/views/TaskDetail.vue` | 提交记录表角色列改用短名并增加不换行短标签 |
| `frontend/src/views/ReportPage.vue` | 排序按钮和手动编辑占位符改用短名 |
| `frontend/src/views/PersonnelPage.vue` | 研发人员角色列加宽，保留全称且不换行 |
| `frontend/src/views/SettingsPage.vue` | 通知接收人角色列改用短名并不换行 |
| `backend/scripts/analyze_workload.js` | 静态报告图表/岗位组合采用短名，正式表头保留全称 |
| `backend/src/routes/stats.js` | 修复单周期筛选时 `summary.taskCount` 仍显示季度任务总数的问题 |

## 页面逐项巡检

| 页面 | 巡检结论 |
| --- | --- |
| 任务收集 | 列表页无角色长标签展示风险；数据入口保持原逻辑 |
| 任务详情 `/tasks/:id` | 角色列使用 AI开发/AI质量，已验证不换行 |
| 填写工时 `/fill/:token` | 标题处空间充足，保留全称；AI产品经理字段和校验提示保持全称 |
| 需求工时统计 `/report` | 排序按钮改为 AI产品/AI开发/AI质量；表头和导出保留全称；手动行字段仍写入 `ai_developers/ai_quality` |
| 周期统计 `/stats` | 图表、窄角色列、研发人员弹窗、分析弹窗改为短名；卡片和说明保留全称 |
| 团队人员 `/personnel` | 角色列加宽，人员岗位全称可完整显示且不换行 |
| AI产品经理专属页 `/pm/view/:token` | 顶部紧凑统计和明细表角色列改为短名；专属身份徽标保留 AI产品经理 |
| 设置 `/settings` | 通知接收人表角色列改为短名；“测试发送/测试执行”为动作文案，不属于岗位名称，不改 |
| 权限页 `/permissions` | 无角色岗位显示逻辑 |
| 静态工时分析报告 | 图表图例、岗位组合和短标签使用 AI开发/AI质量；表格表头和公式说明保留全称 |

## 后端与数据逻辑巡检

| 模块 | 巡检结论 |
| --- | --- |
| `RoleService` | `frontend/backend/ai_dev` 统一归一为 `ai_dev`；`test/ai_quality` 统一归一为 `ai_quality` |
| `Staff` | 当前角色枚举兼容新旧值，启动时迁移旧值到新值 |
| `stats` | 角色汇总只统计 `ai_dev/ai_quality`，同时输出旧别名兼容；当前非离职人员即使 0 工时也在当前员工列表中 |
| `report` | `ai_developers` 合并旧 frontend/backend；`ai_quality` 对应旧 test_role；手动新增、更新、导入均支持新字段 |
| `MatchService` | 自动匹配时 AI开发写入兼容列，AI质量写入质量列，旧前后端不再拆分统计 |
| `PersonStatusService` | 离职过滤按任务业务日期判断；离职后无数据不显示，有历史数据时按历史可查 |
| `records/fill` | 离职员工或离职 AI产品经理提交/修改会被后端阻断 |
| `pm` | AI产品经理改名/交接同步 `work_records` 与 `match_groups` 的 JSON 字段 |
| `stores/staff` | 前端人员列表统一归一到 AI开发/AI质量，并排除离职人员作为可选人员 |
| `stores/report` | 报告数据统一生成 `ai_developers/ai_quality`，兼容旧字段 |
| `stores/stats` | 接收后端新角色汇总，保留旧别名兼容已有页面逻辑 |

## 验证记录

命令验证：
- `node --check backend/scripts/analyze_workload.js`：通过
- `node --check backend/src/routes/stats.js`：通过
- `npm run build`：通过，仅保留既有 Vite chunk size 提示
- `node scripts/analyze_workload.js`：通过，已重新生成 latest 静态报告

接口验证：
- `GET /api/stats?year=2026&quarter=3`：
  - `roleSummary.ai_dev = 5185`
  - `roleSummary.ai_quality = 1976.5`
  - `roleSummary.backend = 0`
  - `staffCount = 9`
- `GET /api/stats?year=2026&quarter=3&taskId=98ca030d-cc33-4324-82ec-40c25ba1cd5d`：
  - `summary.taskCount = 1`
  - 单周期任务数修复生效

浏览器验证：
- `/stats?admin=1`：研发人员明细弹窗岗位列显示 AI开发/AI质量，`white-space: nowrap`
- `/tasks/98ca030d-cc33-4324-82ec-40c25ba1cd5d?admin=1`：任务详情角色列显示 AI质量，`white-space: nowrap`
- `/pm/view/pm_284f7c27_3426387f417b?year=2026&quarter=0&month=0`：角色列显示 AI开发/AI质量，`white-space: nowrap`
- `/report?admin=1`：排序按钮显示 AI产品/AI开发/AI质量
- `/personnel?admin=1`：角色列保留全称且不换行

## 剩余说明

- 文档目录中历史需求文档仍会出现“前端/后端/测试”等旧描述，属于历史资料，不作为当前页面展示口径。
- 导入导出模板继续保留完整字段名，避免业务含义不清。
- 本次仅本地修改，未推送、未发布生产。

## 2026-07-27 追加验证

- `frontend/src/views/StatsPage.vue` 单人概览角色徽标改为短名：`AI开发 / AI质量`，避免窄区域换行。
- 周期统计“研发人员明细”弹窗岗位列已确认使用短名 `roleDisplay(row.role, true)`。
- Playwright 验证：
  - `/personnel?admin=1`：角色列全称 `AI开发工程师 / AI质量工程师`，`white-space: nowrap`，高度 21px。
  - `/stats?admin=1`：研发人员明细弹窗岗位列显示 `AI开发 / AI质量`，`white-space: nowrap`，高度 22px。
  - `/report?admin=1`：排序按钮显示 `AI产品 / AI开发 / AI质量`。
- 口径说明：周期统计页面实际请求参数为 `quarter=Q3`；手工接口验证必须沿用 `Q1/Q2/Q3/Q4` 字符串口径，不使用 `quarter=3`。
- 发布状态：2026-07-27 已按用户要求执行远端推送准备，生产发布暂不执行。

## 2026-08-04 VOIP 独立角色追加审计

研发角色口径由两类扩展为三类：`ai_dev / voip / ai_quality`。完整名称分别为 AI开发工程师、VOIP工程师、AI质量工程师；紧凑区域使用 AI开发、VOIP、AI质量，所有角色徽标保持不换行。

本轮重新遍历人员管理、填写工时、任务详情、需求工时统计、周期统计、研发聚焦、AI产品经理聚焦、设置通知名单、Excel 导入导出、报表备份、离线分析报告、角色服务、匹配服务和历史初始化脚本。赖香山、赵鲁鹏的角色与 87 条历史匹配条目已经独立迁移到 VOIP，773h 工时不再并入 AI开发；迁移前后总工时守恒。

需求及实施证据：

- `docs/@demand/voip_engineer_role_20260804.md`
- `docs/@development/voip_engineer_role_implementation_20260804.md`
- `docs/@development/voip_engineer_role_tests_20260804/voip_role_summary.md`

本轮仅修改本地开发环境，没有提交、推送、发包或生产发布。
