# 填写页一键识别 PM_OPTIONS 报错修复 — 2026-06-22

## 问题现象

填写工时页点击「一键识别并填入」时，浏览器控制台报错：

```text
ReferenceError: PM_OPTIONS is not defined
```

报错位置在 `frontend/src/views/FillPage.vue` 的 `matchPM()` 兜底匹配逻辑。

## 根因

此前产品经理选项已经从前端硬编码常量迁移为动态接口数据：

- `GET /api/pm`
- `pmOptions.value`

但一键识别的兜底匹配逻辑仍残留旧变量 `PM_OPTIONS`。当文本中没有完整命中当前 PM 名称时，逻辑进入兜底分支并引用不存在的 `PM_OPTIONS`，导致运行时报错。

## 影响范围

| 功能 | 是否受影响 | 说明 |
|---|---:|---|
| 填写页一键识别 | 是 | 文本未完整命中 PM 名称时触发 |
| 手动填写工时 | 否 | 不经过 `matchPM()` 兜底错误分支 |
| 产品经理下拉选择 | 否 | 仍使用 `pmOptions.value` |
| 暂存草稿/提交工时 | 否 | 后端接口和数据写入不受影响 |
| 历史任务编辑 | 否 | 数据读取/保存不受影响 |
| Excel 导入导出 | 否 | 独立逻辑 |
| 汇总报表/周期统计/PM 专属页 | 否 | 不引用填写页一键识别逻辑 |

## 修复方案

在 `matchPM()` 内统一使用动态 PM 列表：

- 新增局部变量 `availablePms = Array.isArray(pmOptions.value) ? pmOptions.value.filter(Boolean) : []`
- 完整名称匹配和兜底字符匹配都遍历 `availablePms`
- 当 PM 接口异常或列表为空时，一键识别仍可识别版本、标题、工时，不再因 PM 兜底逻辑崩溃

## 涉及文件

| 文件 | 改动 |
|---|---|
| `frontend/src/views/FillPage.vue` | 移除 `PM_OPTIONS` 残留引用，改用动态 `pmOptions.value` |

## 验证清单

| 验证项 | 结果 |
|---|---|
| `rg PM_OPTIONS frontend/src` | 通过；当前前端源码无残留旧变量 |
| `npm run build` | 通过，仅保留既有 chunk size warning |
| 生产数据库备份 | 已完成：`deploy/backups/20260622_100313/devtracker_20260622_100313.sql`，约 1005.7 KB |
| 生产健康接口 | `https://jfzhu8023.cloud/devtracker/api/health` 返回 `200` |
| 生产填写页 | `https://jfzhu8023.cloud/devtracker/fill/b8b9a606_f30516caea94` 返回 `200` |
| 完整 PM 名识别 | 通过：`V9.900.0 完整PM识别测试 杨瑞 1h`，成功识别，无 `PM_OPTIONS` 错误 |
| 简称/单字兜底识别 | 通过：`V9.900.1 单字PM识别测试 瑞 1h`，成功识别，无 `PM_OPTIONS` 错误 |
| 无 PM 名文本识别 | 通过：`V9.900.2 无关联需求识别测试 1h`，成功识别，无 `PM_OPTIONS` 错误 |
| Playwright 页面错误监听 | `pageErrors=[]`、`consoleErrors=[]` |
| 页面验证截图 | `docs/@issue/fill_recognize_pm_fix_20260622.png` |
| 生产数据 API 核对 | `collection_tasks=22`、`staff=10`、`product_managers=11`、`task_record_count_sum=541` |

## 规约回溯

[回溯✅] 第1次回溯，当前修复遵守 `conventions.md` 铁律 16/17：先定位根因，最小影响范围修改，并准备逐项验证一键识别、手动填写、提交链路不受影响。
