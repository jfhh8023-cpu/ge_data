# 钉钉 webhook 本地发送兼容性修复记录

## 基本信息

- 日期：2026-09-02。
- 状态：`APPROVED_FOR_PRODUCTION_RELEASE`。
- 触发问题：同一 webhook 使用独立 HTTP 客户端推送成功，但录入 DevTracker 后测试推送失败。
- 实施边界：本地开发与验证已完成；2026-09-02 用户明确授权推送远端并发布生产。

## 诊断结论

1. 可用连接使用基础文本消息直连钉钉时返回 `errcode=0`。
2. 经 DevTracker 本地 `/api/settings/auto-tasks/test-notify` 使用系统 markdown 格式发送时，在到达钉钉前失败，错误为 `Invalid IP address: undefined`。
3. 本地 Node.js 为 v25.2.1；其 HTTPS 连接会以 `all: true` 请求自定义 DNS lookup 返回地址数组，原实现始终按单地址回调，导致地址结构不兼容。
4. 本地已保存配置中，自动任务创建规则只引用当前停用的连接；自动值班规则同时引用停用连接与可用连接。批量发送采用“任一目标失败则整次显示失败”的既有语义。
5. 两个已保存 URL 的协议、域名、路径、查询参数名和 token 长度均正确，未混入 Markdown 包装字符。

## 修复范围

- 自定义公网 DNS lookup 根据调用方的 `all` 参数返回地址数组或单地址。
- 继续过滤私网、环回和无效地址，保留 webhook SSRF 防护边界。
- 尊重调用方指定的 IPv4/IPv6 family 与 DNS hints。
- 新增无外部发送的专项脚本，覆盖单地址、地址数组及仅解析到私网地址三种情况。
- 该修复位于唯一的公共出站链路中，适用于每一个合法 webhook URL，而非按 token、规则或通知类型做特判。
- 新增全入口隔离验证，覆盖主通知、值班通知、子通知、特殊日期通知、旧版字符串、多连接和部分失败。

## 数据与安全边界

- 不在文档、日志或测试输出中记录完整 webhook token。
- 不修改用户已保存的 webhook 配置。
- 不修改业务数据或数据库结构。
- 系统真实格式验证仅对已确认可用的连接发送一条明确标注的测试消息。

## 验证结果

- `node --check src/services/AutoTaskService.js`：PASS。
- `node scripts/verify_webhook_dns_lookup_20260902.js`：PASS，覆盖单地址、多地址和仅私网地址拒绝。
- `node scripts/verify_all_dingtalk_webhook_links_20260902.js`：PASS，共捕获 9 次隔离 HTTP 请求，覆盖主通知多连接、旧版字符串、JSON 配置、值班通知、子通知、特殊通知、部分失败和官方域名白名单。
- 修复前通过系统测试接口发送可用连接：HTTP 400，`Invalid IP address: undefined`。
- 修复后通过同一系统接口、同一可用连接和实际 markdown 卡片格式发送：HTTP 200，`code=0`，`success=1`。
- `node scripts/verify_auto_retry_and_calendar_indicators.js`：PASS；任务幂等、三次重试上限、值班通知、子通知和特殊通知回归通过。
- `node scripts/verify_child_notifications_and_duty_switch.js`：隔离本地调度器后 PASS；子通知激活、发送去重、失败恢复及固定/轮换模式切换通过。首次与正在运行的本地调度器竞争而失败，停止调度器后复测证明与功能改动无关。
- `node scripts/verify_duty_calendar_system_integration.js`：PASS，15 项日历、排班、通知及清理验证通过。
- 本地 `/api/health`：PASS。
- `git diff --check`：PASS。
- 验证仅发送一条标注为系统链路修复验证的消息；未对停用连接重复发送。

## 变更文件

- `backend/src/services/AutoTaskService.js`
- `backend/scripts/verify_webhook_dns_lookup_20260902.js`
- `backend/scripts/verify_all_dingtalk_webhook_links_20260902.js`
- `docs/@demand/requirements.md`
- `docs/@development/dingtalk_webhook_local_dns_compatibility_20260902.md`

## 后续操作

- 当前修改已获远端推送和生产发布授权，发布结果将在独立生产发布记录中归档。
- 用户需在页面中删除/替换停用连接，或只保留已验证可用的连接；否则多目标发送仍会按既有规则显示整体失败。
