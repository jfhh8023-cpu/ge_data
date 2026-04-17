# DevTracker — 开发人员工时统计系统

> 东方极简 SaaS · 轻量化工时采集与多维统计

## 快速开始

```bash
# 在项目根目录启动 HTTP 服务（需要 Python 或其他 HTTP 服务器）
cd get_data
python -m http.server 8080

# 打开浏览器访问
http://127.0.0.1:8080/index.html
```

## 当前版本

- **v0.4.0 Demo**（开发阶段，使用 localStorage 存储）
- 验证设计系统和交互逻辑，确认后将迁移至 Vue3 + TypeScript + Backend

## 核心功能

| 模块 | 功能 |
|:---|:---|
| 全部任务 | 按季度分组、最新高亮、查看按钮 |
| 任务详情 | 提交数据（内联编辑）+ 链接管理（发送/复制）+ 汇总报表 |
| 汇总报表 | 独立页签、多维排序、可编辑备注、分页、列合计 |
| 统计大盘 | 部门全观（Canvas 柱状图）+ 个人聚焦 |
| 填写页 | 一键识别引擎（PM 匹配 + 工时解析 + 符号清洗） |
| 团队人员 | 人员增删管理 |

## 文档目录

| 目录 | 说明 |
|:---|:---|
| `docs/@demand/` | 需求文档 |
| `docs/@plan/` | 实施计划 |
| `docs/@development/` | 开发过程记录 |
| `docs/@architecture/` | 架构设计（待补充） |

## 技术栈

- HTML5 + CSS3 + Vanilla JavaScript
- Canvas 2D API（零依赖图表）
- localStorage（Demo 阶段）
- 设计参考：ByteDance Semi Design
