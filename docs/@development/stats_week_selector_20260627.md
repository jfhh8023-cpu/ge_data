# 周期统计自然周选择条开发记录

日期：2026-06-27

## 触发需求

用户要求在「周期统计（季度）」页面和「工时数据分析报告」页面红框位置，按当前粒度和周期增加季度内自然周按钮。例如当前周期为 `2026-Q2` 时，在任务周期 / 周期下拉框右侧同一行展示该季度三个月内的自然周周数按钮，如 `25周`、`24周`、`23周` 等。

## 需求理解

- 周按钮基于当前选择的年份和季度动态生成。
- 当前季度只展示已经完成的自然周；例如 2026-06-27 仍处于第 26 周，则最近已完成周为第 25 周。
- 最近一周不再做独立颜色强调，保持普通按钮态；当前选中的周仍使用主色选中态。
- 点击周按钮后，使用现有 `selectedTaskId` 任务周期筛选链路刷新统计数据。
- 若某个自然周没有对应收集任务，则按钮保留展示但禁用，避免请求不存在的周期。
- 周按钮数量少时直接平铺展示。
- 周按钮数量多时采用可视窗口：点击右侧按钮时列表向左移动，点击左侧按钮时列表向右移动，让用户能通过连续点击靠左 / 靠右按钮访问暂时看不到的周。
- 若左侧或右侧仍有未显示的自然周，在对应方向边缘显示 `《` / `》`，提示该方向还有周期。
- 当前选中的周按钮下方显示小三角指示符。

## 实现方案

- 修改 `frontend/src/views/StatsPage.vue`。
- 修改 `backend/scripts/analyze_workload.js`，让生成的工时数据分析报告顶部也显示同一套自然周按钮。
- 新增自然周计算函数，按周结束日期归属季度，与后端 `/api/stats` 使用 `end_date` 判定季度归属的规则保持一致。
- 新增周选择条状态：
  - `weekWindowStart`：当前可视窗口起点。
  - `WEEK_WINDOW_SIZE`：最多展示按钮数。
  - `WEEK_FOCUS_INDEX`：窗口中间定位点。
- 点击周按钮时：
  - 若有匹配任务，则设置 `selectedTaskId`。
  - 若点击位置在焦点右侧，窗口向左移动；若在焦点左侧，窗口向右移动。
  - 若周数量不超过窗口上限，不移动。
- 年份或季度切换时，重置周选择条窗口和任务周期为「全部周期」。

## 验收点

- `2026-Q2` 能生成季度内周数按钮，且最近已完成周不显示独立强调色。
- 点击存在收集任务的周按钮后，页面统计范围切换到对应任务周期。
- 点击右侧第 6 个及以后按钮时，周按钮整体左移；点击左侧按钮时整体右移。
- 若当前窗口左右方向仍有未显示周，边缘显示 `《` / `》` 提示。
- 当前选中周下方有三角形指示符。
- `npm run build` 通过。
- `node --check backend/scripts/analyze_workload.js` 通过。
- 重新生成全量工时分析报告后，报告页 `devtracker_workload_period_quarter_2026-Q2_latest.html` 顶部右侧红框区域能显示自然周按钮。
- 本地开发服务启动后，可在浏览器打开 `#/stats` 查看页面效果。

## 实施记录

- 已修改 `frontend/src/views/StatsPage.vue`。
- 在统计页筛选行内、任务周期下拉框右侧新增「自然周」快捷选择条，不单独换行。
- 已修改 `backend/scripts/analyze_workload.js`。
- 在工时数据分析报告 header 的右侧筛选区内新增「自然周」快捷选择条；最终位置调整为粒度 / 周期下拉框正下方，靠右对齐，并使用绝对定位避免撑高顶部黑色背景。
- 自然周按周结束日期归属当前季度；当前季度仅显示已完成自然周。
- 周按钮映射后端返回的 `CollectionTask`，通过现有 `selectedTaskId` 联动部门全观、研发聚焦、产品聚焦统计接口。
- 统计页第二个页签显示名称从「个人聚焦」调整为「研发聚焦」，内部路由名仍保持 `personal`，避免影响现有状态逻辑。
- 报告页周按钮映射脚本生成的 week 周期报告，点击后跳转对应周报告；周报告会自动将当前周居中并显示三角。
- 周按钮可视窗口最多显示 9 个；第 5 个位置作为中间焦点。点击右侧按钮时窗口向左移动，点击左侧按钮时窗口向右移动。
- 最近已完成周保持普通按钮色，选中周使用主色并在下方显示三角形。
- 周按钮窗口左右有隐藏周时，在对应边缘显示 `《` / `》` 提示。

## 验证记录

- `npm run build`：通过。
- `node --check backend/scripts/analyze_workload.js`：通过。
- `node scripts/analyze_workload.js`：通过，重新生成 `devtracker_workload_all_latest.html` 和 31 个共享周期页。
- `GET http://localhost:3001/api/health`：200，返回 `DevTracker API is running`。
- `GET http://localhost:3001/api/stats?year=2026&quarter=Q2`：200，返回 Q2 任务第 25 周至第 14 周，共 12 个周期任务。
- 本地前端：`http://127.0.0.1:5175/stats?admin=1`。
- 浏览器验证：
  - 初始在任务周期下拉框右侧同一行显示自然周按钮。
  - 点击第 6 个位置的 `20周` 后，可视窗口从 `25周...17周` 移动为 `24周...16周`，`20周` 位于中间第 5 个位置并被选中。
  - 点击左侧 `24周` 后，可视窗口回到 `25周...17周`，`24周` 被选中。
  - 页面标题随选中周切换为对应日期范围，且三角形指示符数量为 1。
  - 缝隙压缩验证 URL：`http://127.0.0.1:5175/stats?admin=1&v=gap-20260627-1741`。筛选行容器底部 y=150，Tab 顶部 y=150，间距为 0px；筛选容器 `margin-bottom` 和 `padding-bottom` 均为 0px。
  - 拖动条移除验证 URL：`http://127.0.0.1:5175/stats?admin=1&v=no-filter-scroll-20260627-1748`。选中 `17周` 后，筛选容器 `overflow-x` / `overflow-y` 均为 `visible`，可见周为 `22周` 至 `14周`，内容右边界在视口内，无内部拖动条。
  - 页签改名验证 URL：`http://127.0.0.1:5175/stats?admin=1&v=tab-rename-20260627-1755`。页签显示为 `部门全观`、`研发聚焦`、`产品聚焦`，不再显示 `个人聚焦`。
- 报告页验证：
  - `http://127.0.0.1:5175/api/local-reports/workload-analysis/devtracker_workload_period_quarter_2026-Q2_latest.html#overview` 顶部筛选区显示 `25周` 到 `17周`，粒度为 `quarter`，周期为 `2026-Q2`。
  - 点击报告页 `20周` 后跳转到 `devtracker_workload_period_week_2026-_20_2026-05-11_2026-05-17_latest.html#overview`，粒度变为 `week`，周期为 `2026-第20周 2026-05-11~2026-05-17`，周按钮居中并显示唯一三角。
  - 布局调整后，报告页自然周按钮位于粒度 / 周期下拉框正下方红框位置，靠右对齐；控件绝对定位，不参与顶部黑色区域高度计算。
  - 顶部高度压缩验证 URL：`http://127.0.0.1:5175/api/local-reports/workload-analysis/devtracker_workload_period_quarter_2026-Q2_latest.html?v=height-92-20260627#overview`。坐标验证：header 高度 92px，粒度/周期下拉底部 y=56，自然周按钮顶部 y=61、底部 y=87。
  - 方向提示验证 URL：`http://127.0.0.1:5175/api/local-reports/workload-analysis/devtracker_workload_period_quarter_2026-Q2_latest.html?v=chevron-20260627-1733#overview`。初始窗口为 `25周` 至 `17周`，右侧显示 `》`；`25周` 背景为白色、边框为默认灰色，不再使用最近周强调色。
  - 点击 `20周` 后跳转对应周报告，窗口为 `24周` 至 `16周`，左侧显示 `《`、右侧显示 `》`，当前选中 `20周` 且三角形指示符数量为 1；header 高度仍为 92px。

## 生产发布记录

日期：2026-06-28

- 生产数据库备份：已完成 `deploy/backups/20260628_092700/devtracker_20260628_092700.sql`，约 1010.3 KB。
- 发布命令：`python deploy/deploy.py --skip-db`。
- 数据库导入：已跳过；仅执行既有幂等迁移 `node src/scripts/migrate-v1.6.0.js`，迁移结果为 0 条新增/变更业务数据。
- Nginx：`nginx -t` 通过，HTTP/HTTPS DevTracker 配置已校准且无需变更。
- PM2：`devtracker` 已重启，进程版本 `3.3.0`，部署脚本健康检查通过。
- 生产健康接口：`https://jfzhu8023.cloud/devtracker/api/health` 返回 200。
- 生产统计接口：`https://jfzhu8023.cloud/devtracker/api/stats?year=2026&quarter=Q2` 返回 200；`tasks=12`、`records=309`、`total=3529.5`、`staff=10`。
- 生产报告重生成：在服务器执行 `cd /opt/devtracker/backend && node scripts/analyze_workload.js`，生成 31 个周期页；Q2 报告包含 `report-week-more` 与 `height: 92px`。
- 生产统计页浏览器验证：`https://jfzhu8023.cloud/devtracker/stats?admin=1&v=prod-20260628-0928` 页签显示 `部门全观`、`研发聚焦`、`产品聚焦`；筛选容器 `overflow-x` / `overflow-y` 均为 `visible`，筛选行到 Tab 间距为 0。
- 生产报告页浏览器验证：`https://jfzhu8023.cloud/devtracker/api/local-reports/workload-analysis/devtracker_workload_period_quarter_2026-Q2_latest.html?v=prod-browser-20260628#overview` header 高度为 92px，右侧显示 `》`，最近周按钮为白底默认灰边。
