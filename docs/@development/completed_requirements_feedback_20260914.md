# 已完成需求四轮反哺与问题修复归档

## 变更日期

2026-09-14（Asia/Shanghai）

## 范围

针对已完成的 AI 产品经理工时、需求方均摊、综合进度、历史进度、产品经理图表、分页以及值班/自动通知相关需求，执行四轮需求反哺、探索测试、缺陷修复和全量回归。本次不访问生产数据、不做生产发布。

## 修复内容

- 前后端统一进度归一化，空值、空白、布尔值、越界值不再被误算为 0。
- 产品经理图表和筛选使用稳定人员 ID，解决同名人员合并问题。
- 子通知测试夹具增加调度精度和子任务时间重基准，避免慢测试导致周周期滚动到下一次。
- 保持 webhook 生产安全校验不变；共享本地应用调度器时使用隔离夹具执行子通知测试。

## 涉及文件

- `frontend/src/utils/progress.js`
- `frontend/src/views/StatsPage.vue`
- `backend/src/routes/stats.js`
- `backend/scripts/verify_child_notifications_and_duty_switch.js`
- `backend/tests/completed_requirements_feedback.mjs`
- `docs/@test/completed_requirements_feedback_20260914/`

## 验证结论

- 四轮全量 runner：18/18 PASS。
- 子通知隔离回归：PASS。
- 前端生产构建：PASS。
- 本地 `3001` API、`5176` 页面：HTTP 200。
- 生产环境：未访问、未修改、未发布。
