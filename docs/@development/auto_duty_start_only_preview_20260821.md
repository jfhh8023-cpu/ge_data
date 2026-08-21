# 自动值班只发送开始提醒预览优化

## 变更信息

- 日期：2026-08-21。
- 触发需求：配置为“只发送开始提醒”时，主页面最近一次通知预览不再显示结束记录，并确认结束时间不会发送结束提醒。
- 范围：仅本地开发、测试和远端仓库推送，不发布生产。

## 问题复现

- 本地时间为星期五，当前值班日原配置为“开始和结束都发送”。
- 将星期五改为“只发送开始提醒”并保存后，后端配置已正确保存为 `start_only`。
- 当天开始时间已经过去，原预览算法会继续查找下一条未来通知，跳到下一个值班日，并显示该日的开始和结束两条记录。
- 因此发送逻辑虽然已经排除了本日结束事件，但界面仍能看到另一日期的结束记录，容易误解为结束提醒仍会发送。

## 最小修改方案

1. `frontend/src/views/SettingsPage.vue`
   - 主预览在当天配置为 `start_only` 时，优先锚定当天配置。
   - 继续复用既有 `dutyPreviewEntries` 和 `dutyItemHasEndPreview`，只生成一条开始记录。
   - 其他日期、`start_and_end`、固定/轮换及周/月配置算法保持不变。
2. `backend/src/services/AutoTaskService.js`
   - 仅导出既有纯函数 `getDueDutyEvents`，供隔离回归直接验证；不修改调度实现。
3. `backend/scripts/verify_child_notifications_and_duty_switch.js`
   - 验证 `start_only` 在开始时间只产生 `start` 事件。
   - 验证 `start_only` 在结束时间产生 0 个事件。
   - 对照验证 `start_and_end` 在结束时间产生 `end` 事件。

## 数据与安全边界

- 不修改数据库结构或接口契约。
- 不访问、不备份、不修改生产数据。
- 自动化测试使用纯事件计算和隔离测试数据，不调用真实钉钉 webhook。
- 本地浏览器验收不点击“发送”或“测试发送 webhook”。

## 验收标准

1. 星期五配置为“只发送开始提醒”并保存后，主页面只显示星期五开始记录。
2. 当天开始时间已过，预览仍不跳到下一值班日显示结束记录。
3. `start_only` 开始时间点事件为 `['start']`，结束时间点事件为 `[]`。
4. `start_and_end` 结束时间点事件仍为 `['end']`。
5. 前端构建、后端语法检查、既有子通知和值班切换回归全部通过。
6. 本地页面无新增控制台错误、布局溢出或失败请求。

## 实施状态

- 状态：`READY_LOCAL_AND_PUSH`，本地开发与验证完成，可推送远端仓库，不发布生产。

## 实施结果

- 前端预览增加当天 `start_only` 锚点：即使开始时间已过，也继续展示当天唯一的开始记录。
- 结束记录仍统一由既有 `dutyItemHasEndPreview` 控制，只有 `start_and_end` 才会进入预览条目。
- 后端调度实现未改变；仅导出既有 `getDueDutyEvents` 供隔离回归断言。
- 本地星期五配置已通过设置页保存为 `start_only`；其他星期配置和生产数据均未修改。

## 验证结果

### 静态与构建

- `node --check src/services/AutoTaskService.js`：PASS。
- `node --check scripts/verify_child_notifications_and_duty_switch.js`：PASS。
- `npm.cmd run build`：PASS，Vite 8.0.8 完成 1684 个模块；仅保留既有大分块提示。
- `git diff --check`：PASS，仅有 Windows 工作区 LF/CRLF 提示。

### 后端隔离回归

- `node scripts/verify_child_notifications_and_duty_switch.js`：PASS。
- `start_only` 在 09:15:30 的事件：`['start']`。
- `start_only` 在 20:00:30 的事件：`[]`。
- `start_and_end` 在 20:00:30 的事件：`['end']`。
- 既有子通知激活/发送/失败隔离、6 天兜底、月末日期及值班规则切换回归全部继续通过。
- 调度器只会调用 `getDueDutyEvents` 返回的事件；结束时间返回空数组时，不会进入 `executeDutyEvent`、不会调用 webhook，也不会创建 `duty_end` 日志。

### 本地 API 与页面

- 本地健康接口业务码 0；自动任务规则 2 条、自动值班规则 1 条、临时规则 0 条。
- 当前生效版本日期 `2026-08-10`，星期五发送策略回显为 `start_only`，配置仍启用。
- 本地设置页 `http://127.0.0.1:5176/settings?admin=1`：
  - 最近一次通知预览共 1 条，为“周五 开始 09:15”；结束记录数 0。
  - 配置弹窗回显“只发送开始提醒”，仅显示开始时间和开始文案，结束时间/结束文案均不可见。
  - 页面宽度 1280 时无横向溢出；控制台错误 0、警告 0。
  - 未点击单条发送、测试发送或其他 webhook 入口。

## 审查结论

- UX/产品：预览与当前值班日的实际发送策略一致，不再因跳到下一值班日产生误导。
- 后端：发送模式判断仍集中在 `dutyItemHasEnd`；`start_only` 无结束事件，因而无法进入结束发送链路。
- 代码审查：改动局限于一个预览选择分支、一个测试导出、三组断言和归档文档，未发现阻塞项。
- 安全审查：未新增外部请求、权限入口、数据库结构或敏感日志；测试未连接真实 webhook。
- 交付边界：允许提交并推送远端仓库；明确不执行生产备份、生产部署或生产数据访问。
