# 周期统计页回到顶部功能记录
日期：2026-06-28

## 触发需求

用户要求在“周期统计（季度）”页面增加回到顶部功能。

## 需求归档

- 已在 `docs/@demand/requirements.md` 新增 `REQ-041`。
- `REQ-041` 约束周期统计页在向下滚动后展示固定回顶按钮，点击后回到顶部且不影响页面布局。

## 涉及文件

- `frontend/src/views/StatsPage.vue`
- `docs/@demand/requirements.md`

## 实现内容

- 在 `StatsPage.vue` 中增加 `showBackTop` 滚动状态。
- 页面滚动超过 320px 后显示右下角固定回顶按钮。
- 回顶按钮通过 `Teleport` 挂载到 `body`，脱离统计页内容流，避免被长页面内容或组件定位环境带偏。
- 点击按钮后执行窗口回顶，并同时校正 `documentElement` 与 `body` 的滚动位置。
- 回到顶部后按钮自动隐藏。

## 验证记录

- `npm run build`（frontend）：通过。
- `git diff --check`：通过，仅有仓库既有 CRLF 提示。
- 浏览器验证：
  - 初始顶部 `scrollY=0` 时按钮隐藏。
  - 向下滚动至 `scrollY=1600` 后按钮显示，定位为 `fixed`，尺寸 40x40，位于视口右下角。
  - 点击按钮后 `scrollY=0`，按钮隐藏。
  - 页面横向宽度未被影响，`scrollWidth` 与 `clientWidth` 一致。
