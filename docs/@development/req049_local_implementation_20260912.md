# REQ-049 本地实现与验证记录

日期：2026-09-12  
范围：仅本地开发环境；未推送远端，未发布生产。  
确认依据：用户确认研发归属人图与产品需求方图分离、需求方多选默认均分且可调整、产品页签显示人员姓名。

## 已修改

- `backend/src/models/ProductManagerWorkRecord.js`：新增 `demand_source_weights` JSON 字段。
- `backend/src/app.js`：本地启动时安全补齐产品工时表权重列。
- `backend/src/routes/fill.js`：保存产品工时时生成默认均分权重，支持自定义权重并规范化保存。
- `backend/src/routes/stats.js`：生成产品需求方均摊分布；研发 PM 归属人分布继续排除 AI产品经理独立工时；返回产品记录权重和交付进度。
- `frontend/src/views/FillPage.vue`：历史记录显示交付进度，有值显示百分比、空值显示 `-`；产品填报增加需求方权重分配弹窗和均分操作。
- `frontend/src/stores/stats.js`：接收 `productDemandDistribution`。
- `frontend/src/views/StatsPage.vue`：
  - 研发主图不显示 AI产品经理系列；
  - 部门全观增加按需求方的 AI 产品经理补充图；
  - AI产品经理工时页签增加卡片、需求方图、可筛选明细表；
  - 增加 AI研发人员工时页签；
  - 产品页签显示人员姓名、需求方、进度和来源。

## 验证结果

1. `node --check backend/src/routes/fill.js`：通过。
2. `node --check backend/src/routes/stats.js`：通过。
3. `node --check backend/src/app.js`：通过。
4. `npm run build`：通过；仅保留既有大 chunk 提示。
5. `GET /api/stats?year=2026&quarter=Q3`：返回 `productDemandDistribution`；本地样本为内部需求 10h、客户需求 25h、对外服务 0h、其他需求 0h；产品记录带 `demand_source_weights`。
6. Playwright 统计页验证通过：目标页签包含部门全观、AI产品经理工时、AI研发人员工时；产品页签包含产品图表和明细；研发页签包含研发明细。
7. Playwright 填写页验证通过：历史记录渲染 2 个进度节点。

## 未完成/风险

- 当前未使用产品专属测试链接完成“权重弹窗实际点击并提交”浏览器用例，需要后续准备临时本地 AI产品经理链接后补测。
- 产品来源静态工时分析 HTML 和全量导出适配仍属于 REQ-048 遗留范围，不在本次页面改动中伪装为完成。
- 未执行远端推送和生产发布。

## 2026-09-12 增量：统计页签最终命名

- `frontend/src/views/StatsPage.vue`：按确认顺序展示并重命名为“部门展示、AI研发展示、AI产品展示、研发聚焦、产品经理聚焦”。“AI产品展示”绑定原 AI产品经理工时数据，“AI研发展示”绑定原 AI研发人员工时数据。

## 2026-09-12 增量：REQ-049-UI-01

### 本地修改

- `frontend/src/views/StatsPage.vue`：产品页顶部改为五项汇总卡片，需求方维度保留在柱状图；增加产品指标与需求方的稳定颜色；通过统计页签导航样式将 AI研发人员工时置于 AI产品经理工时左侧。
- `frontend/src/views/StatsPage.vue`：产品明细增加新增/工时降序/工时升序和分组金银铜；研发明细补齐同口径排序、合并单元格、交付进度和金银铜展示；研发页补充需求数、任务数卡片。
- `docs/@demand/requirements.md`、`docs/@plan/ai_pm_stats_source_separation_20260912.md`：归档本次页面口径和验收计划。

### 待验证

- 需要浏览器确认主页签显示顺序、产品页五张卡片、需求方图颜色、两张明细表排序和奖牌。
- 未执行远端推送和生产发布。
