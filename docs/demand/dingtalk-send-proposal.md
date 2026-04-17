# 钉钉消息发送功能 — 技术方案调研（第二版）

> 日期：2026-04-17
> 状态：待确认
> 核心约束：**无法使用钉钉开放平台**，需要「无感发送」给目标钉钉用户

## 需求描述

在「任务收集 → 任务详情 → 链接管理」的操作列，点击「发送」按钮后，将该员工的专属填写链接通过钉钉发送给对应姓名的人员。要求无感发送（用户点击后自动完成，不需要手动操作钉钉客户端）。

---

## 关键结论

> **在不使用钉钉开放平台的前提下，无法实现真正的「无感私聊」。**
> 钉钉的私聊消息通道被锁定在开放平台 API 背后（需要 AppKey/AppSecret/AgentId）。
> 以下是所有可行的替代方案，按推荐程度排列。

---

## 方案总览

| 方案 | 消息形式 | 无感程度 | 权限需求 | 稳定性 | 推荐 |
|------|----------|----------|----------|--------|------|
| A. 群机器人 Webhook | 群消息 @个人 | ★★★★★ 全自动 | 零门槛 | 高 | ⭐ 首选 |
| B. 钉钉网页版 Playwright | 一对一私聊 | ★★★★☆ 近无感 | 零门槛 | 中 | 可选 |
| C. 客户端 Win32 后台操作 | 一对一私聊 | ★★★☆☆ | 零门槛 | 低 | 备选 |
| D. dingtalk:// URL Scheme | 打开窗口 | ★☆☆☆☆ 手动 | 零门槛 | 低 | 不推荐 |

---

## 方案 A：钉钉群机器人 Webhook（⭐ 首选）

**原理**：在团队钉钉群中添加自定义机器人，后端通过 Webhook URL 发消息到群内并 @指定人。

**无感程度**：★★★★★ — 点击「发送」→ 后端 HTTP POST → 群内秒出消息，全自动

**优点**：

- 任何群成员都可添加机器人，零权限门槛
- 纯 HTTP POST，后端 Node.js 直接调用，无额外依赖
- 被 @的人有**独立通知提醒**（手机/电脑均弹通知，即使开了免打扰）
- 支持 text / link / markdown / ActionCard 消息类型
- 每月免费 5000 次（团队 9 人 × 每周 1 次 ≈ 36 次/月）
- 最稳定，钉钉官方标准功能

**缺点**：

- 消息在群内可见（非私聊），但可建专用通知群，仅用于发送提醒
- 需要记录每位员工的手机号（用于 @）

**消息效果**：员工收到群 @提醒，手机/电脑均弹通知

```
【工时填写提醒】
@赖香山
语音业务线-2026年第16周工时统计
请点击链接填写 → http://jfzhu8023.cloud/devtracker/fill/xxx
```

**你需要做的**：

1. 创建一个钉钉群（如「工时收集通知」），拉入所有团队成员
2. 群设置 → 智能群助手 → 添加自定义机器人 → 安全设置选「加签」
3. 把 Webhook URL、Secret、每位成员手机号提供给我

---

## 方案 B：Playwright 操控钉钉网页版（可选 — 真私聊）— 详细方案

### B.1 原理

用 Playwright（Node.js 版）自动化操控钉钉网页版 `im.dingtalk.com`。
首次扫码登录后，通过 `storageState` 保存完整会话（Cookie + localStorage），
后续每次发送直接复用会话，在 headless 浏览器中完成搜索联系人→输入消息→发送，全程后台无感。

### B.2 无感程度

★★★★☆ — 首次需扫码登录（仅一次，约 30 天有效），之后全自动后台运行

### B.3 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 TaskDetail.vue                                             │
│  点击「发送」按钮                                                  │
│    → POST /api/dingtalk/send { staffName, message, linkUrl }    │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  后端 routes/dingtalk.js                                         │
│                                                                  │
│  1. 接收请求，校验参数                                              │
│  2. 调用 DingtalkService.sendMessage(staffName, message, url)   │
│  3. 返回 { code: 0, message: '发送成功' }                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  后端 services/DingtalkService.js                                │
│                                                                  │
│  核心流程（Playwright headless Chromium）：                        │
│                                                                  │
│  ┌─ 检查 session 文件是否存在 ──────────────────────────┐         │
│  │  存在 → 加载 storageState → 打开 im.dingtalk.com    │         │
│  │  不存在 → 返回错误，提示需要先登录                      │         │
│  └──────────────────────────────────────────────────────┘         │
│                                                                  │
│  ┌─ 发送消息流程 ──────────────────────────────────────┐          │
│  │  1. 点击搜索框 → 输入联系人姓名                       │          │
│  │  2. 等待搜索结果 → 点击匹配的联系人                    │          │
│  │  3. 等待聊天窗口加载                                  │          │
│  │  4. 在输入框中输入消息内容（含链接）                    │          │
│  │  5. 按 Enter 发送                                    │          │
│  │  6. 验证发送成功 → 返回结果                           │          │
│  └──────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  后端 routes/dingtalk.js — 登录端点                                │
│                                                                   │
│  GET /api/dingtalk/login-qrcode                                  │
│  1. 启动 headed 浏览器（非 headless，显示窗口）                      │
│  2. 打开 im.dingtalk.com 登录页                                    │
│  3. 返回提示「请用手机钉钉扫码」                                     │
│  4. 等待登录成功（检测 URL 变化 / DOM 变化）                         │
│  5. context.storageState({ path: 'dingtalk-session.json' })      │
│  6. 关闭浏览器，返回「登录成功，会话已保存」                           │
└──────────────────────────────────────────────────────────────────┘
```

### B.4 新增文件清单

```
backend/
├── src/
│   ├── routes/dingtalk.js          # 新增：钉钉相关 API 路由
│   ├── services/DingtalkService.js # 新增：Playwright 自动化核心服务
│   └── config/dingtalk-session.json# 运行时生成：登录会话文件（gitignore）
└── package.json                    # 新增依赖：playwright

frontend/
└── src/views/TaskDetail.vue        # 修改：sendLink() 改为调后端 API
```

### B.5 后端依赖变更

```json
// backend/package.json 新增
{
  "dependencies": {
    "playwright": "^1.52.0"
  }
}
```

安装后需执行 `npx playwright install chromium` 下载 Chromium 浏览器内核（约 150MB）。

### B.6 核心代码设计

#### 6.1 DingtalkService.js（核心服务）

```javascript
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION_PATH = path.join(__dirname, '../config/dingtalk-session.json');
const DINGTALK_URL = 'https://im.dingtalk.com';

class DingtalkService {

  /** 检查是否已登录（会话文件是否存在） */
  isLoggedIn() {
    return fs.existsSync(SESSION_PATH);
  }

  /** 首次扫码登录，保存会话 — 需在本地执行（headed 模式） */
  async login() {
    const browser = await chromium.launch({ headless: false }); // 显示窗口供扫码
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(DINGTALK_URL);
    // 等待用户扫码完成，检测到进入聊天列表页面
    await page.waitForURL('**/im*', { timeout: 120_000 }); // 最多等 2 分钟

    // 保存完整会话状态（Cookie + localStorage）
    await context.storageState({ path: SESSION_PATH });
    await browser.close();
    return { success: true, message: '登录成功，会话已保存' };
  }

  /** 发送私聊消息 */
  async sendMessage(staffName, messageText) {
    if (!this.isLoggedIn()) {
      throw new Error('未登录钉钉，请先调用登录接口');
    }

    const browser = await chromium.launch({ headless: true }); // 后台无感
    const context = await browser.newContext({ storageState: SESSION_PATH });
    const page = await context.newPage();

    try {
      // 1. 打开钉钉网页版
      await page.goto(DINGTALK_URL);
      await page.waitForLoadState('networkidle');

      // 2. 检测是否需要重新登录（Cookie 过期）
      if (page.url().includes('login')) {
        fs.unlinkSync(SESSION_PATH); // 删除过期会话
        throw new Error('会话已过期，请重新扫码登录');
      }

      // 3. 点击搜索框，输入联系人姓名
      await page.click('[data-testid="search-input"]'); // 选择器需实测确认
      await page.fill('[data-testid="search-input"]', staffName);
      await page.waitForTimeout(1000); // 等待搜索结果

      // 4. 点击搜索结果中的联系人
      await page.click(`text="${staffName}"`);
      await page.waitForTimeout(500);

      // 5. 在聊天输入框中输入消息
      await page.click('#MessageEditor'); // 选择器需实测确认
      await page.keyboard.type(messageText);

      // 6. 发送
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // 7. 更新会话（续期）
      await context.storageState({ path: SESSION_PATH });

      return { success: true, message: `已发送给 ${staffName}` };
    } finally {
      await browser.close();
    }
  }
}

module.exports = new DingtalkService();
```

#### 6.2 routes/dingtalk.js（API 路由）

```javascript
const express = require('express');
const router = express.Router();
const dingtalkService = require('../services/DingtalkService');

/** GET /api/dingtalk/status — 查询登录状态 */
router.get('/status', (req, res) => {
  res.json({ code: 0, data: { loggedIn: dingtalkService.isLoggedIn() } });
});

/** POST /api/dingtalk/login — 触发扫码登录（仅限本地环境） */
router.post('/login', async (req, res, next) => {
  try {
    const result = await dingtalkService.login();
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
});

/** POST /api/dingtalk/send — 发送消息 */
router.post('/send', async (req, res, next) => {
  try {
    const { staffName, message } = req.body;
    if (!staffName || !message) {
      return res.status(400).json({ code: 1, message: '缺少 staffName 或 message' });
    }
    const result = await dingtalkService.sendMessage(staffName, message);
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
});

module.exports = router;
```

#### 6.3 前端 TaskDetail.vue sendLink() 改动

```javascript
/** 发送钉钉消息 */
async function sendLink(link) {
  const staffName = link.staff?.name;
  if (!staffName) return ElMessage.warning('该链接无关联人员');

  const taskTitle = task.value?.title || '工时统计';
  const fillUrl = buildFillUrl(link.token);
  const message = `【工时填写提醒】\n${taskTitle}\n请点击链接填写：${fillUrl}`;

  try {
    const res = await api.post('/dingtalk/send', { staffName, message });
    if (res.data.code === 0) {
      ElMessage.success(`已发送给 ${staffName}`);
    } else {
      ElMessage.error(res.data.message || '发送失败');
    }
  } catch (err) {
    if (err.response?.data?.message?.includes('未登录')) {
      ElMessage.warning('钉钉未登录，请联系管理员执行扫码登录');
    } else {
      ElMessage.error('发送失败：' + (err.response?.data?.message || err.message));
    }
  }
}
```

### B.7 使用流程

#### 首次配置（仅一次）

```
1. 安装依赖
   cd backend && npm install playwright
   npx playwright install chromium

2. 启动后端后，在本地浏览器或终端触发登录：
   POST http://localhost:3001/api/dingtalk/login

3. 弹出浏览器窗口 → 打开钉钉网页版登录页
   → 用手机钉钉扫码
   → 登录成功后自动保存会话，浏览器关闭

4. 完成！之后发送消息全自动
```

#### 日常使用

```
用户在 TaskDetail → 链接管理 → 点击「发送」
  → 系统后台自动：
    启动 headless 浏览器 → 加载已保存的会话
    → 搜索联系人 → 发送消息 → 关闭浏览器
  → 前端显示「已发送给 xxx」
  → 对方钉钉收到私聊消息
```

#### 会话过期处理

```
Cookie 约 30 天过期
→ 发送时自动检测
→ 前端提示「钉钉会话已过期，请联系管理员重新扫码」
→ 管理员执行 POST /api/dingtalk/login 重新扫码
```

### B.8 消息效果预览

对方在钉钉中收到的私聊消息：

```
【工时填写提醒】
语音业务线-2026年第16周工时统计
请点击链接填写：http://jfzhu8023.cloud/devtracker/fill/abc123
```

### B.9 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| 钉钉网页版 DOM 结构变更 | 中（每季度可能） | 选择器使用 role/text 优先，减少对 class/id 依赖；变更时更新选择器 |
| Cookie 过期 | 确定（约30天） | 自动检测 + 前端提示 + 管理员一键重新扫码 |
| 搜索姓名匹配到多人 | 低（团队仅9人） | 优先匹配完全一致的姓名；可加部门/备注辅助匹配 |
| headless 模式被钉钉检测 | 低 | 使用真实 Chromium 内核 + storageState，行为与正常浏览器一致 |
| 服务器无图形环境 | 确定 | Playwright headless 不需要图形环境；首次登录在本地执行即可 |
| 发送并发冲突 | 低 | 加请求队列，串行处理发送任务 |

### B.10 开发工作量

| 任务 | 预估 |
|------|------|
| 后端：DingtalkService.js 核心服务 | 2h |
| 后端：routes/dingtalk.js API 端点 | 0.5h |
| 后端：app.js 注册路由 | 5min |
| 前端：sendLink() 对接后端 API | 0.5h |
| 安装 Playwright + Chromium | 10min |
| 实测钉钉网页版 DOM 选择器 | 1h |
| 会话过期检测 + 重新登录流程 | 0.5h |
| 测试验证 | 0.5h |
| **合计** | **约 5h** |

### B.11 你需要做的

1. **确认方案** — 回复确认后我立即开始开发
2. **首次扫码** — 开发完成后，在本地运行一次登录接口，用手机钉钉扫码
3. **无其他配置** — 不需要 AppKey、Secret、手机号等任何额外信息

---

## 方案 C：Win32 后台操作钉钉客户端（备选）

**原理**：通过 Python pywinauto + Win32 API 在后台操控已登录的钉钉 PC 客户端。

**无感程度**：★★★☆☆ — 部分操作（如搜索框输入）可后台完成，但钉钉窗口会短暂闪烁

**优点**：

- 真正的私聊消息
- 不需要任何 API 权限

**缺点**：

- 钉钉客户端基于 Electron，部分控件无法通过 Win32 API 在后台操作
- 搜索和发送时钉钉窗口会**短暂弹出/闪烁**（非完全无感）
- 依赖特定钉钉客户端版本的 UI 结构
- 需要额外安装 Python + pywinauto
- 只能在 Windows 上运行，服务器端无法使用
- 稳定性差，弹窗/更新提示会打断流程

**结论**：无法做到真正无感，**不推荐**。

---

## 方案 D：dingtalk:// URL Scheme

**原理**：通过协议链接唤起客户端聊天窗口。

**结论**：只能打开窗口，无法自动填写和发送消息，且部分协议已废弃。**不推荐**。

---

## 最终推荐

### 如果接受「群消息 @个人」→ 选方案 A

- 实现最快（3h）、最稳定、完全无感、零权限
- 被 @的人有独立通知，体验接近私聊
- 建议创建专用通知群，群内只做发送提醒用

### 如果必须「一对一私聊」→ 选方案 B

- 实现周期稍长（5h）、需首次扫码、Cookie 需定期维护
- 但能做到真正私聊，用户后台无感

### 开发工作量对比

| 任务 | 方案 A | 方案 B |
|------|--------|--------|
| 后端：消息发送服务 | 0.5h | 2h |
| 后端：API 端点 | 0.5h | 0.5h |
| 前端：发送按钮对接 | 0.5h | 0.5h |
| 数据库：staff 表加 phone 字段 | 0.5h | — |
| 团队人员页：手机号录入 | 0.5h | — |
| Cookie 管理 / 扫码登录页 | — | 1.5h |
| 测试验证 | 0.5h | 0.5h |
| **合计** | **约 3h** | **约 5h** |

---

> 请确认选择哪个方案，我立即开始开发。
