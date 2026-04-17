# 开发文档：钉钉私聊消息发送（Playwright 方案）

> 文档编号：DEV-DINGTALK
> 日期：2026-04-17
> 对应需求：REQ-dingtalk-private-message.md
> 版本：v1.0

---

## 1. 技术选型

| 技术 | 用途 | 版本 |
|------|------|------|
| Playwright | 浏览器自动化，操控钉钉网页版 | ^1.52.0 |
| Chromium | headless 浏览器内核 | Playwright 自带 |
| storageState | 保存/复用登录会话 | Playwright 内置 |
| Express Router | 新增 API 端点 | 项目已有 |

## 2. 系统架构

### 2.1 数据流

```
┌───────────────────────┐
│  TaskDetail.vue        │
│  点击「发送」按钮       │
│  sendLink(row)        │
└──────────┬────────────┘
           │ POST /api/dingtalk/send
           │ { staffName, message }
           ▼
┌───────────────────────┐
│  routes/dingtalk.js    │
│  参数校验 + 状态检查    │
└──────────┬────────────┘
           │ dingtalkService.sendMessage()
           ▼
┌───────────────────────────────────────────────┐
│  services/DingtalkService.js                   │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  sendMessage(staffName, messageText)     │  │
│  │                                          │  │
│  │  1. chromium.launch({ headless: true })  │  │
│  │  2. context({ storageState: session })   │  │
│  │  3. page.goto('im.dingtalk.com')         │  │
│  │  4. 检查登录状态（URL是否含login）         │  │
│  │  5. 搜索框 → 输入姓名 → 等待结果          │  │
│  │  6. 点击联系人 → 进入聊天窗口              │  │
│  │  7. 聊天输入框 → 输入消息 → Enter 发送    │  │
│  │  8. 更新 storageState（续期）             │  │
│  │  9. browser.close() → 返回结果            │  │
│  └──────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
           │
           ▼
┌───────────────────────┐
│  钉钉网页版             │
│  im.dingtalk.com       │
│  消息 → 钉钉服务器      │
│       → 对方钉钉客户端   │
└───────────────────────┘
```

### 2.2 登录流程

```
管理员调用 POST /api/dingtalk/login
           │
           ▼
┌───────────────────────────────────────┐
│  dingtalkService.login()              │
│                                       │
│  chromium.launch({ headless: false }) │  ← 有窗口，供扫码
│  page.goto('im.dingtalk.com')         │
│  显示二维码登录页                       │
│           │                           │
│  ← 管理员用手机扫码 →                   │
│           │                           │
│  waitForURL('**/im*', 120s)           │  ← 等待跳转到聊天页
│  context.storageState(SESSION_PATH)   │  ← 保存会话
│  browser.close()                      │
└───────────────────────────────────────┘
           │
           ▼
      dingtalk-session.json 生成
      后续发送均使用此文件
```

## 3. 文件变更清单

### 3.1 新增文件

| 文件 | 说明 |
|------|------|
| `backend/src/services/DingtalkService.js` | 核心服务：Playwright 自动化、会话管理、消息发送 |
| `backend/src/routes/dingtalk.js` | API 路由：login / status / send |
| `backend/src/config/dingtalk-selectors.js` | 钉钉网页版 DOM 选择器配置（便于维护） |

### 3.2 修改文件

| 文件 | 变更内容 |
|------|----------|
| `backend/src/app.js` | 注册 `/api/dingtalk` 路由 |
| `backend/package.json` | 新增 `playwright` 依赖 |
| `frontend/src/views/TaskDetail.vue` | `sendLink()` 从模拟提示改为调后端 API |
| `.gitignore` | 添加 `dingtalk-session.json` 排除 |

### 3.3 运行时生成文件（不入 Git）

| 文件 | 说明 |
|------|------|
| `backend/src/config/dingtalk-session.json` | 钉钉登录会话状态（Cookie + localStorage） |

## 4. API 接口设计

> **v1.1 变更**：新增 `/login/qrcode` 和 `/login/poll` 两个接口，用于在页面内内嵌二维码扫码，替代原先弹出 headed 浏览器窗口的方案。`/login` 接口保留作命令行备用。

### 4.0 接口总览

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/dingtalk/status` | GET | 查询登录状态 |
| `/api/dingtalk/login/qrcode` | POST | 获取二维码图片（headless 截图，base64） |
| `/api/dingtalk/login/poll` | GET | 轮询扫码是否完成 |
| `/api/dingtalk/login` | POST | 备用：弹出 headed 浏览器（命令行调试用） |
| `/api/dingtalk/send` | POST | 发送私聊消息 |

### 4.1 GET /api/dingtalk/status

查询钉钉登录状态。

**请求**：无参数

**响应**：
```json
{
  "code": 0,
  "data": {
    "loggedIn": true,
    "sessionAge": "3 天前登录"
  }
}
```

### 4.2 POST /api/dingtalk/login/qrcode

触发 headless 登录流程并返回二维码截图。

**请求**：无参数

**响应**（成功）：
```json
{
  "code": 0,
  "data": {
    "qrcode": "data:image/png;base64,iVBORw0KGgo...",
    "sessionId": "uuid-xxx"
  }
}
```

**说明**：
- 后端启动 headless Chromium，打开 `im.dingtalk.com` 登录页
- 等待二维码元素渲染后截图返回
- 同时在后台保持浏览器实例监听扫码跳转
- `sessionId` 用于后续轮询时标识当前登录会话

**响应**（已登录，无需扫码）：
```json
{
  "code": 4,
  "message": "已登录，无需扫码"
}
```

### 4.3 GET /api/dingtalk/login/poll

轮询扫码是否完成（前端每 2 秒调用一次）。

**请求**：无参数

**响应**（已扫码完成）：
```json
{
  "code": 0,
  "data": {
    "done": true,
    "message": "登录成功，会话已保存"
  }
}
```

**响应**（等待中）：
```json
{
  "code": 0,
  "data": {
    "done": false
  }
}
```

**响应**（无等待中的登录流程）：
```json
{
  "code": 5,
  "message": "无等待中的登录流程"
}
```

### 4.4 POST /api/dingtalk/login

触发扫码登录（弹出浏览器窗口）。

**请求**：无参数

**响应**（成功）：
```json
{
  "code": 0,
  "data": {
    "success": true,
    "message": "登录成功，会话已保存"
  }
}
```

**响应**（超时）：
```json
{
  "code": 1,
  "message": "扫码超时（2分钟），请重试"
}
```

### 4.3 POST /api/dingtalk/send

发送钉钉私聊消息。

**请求**：
```json
{
  "staffName": "赖香山",
  "message": "【工时填写提醒】\n语音业务线-2026年第16周\n请点击链接填写：http://..."
}
```

**响应**（成功）：
```json
{
  "code": 0,
  "data": {
    "success": true,
    "message": "已发送给 赖香山"
  }
}
```

**响应**（会话过期）：
```json
{
  "code": 2,
  "message": "钉钉会话已过期，请重新扫码登录"
}
```

**响应**（联系人未找到）：
```json
{
  "code": 3,
  "message": "未在钉钉中找到联系人：赖香山"
}
```

## 5. 核心模块详细设计

### 5.1 DingtalkService.js

```javascript
/**
 * DingtalkService — 钉钉网页版自动化服务
 * 
 * 职责：
 * - 管理钉钉网页版登录会话（storageState）
 * - 通过 Playwright headless 浏览器发送私聊消息
 * - 请求队列，保证串行执行
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const SELECTORS = require('../config/dingtalk-selectors');

const SESSION_PATH = path.join(__dirname, '../config/dingtalk-session.json');
const DINGTALK_URL = 'https://im.dingtalk.com';

class DingtalkService {
  constructor() {
    this._queue = Promise.resolve(); // 串行队列
  }

  /** 检查会话文件是否存在 */
  isLoggedIn() {
    return fs.existsSync(SESSION_PATH);
  }

  /** 获取会话年龄 */
  getSessionAge() {
    if (!this.isLoggedIn()) return null;
    const stat = fs.statSync(SESSION_PATH);
    const days = Math.floor((Date.now() - stat.mtimeMs) / 86400000);
    return days === 0 ? '今天登录' : `${days} 天前登录`;
  }

  /** 扫码登录（headed 模式） */
  async login() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(DINGTALK_URL);
      
      // 等待用户扫码 → 页面跳转到消息列表
      await page.waitForURL('**/im*', { timeout: 120_000 });
      
      // 额外等待确保页面完全加载
      await page.waitForTimeout(3000);
      
      // 保存会话
      await context.storageState({ path: SESSION_PATH });
      
      return { success: true, message: '登录成功，会话已保存' };
    } catch (err) {
      if (err.message.includes('Timeout')) {
        throw new Error('扫码超时（2分钟），请重试');
      }
      throw err;
    } finally {
      await browser.close();
    }
  }

  /** 发送私聊消息（加入队列串行执行） */
  sendMessage(staffName, messageText) {
    return new Promise((resolve, reject) => {
      this._queue = this._queue
        .then(() => this._doSend(staffName, messageText))
        .then(resolve)
        .catch(reject);
    });
  }

  /** 实际发送逻辑 */
  async _doSend(staffName, messageText) {
    if (!this.isLoggedIn()) {
      const err = new Error('未登录钉钉，请先执行扫码登录');
      err.code = 2;
      throw err;
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: SESSION_PATH });
    const page = await context.newPage();

    try {
      // 1. 打开钉钉网页版
      await page.goto(DINGTALK_URL);
      await page.waitForLoadState('networkidle');

      // 2. 检测会话是否过期
      if (page.url().includes('login') || page.url().includes('passport')) {
        fs.unlinkSync(SESSION_PATH);
        const err = new Error('钉钉会话已过期，请重新扫码登录');
        err.code = 2;
        throw err;
      }

      // 3. 等待主界面加载完成
      await page.waitForSelector(SELECTORS.SIDEBAR, { timeout: 15_000 });

      // 4. 点击搜索框
      await page.click(SELECTORS.SEARCH_BTN);
      await page.waitForTimeout(300);

      // 5. 输入联系人姓名
      await page.fill(SELECTORS.SEARCH_INPUT, staffName);
      await page.waitForTimeout(1500); // 等待搜索结果

      // 6. 在搜索结果中查找并点击联系人
      const contact = page.locator(SELECTORS.SEARCH_RESULT_ITEM)
        .filter({ hasText: staffName })
        .first();
      
      if (await contact.count() === 0) {
        const err = new Error(`未在钉钉中找到联系人：${staffName}`);
        err.code = 3;
        throw err;
      }
      await contact.click();
      await page.waitForTimeout(1000);

      // 7. 在聊天输入框中输入消息
      await page.waitForSelector(SELECTORS.MSG_INPUT, { timeout: 10_000 });
      await page.click(SELECTORS.MSG_INPUT);
      
      // 逐行输入（处理换行符）
      const lines = messageText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) {
          await page.keyboard.down('Shift');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Shift');
        }
        await page.keyboard.type(lines[i], { delay: 10 });
      }

      // 8. 发送消息
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);

      // 9. 续期会话
      await context.storageState({ path: SESSION_PATH });

      return { success: true, message: `已发送给 ${staffName}` };

    } finally {
      await browser.close();
    }
  }
}

module.exports = new DingtalkService();
```

### 5.2 dingtalk-selectors.js

```javascript
/**
 * 钉钉网页版 DOM 选择器配置
 * 
 * 钉钉网页版更新时仅需修改此文件
 * 选择器优先使用 role / text / data-* 属性，减少对 class 的依赖
 * 
 * 注意：以下选择器需在实际钉钉网页版中验证后确定
 * 开发时需用 headed 模式 + page.pause() 逐步调试
 */
module.exports = {
  // 侧边栏（确认主界面加载完成）
  SIDEBAR: '#sidebar-session-list, [class*="session-list"], [class*="sidebar"]',

  // 搜索按钮（顶部搜索入口）
  SEARCH_BTN: '#search-input, [class*="search-btn"], [class*="search-input"], [placeholder*="搜索"]',

  // 搜索输入框（展开后的输入框）
  SEARCH_INPUT: 'input[placeholder*="搜索"], [class*="search"] input, #search-input',

  // 搜索结果列表中的单个条目
  SEARCH_RESULT_ITEM: '[class*="search-result"] [class*="item"], [class*="search-panel"] [class*="contact"]',

  // 聊天消息输入框
  MSG_INPUT: '[contenteditable="true"], #MessageEditor, [class*="chat-editor"], [class*="message-input"]',
};
```

### 5.3 routes/dingtalk.js

```javascript
const express = require('express');
const router = express.Router();
const dingtalkService = require('../services/DingtalkService');

/** GET /api/dingtalk/status */
router.get('/status', (req, res) => {
  res.json({
    code: 0,
    data: {
      loggedIn: dingtalkService.isLoggedIn(),
      sessionAge: dingtalkService.getSessionAge()
    }
  });
});

/** POST /api/dingtalk/login */
router.post('/login', async (req, res, next) => {
  try {
    const result = await dingtalkService.login();
    res.json({ code: 0, data: result });
  } catch (err) {
    res.status(500).json({ code: 1, message: err.message });
  }
});

/** POST /api/dingtalk/send */
router.post('/send', async (req, res, next) => {
  try {
    const { staffName, message } = req.body;
    if (!staffName) return res.status(400).json({ code: 1, message: '缺少 staffName' });
    if (!message) return res.status(400).json({ code: 1, message: '缺少 message' });

    const result = await dingtalkService.sendMessage(staffName, message);
    res.json({ code: 0, data: result });
  } catch (err) {
    const code = err.code || 1;
    const status = code === 2 ? 401 : code === 3 ? 404 : 500;
    res.status(status).json({ code, message: err.message });
  }
});

module.exports = router;
```

### 5.4 前端 TaskDetail.vue 变更

**现有代码**（`@TaskDetail.vue:232-236`）：
```javascript
/** 模拟发送（Demo 阶段） */
function sendLink(link) {
  const staffName = link.staff?.name || '未知'
  ElMessage.success(`已通过钉钉发送给 ${staffName}`)
}
```

**替换为**：
```javascript
/** 发送钉钉私聊消息 */
const sendingLinkId = ref('')

async function sendLink(link) {
  const staffName = link.staff?.name
  if (!staffName) return ElMessage.warning('该链接无关联人员')

  sendingLinkId.value = link.id
  const taskTitle = taskDetail.value?.title || '工时统计'
  const fillUrl = buildFillUrl(link.token)
  const message = `【工时填写提醒】\n${taskTitle}\n请点击链接填写：${fillUrl}`

  try {
    const res = await api.post('/dingtalk/send', { staffName, message })
    if (res.data.code === 0) {
      ElMessage.success(`已发送给 ${staffName}`)
    } else {
      ElMessage.error(res.data.message || '发送失败')
    }
  } catch (err) {
    const msg = err.response?.data?.message || err.message
    if (err.response?.data?.code === 2) {
      ElMessage.warning('钉钉未登录或会话过期，请联系管理员扫码登录')
    } else {
      ElMessage.error('发送失败：' + msg)
    }
  } finally {
    sendingLinkId.value = ''
  }
}
```

**模板中按钮变更**：
```html
<!-- 原 -->
<el-button type="primary" link size="small" @click="sendLink(row)">发送</el-button>

<!-- 改为 -->
<el-button type="primary" link size="small"
  :loading="sendingLinkId === row.id"
  @click="sendLink(row)">
  {{ sendingLinkId === row.id ? '发送中...' : '发送' }}
</el-button>
```

### 5.5 app.js 变更

在路由注册区块添加一行：
```javascript
app.use('/api/dingtalk',   require('./routes/dingtalk'));
```

### 5.6 .gitignore 变更

添加：
```
# 钉钉登录会话（含敏感 Cookie）
backend/src/config/dingtalk-session.json
```

## 6. 选择器调试指南

钉钉网页版的 DOM 选择器需要实测确认。调试方法：

### 6.1 headed 模式 + page.pause()

在 DingtalkService 中临时修改：
```javascript
const browser = await chromium.launch({ headless: false });
// ... 加载页面后
await page.pause(); // 会打开 Playwright Inspector
```

### 6.2 使用 Playwright Inspector

```bash
cd backend
npx playwright codegen im.dingtalk.com
```

这会打开浏览器并记录你的操作，自动生成选择器代码。

### 6.3 选择器优先级策略

1. `role` 属性（最稳定）：`page.getByRole('textbox', { name: '搜索' })`
2. `text` 内容：`page.getByText('赖香山')`
3. `placeholder`：`page.getByPlaceholder('搜索')`
4. `data-*` 属性：`[data-testid="search"]`
5. `class` 名（最不稳定）：`[class*="search-input"]`

## 7. 错误处理矩阵

| 错误场景 | 错误码 | 后端处理 | 前端提示 |
|----------|--------|----------|----------|
| 未登录（无会话文件） | 2 | 抛出异常 | 「钉钉未登录，请联系管理员扫码登录」 |
| 会话过期 | 2 | 删除过期文件 + 抛出异常 | 「钉钉会话过期，请联系管理员重新扫码」 |
| 联系人未找到 | 3 | 抛出异常 | 「未在钉钉中找到联系人：xxx」 |
| 扫码超时 | 1 | 关闭浏览器 + 抛出异常 | 「扫码超时，请重试」 |
| 网络错误 | 1 | 抛出异常 | 「发送失败：xxx」 |
| 并发请求 | — | 队列串行 | 正常等待 |

## 8. 性能考虑

| 环节 | 耗时预估 | 优化手段 |
|------|----------|----------|
| 启动 Chromium | 1-2s | 冷启动不可避免，后续可考虑浏览器池 |
| 加载钉钉网页版 | 2-3s | storageState 跳过登录 |
| 搜索联系人 | 1-2s | 直接输入姓名 |
| 输入消息 + 发送 | 0.5-1s | keyboard.type 快速输入 |
| **总计** | **5-8s** | 可接受范围 |

## 9. 安全考虑

- `dingtalk-session.json` 包含完整的登录 Cookie，**绝不能入 Git**
- 已在 `.gitignore` 中排除
- 生产环境部署时该文件需单独管理
- 建议限制 `/api/dingtalk/login` 仅允许本地访问或增加管理员鉴权
