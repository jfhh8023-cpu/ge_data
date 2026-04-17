# 开发对话记录 — v1.5.1 钉钉功能移除 & 新需求调研

**日期**: 2026-04-17  
**关联版本**: v1.5.1（钉钉功能清除）+ 新需求文档确认  
**对话摘要**: 彻底移除钉钉私信功能；调研并确认首选收集项 & 系统级链接重构方案

---

## 一、钉钉功能移除过程

### 背景
v1.5.0 版本开发的钉钉私信发送功能，经过多轮技术调研后确认不可行：
- `im.dingtalk.com` 已被钉钉服务端重定向至维护页（服务器端封锁，非浏览器问题）
- `web.dingtalk.com` 在该环境网络不通（ERR_NETWORK_CHANGED）
- headless Playwright 方案、真实 Chrome headless/headed 均无法绕过服务端重定向
- 桌面客户端 PowerShell 自动化方案需要抢占屏幕，与用户期望的「无感后台发送」不符
- DingTalk 开放平台企业机器人 API 需要管理员权限，当前无法获取

### 决策
用户确认：**完全移除钉钉相关功能，发送按钮一并移除**。

### 清除内容

**后端删除文件**：
- `backend/src/routes/dingtalk.js`
- `backend/src/services/DingtalkService.js`
- `backend/src/config/dingtalk-selectors.js`
- `backend/src/config/dingtalk-login-page.png`
- `backend/src/scripts/dingtalk-send.ps1`

**后端修改**：
- `backend/src/app.js`：移除 `/api/dingtalk` 路由注册及日志输出

**前端修改**：
- `frontend/src/views/TaskDetail.vue`：
  - 移除钉钉状态检测相关 state（`dtLoggedIn`、`dtSessionAge`）
  - 移除 `fetchDtStatus()`、`sendLink()` 函数
  - 移除 `onUnmounted` 中的 `stopDtPoll()` 调用
  - 移除模板中钉钉状态指示器、扫码弹窗
  - 操作列「发送」按钮移除，宽度由 220px 缩减至 160px
  - 「生成链接」按钮区简化（去除 position:relative 包裹）

---

## 二、新需求调研过程

### 用户提出的需求（原始）

1. **任务收集操作列新增「设置为首选收集项」**，全局唯一，含切换确认弹窗
2. **团队人员改为列表展示**
3. **链接从任务维度改为系统级**（每人唯一永久链接），移除链接管理 Tab
4. **填写页变更**：默认展示首选任务；历史编辑功能（回显+提交+返回按钮）

### 调研结论

基于现有数据库模型（`fill_links`、`staff`、`collection_tasks`、`work_records`）分析：
- 技术可行性高，无底层障碍
- 核心风险：`fill_links` → `staff_fill_links` 数据迁移
- 主要工作量：fill 接口 token 解析逻辑重写，FillPage 历史编辑流程新增

### 用户确认的 5 个逻辑问题

| # | 问题 | 确认 |
|---|------|------|
| Q1 | 无首选任务时右栏历史是否保留 | 保留，历史编辑功能完整可用 |
| Q2 | 首选任务是否限 active | 是，仅 active 任务可设为首选 |
| Q3 | 历史编辑回显数据来源 | 已提交的 work_records |
| Q4 | 链接管理 Tab 移除时机 | 数据迁移后一并移除 |
| Q5 | 人员列表链接操作 | 打开链接 + 复制链接 + 复制带标题链接 + 预设文本框 |

### 补充确认内容

**预设文本框**：
- 默认内容：`请填写上周工作内容，您的专属链接如下：`
- 每人独立可修改

**复制带标题链接格式**：
```
{姓名}同学{预设文本框内容}\n{链接URL}
```

**历史编辑模式新增「返回」按钮**：
- 按钮文字：`← 返回最新工时收集`
- 显示条件：处于历史编辑模式 AND 系统存在首选任务
- 功能：退出历史编辑，恢复首选任务的填写界面

---

## 三、产出文档

| 文档 | 路径 | 状态 |
|------|------|------|
| 需求文档 | `docs/demand/REQ-preferred-link-refactor.md` | ✅ v1.1 已确认 |
| 开发文档 | `docs/development/DEV-preferred-link-refactor.md` | ✅ v1.1 已确认 |
| 开发计划 | `docs/@plan/PLAN-preferred-link-refactor.md` | ✅ v1.1 已确认 |

---

## 四、待办事项

- [ ] 用户确认文档后，启动阶段1（DB + 模型变更）开发
- [ ] 阶段2（首选收集项）可优先独立交付
- [ ] 正式开发前需备份现有 `fill_links` 表数据
