# 开发计划：钉钉私聊消息发送

> 日期：2026-04-17
> 需求文档：docs/demand/REQ-dingtalk-private-message.md
> 开发文档：docs/development/DEV-dingtalk-private-message.md
> 预估总工时：5 小时
> 状态：等待确认启动

---

## 开发阶段

### 阶段 1：环境准备（20 min）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1.1 | 后端安装 Playwright 依赖 `npm install playwright` | package.json 更新 |
| 1.2 | 下载 Chromium 内核 `npx playwright install chromium` | 浏览器可用 |
| 1.3 | `.gitignore` 添加 `dingtalk-session.json` | 安全排除 |

### 阶段 2：选择器实测（1h）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 2.1 | 用 `npx playwright codegen im.dingtalk.com` 打开钉钉网页版 | 录制操作 |
| 2.2 | 手动扫码登录，记录登录成功后的 URL 特征 | 登录检测逻辑 |
| 2.3 | 定位搜索框、搜索结果、聊天输入框的 DOM 选择器 | dingtalk-selectors.js |
| 2.4 | 测试搜索联系人 → 输入消息 → 发送的完整流程 | 选择器验证通过 |

```
流程：
打开 im.dingtalk.com
  → 扫码登录
    → 用 Playwright Inspector 检查搜索框选择器
      → 搜索一个联系人，检查结果列表选择器
        → 点击进入聊天，检查输入框选择器
          → 输入消息并发送，确认成功
```

### 阶段 3：后端核心服务（2h）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 3.1 | 创建 `backend/src/config/dingtalk-selectors.js` | 选择器配置文件 |
| 3.2 | 创建 `backend/src/services/DingtalkService.js` | 核心服务 |
| 3.2.1 | — 实现 `isLoggedIn()` / `getSessionAge()` | 状态查询 |
| 3.2.2 | — 实现 `login()` 扫码登录 + storageState 保存 | 登录功能 |
| 3.2.3 | — 实现 `sendMessage()` 搜索+输入+发送 | 消息发送 |
| 3.2.4 | — 实现请求队列（串行执行） | 并发控制 |
| 3.2.5 | — 实现会话过期检测 + 自动清理 | 错误恢复 |
| 3.3 | 创建 `backend/src/routes/dingtalk.js` | API 路由 |
| 3.3.1 | — `GET /api/dingtalk/status` | 状态查询接口 |
| 3.3.2 | — `POST /api/dingtalk/login` | 登录接口 |
| 3.3.3 | — `POST /api/dingtalk/send` | 发送接口 |
| 3.4 | 在 `app.js` 注册 `/api/dingtalk` 路由 | 路由生效 |

```
依赖关系：
阶段2（选择器）→ 3.1（写入配置）→ 3.2（服务引用配置）→ 3.3（路由调服务）→ 3.4（注册路由）
```

### 阶段 4：前端对接（0.5h）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 4.1 | 修改 `TaskDetail.vue` 的 `sendLink()` 函数 | 调后端 API |
| 4.2 | 添加 `sendingLinkId` 响应式变量 | 加载状态管理 |
| 4.3 | 修改发送按钮模板，增加 loading 状态 | 发送中反馈 |
| 4.4 | 错误处理：区分未登录/过期/找不到人 | 精准错误提示 |

### 阶段 5：联调测试（1h）

| 步骤 | 内容 | 预期结果 |
|------|------|----------|
| 5.1 | 调用 `POST /api/dingtalk/login` 扫码登录 | dingtalk-session.json 生成 |
| 5.2 | 调用 `GET /api/dingtalk/status` | 返回 loggedIn: true |
| 5.3 | 前端点击「发送」→ 选一个团队成员测试 | 对方钉钉收到私聊消息 |
| 5.4 | 删除 session 文件 → 再点发送 | 前端提示「未登录」 |
| 5.5 | 连续快速点击多个「发送」 | 队列串行执行，均成功 |
| 5.6 | 搜索一个不在通讯录的姓名 | 提示「未找到联系人」 |
| 5.7 | 确认 session 文件未被 git 追踪 | git status 无此文件 |

### 阶段 6：文档归档（20 min）

| 步骤 | 内容 |
|------|------|
| 6.1 | 更新 `docs/PROJECT_STATUS.md` 版本号 |
| 6.2 | 创建版本发布文档 `docs/development/v1.5.0-dingtalk-send.md` |
| 6.3 | Git commit 并推送到 GitHub |

---

## 开发顺序流程图

```
阶段1 环境准备 ──→ 阶段2 选择器实测 ──→ 阶段3 后端开发 ──→ 阶段4 前端对接 ──→ 阶段5 联调测试 ──→ 阶段6 归档
 (20min)           (1h)                (2h)               (30min)            (1h)              (20min)
                                                                                              ≈ 5h
```

---

## 里程碑检查点

| 检查点 | 阶段完成后 | 验证方式 |
|--------|-----------|----------|
| ✅ Playwright 可用 | 阶段 1 | `node -e "require('playwright')"` 无报错 |
| ✅ 选择器确认 | 阶段 2 | codegen 录制脚本可回放成功 |
| ✅ 后端 API 可调 | 阶段 3 | curl/Postman 调用三个接口均正常 |
| ✅ 前端按钮生效 | 阶段 4 | 点击发送出现 loading + 成功/失败提示 |
| ✅ 端到端通过 | 阶段 5 | 对方钉钉收到消息 |
| ✅ 代码入库 | 阶段 6 | GitHub 最新提交包含所有变更 |

---

## 风险项

| 风险 | 影响 | 应对 | 负责 |
|------|------|------|------|
| 钉钉网页版 DOM 与预期不符 | 阶段 2 耗时增加 | 用 codegen 逐步调试 | 开发 |
| 钉钉网页版 headless 下行为不同 | 消息发送失败 | 先 headed 验证，再切 headless | 开发 |
| 扫码后 Cookie 很快过期 | 频繁需要重新登录 | 每次发送后自动续期 storageState | 开发 |
| 联系人姓名重复 | 发送给错误的人 | 取搜索结果第一个精确匹配 | 开发 |

---

## 前置条件

开发启动前需确认：

1. ✅ 方案已确认（Playwright 网页版方案）
2. ⬜ 本地可登录钉钉网页版 im.dingtalk.com（确认网络可达）
3. ⬜ 有可测试的钉钉联系人（团队成员中选一人做测试）
