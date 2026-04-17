# 开发对话记录 v1.5.0 — 钉钉私聊消息发送

> 日期：2026-04-17
> 版本：v1.5.0
> 涉及功能：钉钉登录状态指示器 + 二维码扫码 + 私聊发送

---

## 对话摘要

### 1. 调研阶段

**用户提问**：在任务收集链接管理下的发送按钮，能否发送到电脑登录的钉钉里对应姓名人员钉钉消息？

**调研结论**（见 docs/demand/dingtalk-send-proposal.md）：
- 方案 A：群机器人 Webhook（需建群）
- 方案 B：Playwright 操控钉钉网页版（一对一私聊，首次扫码）
- 方案 C：URL Scheme（半自动，体验差）

用户选择**方案 B**。

---

### 2. 文档编写阶段

产出三份文档：
- `docs/demand/REQ-dingtalk-private-message.md` — 需求文档
- `docs/development/DEV-dingtalk-private-message.md` — 开发设计文档
- `docs/@plan/PLAN-dingtalk-private-message.md` — 开发计划（6阶段，5小时）

---

### 3. UI 方案优化

**用户提问**：扫码登录的二维码能否放在「为全员生成链接」右侧作为一个状态指示器，直接在页面内展示二维码而不弹独立浏览器窗口？

**方案调整**：
- 原方案：`headless: false` 弹出独立浏览器窗口
- 新方案：`headless: true` 截取二维码图片返回 base64，嵌入页面 Popover 显示
- 新增接口：`POST /api/dingtalk/login/qrcode`（截图）、`GET /api/dingtalk/login/poll`（轮询）

**UI 交互设计**：
- 绿色「钉钉已登录」/ 红色「钉钉未登录」状态标签
- `▼ 扫码 / ▲ 收起` 展开按钮
- 二维码浮显卡片（绝对定位，含淡入淡出过渡）
- 扫码成功后自动关闭卡片，状态变绿

---

### 4. 开发执行阶段

开发顺序：
1. 更新 DEV 文档补充新接口设计
2. 安装 Playwright + Chromium（`npx playwright install chromium`）
3. 创建 `dingtalk-selectors.js`（选择器配置）
4. 创建 `DingtalkService.js`（核心服务：截图 + 发送 + 队列）
5. 创建 `routes/dingtalk.js`（4个 API 端点）
6. 注册路由到 `app.js`
7. 修改 `TaskDetail.vue`：状态指示器 + Popover + sendLink() 真实实现
8. 前端构建验证（零错误）

---

### 5. 测试约定

> **重要**：发送功能仅对「朱俊锋」账户进行测试，其他人员不点击发送。

---

## 关键决策记录

| 决策点 | 选项 | 选择 | 理由 |
|--------|------|------|------|
| 钉钉方案 | 群机器人 / Playwright / URL Scheme | Playwright | 一对一私聊，体验最好 |
| 扫码方式 | 弹出浏览器窗口 / 页面内截图 | 页面内截图 | 无感，不抢占焦点 |
| 二维码展示 | 独立页面 / 抽屉 / Popover | 绝对定位浮层 | 轻量，不影响布局 |
| 发送串行 | 并发 / 串行队列 | Promise 串行队列 | 防止多实例并发 |

---

## 遗留事项

- [ ] 阶段 2（选择器实测）：需要用真实钉钉账号扫码验证 DOM 选择器是否匹配
- [ ] 如二维码截图区域不准确，需更新 `dingtalk-selectors.js`
- [ ] 生产部署时需单独管理 `dingtalk-session.json`（不随代码部署）
