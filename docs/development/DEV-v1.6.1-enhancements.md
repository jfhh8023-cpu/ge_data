# 开发文档 v1.6.1 — 交互增强 & 人员交接

> 版本：v1.0 | 日期：2026-04-17

---

## REQ-01 后端：POST /api/tasks 自动首选

```js
// tasks.js — POST /
const task = await CollectionTask.create({ ..., is_preferred: true, status: 'active' });
// 关闭旧首选
await CollectionTask.update(
  { is_preferred: false, status: 'closed' },
  { where: { is_preferred: true, id: { [Op.ne]: task.id } } }
);
```

---

## REQ-02 前端：FillPage 布局

### 提示条（卡片外，v-if editingHistoryTask）
```html
<div class="fill-edit-banner">
  <span>【编辑历史数据】{{ editingHistoryTask.title }}</span>
  <el-button v-if="hasPreferredTask" @click="returnToPreferred">← 返回最新工时收集</el-button>
</div>
<div class="fill-card">...</div>  <!-- 标题区不再显示编辑标记 -->
```

### 历史面板每个任务底部固定行
```html
<div class="fill-history-task-footer">
  <span>{{ totalHours }}H</span>
  <span class="status-tag">收集中/已停止</span>
  <el-button link @click.stop="loadHistoryForEdit(task)">编辑</el-button>
</div>
```

---

## REQ-03 前端：PersonnelPage 样式

- 链接列：`word-break: break-all; white-space: normal; font-size:12px`
- 操作列：`min-width:240px; white-space:nowrap`，按钮 `font-size:14px; font-weight:700`
- 按钮文本：「打开」「复制」「复制带标题」

---

## REQ-04 后端 + 前端：数据交接

### 新接口
```
GET  /api/staff/:id/records-summary
  → { data: { staff, tasks: [{ id, title, recordCount, totalHours }] } }

POST /api/staff/:id/transfer
  body: { to_staff_id }
  → 更新 work_records.staff_id = to_staff_id where staff_id = :id
```

### 删除拦截
```js
// DELETE /api/staff/:id
const count = await WorkRecord.count({ where: { staff_id: req.params.id } });
if (count > 0) {
  return res.status(400).json({ code: 1, message: `该人员有 ${count} 条工时记录，请先通过"交接"功能完成数据迁移` });
}
```

### 前端弹窗
- 「交接」按钮（所有人员均显示）
- 弹窗：被交接人信息 + 任务汇总表 + 「交接给」下拉
- 提交：POST /api/staff/:id/transfer → 成功后 ElMessage.success + 刷新列表
