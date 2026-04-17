# DevTracker v0.5.0 — 开发计划

> **版本**：v0.5.0 | **日期**：2026-04-15  
> **文档编号**：D03 | **性质**：唯一开发计划文档

---

## 一、功能完善清单（GAP 修复）

以下功能在 v0.4.0 中已渲染 UI 但未绑定交互逻辑，需在 v0.5.0 中完善：

| 编号 | 功能模块 | 涉及文件 | 优先级 |
|:---|:---|:---|:---:|
| GAP-01 | 提交数据 - 内联编辑 | `js/core.js` | P0 |
| GAP-02 | 提交数据 - 记录删除 | `js/core.js` | P0 |
| GAP-03 | 填写页 - 自定义多选下拉 | `js/core.js` + `css/main.css` | P1 |
| GAP-04 | 汇总报表 - 排序切换 | `js/core.js` | P0 |
| GAP-05 | 汇总报表 - 手动添加行 | `js/core.js` | P1 |
| GAP-06 | 汇总报表 - 真实分页 | `js/core.js` | P1 |
| GAP-07 | 周期统计 - 筛选器联动 | `js/core.js` | P1 |
| GAP-08 | 团队人员 - 编辑/删除 | `js/core.js` | P0 |

---

## 二、执行顺序

### Phase 1: 文档融合与清理 ✅

- [x] 需求文档合并至 v0.5.0
- [x] 新建本开发计划
- [ ] 删除 6 份冗余文档

### Phase 2: P0 功能修复

- [ ] GAP-01: 内联编辑（编辑→input→保存→Store更新）
- [ ] GAP-02: 记录删除（确认→Store移除→重渲染）
- [ ] GAP-04: 报表排序切换（PM/前端/后端/测试四种排序）
- [ ] GAP-08: 人员编辑弹窗 + 删除确认

### Phase 3: P1 功能完善

- [ ] GAP-03: 自定义多选下拉组件（checkbox面板 + Tag展示）
- [ ] GAP-05: 报表手动添加行（空白行添加 + 实时统计）
- [ ] GAP-06: 真实分页（currentPage状态 + 翻页逻辑）
- [ ] GAP-07: 统计筛选器联动（年度→季度→周期三级）

### Phase 4: 浏览器验证

- [ ] 启动 HTTP Server
- [ ] 逐页验证全部功能
- [ ] 确认 Demo 完整性

---

## 三、代码结构

```
get_data/
├── index.html              # 页面入口
├── css/
│   └── main.css            # 全局样式（CSS Variables 设计系统）
├── js/
│   └── core.js             # 核心逻辑（路由/视图/引擎/图表）
└── docs/                   # 文档目录
    ├── @demand/
    │   └── requirements.md         # v0.5.0 唯一需求基准
    ├── @architecture/
    │   └── conventions.md          # v1.0 项目规约
    └── @plan/
        └── development_plan_v0.5.0.md  # 本文件
```

---

## 四、正式版迁移计划（v1.0.0 预览）

> Demo 验收通过后执行：

```mermaid
flowchart LR
    A[Demo 验收] --> B[后端 API + MySQL]
    B --> C[前端迁移 Vue 3]
    C --> D[集成联调]
    D --> E[系统测试]
    E --> F[v1.0.0 发布]
```

| 层级 | 技术选型 |
|:---|:---|
| 前端 | Vue 3 + TypeScript + Vite + Element Plus |
| 后端 | Node.js + Express / Java + Spring Boot |
| 数据库 | MySQL |
| 部署 | Docker + Nginx |
