# 开发日志 v3.1.1 — 自动任务通知与钉钉卡片式通知

**日期**：2026-05-18  
**关联文档**：

- `docs/@demand/requirements_v3.1.1.md`
- `docs/@plan/RESEARCH-dingtalk-progress-card.md`

---

## 一、自动任务提示历史与接收人配置

完成内容：

- 自动任务提示历史支持单条、批量、全部删除。
- 删除范围覆盖校验提示和自动执行日志。
- 无法新增任务提示统一为：`该任务已存在或无法新增超过下一周的新收集任务，若仍需新增，请手动处理`。
- 团队人员新增手机号码字段，用于钉钉 @。
- 设置页 webhook 通知区域新增“接收人”弹窗。
- 接收人弹窗支持：
  - @ 人功能开关。
  - `仅@人` / `@所有人` 策略。
  - 团队人员列表。
  - 手机号为空不可勾选并提示。
  - 额外接收人添加、编辑、删除。

涉及文件：

- `backend/src/models/Staff.js`
- `backend/src/models/AutoTaskRule.js`
- `backend/src/services/AutoTaskService.js`
- `backend/src/routes/staff.js`
- `backend/src/routes/settings.js`
- `backend/migration_v3.1.0.sql`
- `frontend/src/views/PersonnelPage.vue`
- `frontend/src/views/SettingsPage.vue`

验证记录：

- `node -c backend/src/services/AutoTaskService.js`
- `node -c backend/src/routes/settings.js`
- `node -c backend/src/routes/staff.js`
- `npx vite build --configLoader runner`
- Playwright 验证团队人员手机号列、接收人弹窗、手机号为空提示。

---

## 二、钉钉点击跳转能力调研

用户提出：卡片中点击“更新进度”后，需要识别点击者并跳转到该点击者自己的专属链接，非 @ 人进入无权限页。

调研结论：

- 当前群自定义机器人 webhook 不能识别谁点击了按钮。
- 要安全实现该能力，需要钉钉 H5 免登/OAuth 或互动卡片回调。
- 需要钉钉企业管理员支持创建企业内部应用、配置可信域名、获取 CorpId/AppKey/AppSecret 等。
- 无管理员支持时，无法强身份识别点击者。

归档文档：

- `docs/@plan/RESEARCH-dingtalk-progress-card.md`

---

## 三、最终执行口径：只做卡片式通知

用户确认：

- 不做点击跳转。
- 不做点击者身份识别。
- 使用截图类似的卡片式通知方式即可。

执行口径：

- 当前阶段基于钉钉群自定义机器人 webhook 发送 Markdown 卡片式通知。
- 继续复用现有 webhook 地址、通知文本、接收人配置。
- 卡片标题固定为 `语音产研进度维护通知：`。
- 不显示底部“更新进度”按钮。
- 通知内容输入框中的回车在发送前转换为 Markdown 硬换行，避免钉钉客户端把单个回车折叠为空格。
- 通知不承载个人专属跳转，不写入 fillToken。
- 保留 `仅@人` 和 `@所有人` 的 at 字段发送能力。

验证要求：

- webhook payload 的 `msgtype` 为 `markdown`。
- `markdown.title` 为 `语音产研进度维护通知：`。
- payload 不包含 `singleTitle`、`singleURL` 或其他底部按钮配置。
- payload 中用户输入的多行正文保留换行语义。
- `仅@人` 时保留 `atMobiles`。
- `@所有人` 时保留 `isAtAll: true`。

---

## 四、遗留说明

- 钉钉客户端对 Markdown 卡片式通知的样式有自身限制，浏览器静态 demo 只能作为视觉参考，不能保证圆角、颜色、间距 100% 一致。
- 若后续重新要求“点击者身份识别 + 跳自己专属链接”，需要重新进入钉钉企业应用免登/OAuth 方案，不应在当前 webhook 中强行实现。
