# v3.5.2 生产发布记录（填写链接 http 打开报"链接无效"）

状态：`RELEASED_AND_VERIFIED`。时间见 `docs/@test/production_release_20260929/deployment-result.json`。

## 根因

- 团队人员页链接为 `http://jfzhu8023.cloud/devtracker/fill/<token>`（非 HTTPS）。
- v3.5.0 起填写页 `createEmptyRow / normalizeRows` 用 `crypto.randomUUID()` 生成 `draft_row_id`；该 API 仅在安全上下文（HTTPS / localhost）存在，http 下为 `undefined` 抛 TypeError，被 `onMounted` 的 catch-all 显示为"链接无效或已过期"。后端 `/api/fill/:token` 全部 200，token 从未变化。
- 复现：Playwright 以 http 打开生产 → 失败；同 token 以 https 打开 → 正常；本地以 `http://172.28.32.1:5174`（isSecureContext=false）验证修复后正常。

## 变更

- `frontend/src/utils/uuid.js`：`randomUUID()`，原生可用时直接调用，否则 `getRandomValues` 生成 UUID v4。
- `frontend/src/views/FillPage.vue`：改用该助手；初始化失败时 `console.error` 输出真实错误。
- 版本 3.5.1 → 3.5.2，提交 `0b6c0ba`。后端无改动，链接与 token 不变。

## 发布与验证

- 备份 `/opt/devtracker/.release-backups/20260929_100337`（本机 `deploy/backups/release_20260929_100337`）。
- health 3.5.2、PM2 online、公网 200、表行数不变。
- 生产以 **http** 逐个打开 17 条填写链接：**17/17 正常渲染**（isSecureContext=false）。
