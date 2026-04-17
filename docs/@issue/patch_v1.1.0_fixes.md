# DevTracker v1.1.0 补丁记录

> 日期：2026-04-16  
> 范围：6 项修复 + 功能增强

## 修复清单

| # | 问题 | 修复方案 | 影响文件 |
|:---:|:---|:---|:---|
| 1 | REQ-17 TaskDetail 未显示实时状态 | 添加 5s 轮询 + activity 标签 | `TaskDetail.vue` |
| 2 | 识别并填入不准确 | 重写解析引擎：支持分隔符/任意位置PM/工时单位 | `FillPage.vue` |
| 3 | 权限控制未生效 | 创建 auth store + 路由守卫 + AppHeader 权限过滤 | `auth.js`, `router/index.js`, `AppHeader.vue` |
| 4 | 图表空值/冒号/柱宽 | 空值显示0 + 英文冒号 + 柱宽40px | `StatsPage.vue` |
| 5 | 卡片缺周期名称 | 3 张卡片标签加 filterLabel 前缀 | `StatsPage.vue` |
| 6 | 合计行未加粗 | getSummary 返回 VNode 带颜色加粗 | `ReportPage.vue` |

## 新增文件

| 文件 | 说明 |
|:---|:---|
| `stores/auth.js` | 全局权限状态管理，URL token 初始化 |

## 修改文件

| 文件 | 改动说明 |
|:---|:---|
| `StatsPage.vue` | 图表柱宽 30→40px，空值显示0，英文冒号，卡片加周期前缀 |
| `ReportPage.vue` | 合计行用 h() VNode 渲染加粗彩色数值，"合计"16px加粗 |
| `FillPage.vue` | 解析引擎重写：分隔符检测、任意位置PM/版本匹配 |
| `TaskDetail.vue` | REQ-17 补完：5s 轮询 activity API 显示编辑/提交状态 |
| `router/index.js` | 添加权限守卫 beforeEach，403 页面，资源映射表 |
| `AppHeader.vue` | 导入 auth store，按权限过滤导航/按钮 |
| `main.css` | 全局 activity tag 样式 + 呼吸动画 |

## 技术决策

1. **权限实施**：采用 URL `?token=xxx` 方式传递权限凭证，无 token 为管理员模式
2. **合计行渲染**：Element Plus `show-summary` 的 `summary-method` 支持返回 VNode，利用 `h()` 函数实现自定义样式
3. **解析引擎**：双模式解析 — 分隔符模式（|/\t）和自然语言模式，优先使用分隔符精确解析

## 验证结果

- ✅ 周期统计图表：英文冒号、空值显示0、柱宽加大
- ✅ 周期统计卡片：全部 7 张卡片带周期前缀
- ✅ 需求工时统计合计行：数值加粗带色、"合计"加大加粗
- ✅ 识别引擎：成功解析 "V5.0.0 Test Requirement 10h"
- ✅ 权限控制：管理员模式正常、路由守卫就绪
- ✅ TaskDetail 活动状态：轮询逻辑已实装
- ✅ 零 JS 错误
