# 开发文档 — 首选收集项 & 系统级链接重构

**版本**: v1.1 已确认  
**日期**: 2026-04-17  
**依赖需求**: REQ-preferred-link-refactor.md v1.1

---

## 一、数据库变更

### 1.1 `collection_tasks` 表 — 新增字段

```sql
ALTER TABLE collection_tasks
  ADD COLUMN is_preferred TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '是否为首选收集项；仅 active 任务允许设置为 1；全局唯一 true';
```

**约束**：应用层保证唯一性（不用 DB UNIQUE，因为允许全部为 false）。

---

### 1.2 新建 `staff_fill_links` 表

```sql
CREATE TABLE staff_fill_links (
  id         CHAR(36)      NOT NULL PRIMARY KEY,
  staff_id   CHAR(36)      NOT NULL UNIQUE COMMENT '人员ID，全局唯一',
  token      VARCHAR(100)  NOT NULL UNIQUE COMMENT '系统级永久 token',
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sfl_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**数据迁移 SQL**（取各 staff 最新 fill_link token）：

```sql
-- Step 1：迁移有历史链接的人员
INSERT INTO staff_fill_links (id, staff_id, token, created_at)
SELECT UUID(), fl.staff_id, fl.token, fl.created_at
FROM fill_links fl
INNER JOIN (
  SELECT staff_id, MAX(created_at) AS max_at
  FROM fill_links GROUP BY staff_id
) latest ON fl.staff_id = latest.staff_id AND fl.created_at = latest.max_at
GROUP BY fl.staff_id;

-- Step 2：为无历史 fill_link 的 active staff 自动生成 token
INSERT INTO staff_fill_links (id, staff_id, token)
SELECT UUID(), s.id, CONCAT(HEX(RANDOM_BYTES(8)), '_', s.id)
FROM staff s
WHERE s.is_active = 1
  AND NOT EXISTS (
    SELECT 1 FROM staff_fill_links sfl WHERE sfl.staff_id = s.id
  );
```

---

### 1.3 `work_records` 表 — 无变更

`work_records` 保留 `task_id + staff_id`，是核心事实表，不做结构变更。

---

## 二、后端接口变更

### 2.1 Task 接口 — 新增 preferred

#### `PATCH /api/tasks/:id/preferred`

**限制**：目标任务 status 必须为 `active`，否则返回 400。

**请求体**：
```json
{ "preferred": true }
```

**逻辑**：
```
preferred = true：
  1. 校验任务 status === 'active'，否则 400
  2. UPDATE collection_tasks SET is_preferred = 0（全部清除）
  3. UPDATE collection_tasks SET is_preferred = 1 WHERE id = :id
  4. 返回更新后任务对象

preferred = false：
  1. UPDATE collection_tasks SET is_preferred = 0 WHERE id = :id
  2. 返回更新后任务对象
```

**响应**：`{ code: 0, data: { task } }`

---

#### `GET /api/tasks` 接口
现有响应自动携带 `is_preferred`（Sequelize 模型新增字段后自动包含）。

---

### 2.2 Staff 接口变更

#### `GET /api/staff`
LEFT JOIN `staff_fill_links` 追加 `fillToken` 字段：

```json
{
  "id": "...",
  "name": "朱俊锋",
  "role": "frontend",
  "is_active": true,
  "fillToken": "abc123_uuid",
  "fillUrl": "http://localhost:5173/fill/abc123_uuid"
}
```

#### `POST /api/staff/ensure-links`（管理接口，幂等）
为所有 `is_active = true` 且无 `staff_fill_links` 记录的人员批量生成 token。

---

### 2.3 Fill 接口变更（`routes/fill.js`）

#### `GET /fill/:token` — 逻辑重写

**新流程**：
```
1. token → staff_fill_links → staff_id（找不到则 404）
2. SELECT * FROM collection_tasks WHERE is_preferred = 1 LIMIT 1
   ├── 存在 → 加载该任务 + 该 staff 的 work_records（当前提交记录）
   │           返回 { staff, task, records, noPreferredTask: false }
   └── 不存在 → 返回 { staff, task: null, records: [], noPreferredTask: true }
        （前端据此展示「暂无开放中的收集任务」提示，右栏历史正常加载）
```

**响应格式**：
```json
{
  "staff": { "id": "...", "name": "...", "role": "..." },
  "task": { "id": "...", "title": "...", "status": "active", ... },
  "records": [...],
  "noPreferredTask": false
}
```

---

#### `POST /fill/:token/submit` — 增加 task_id + status 校验

**请求体变更**（新增 `task_id`）：
```json
{
  "task_id": "xxx",
  "records": [...]
}
```

**新增校验**：
```
1. token → staff_id
2. task_id → 查询任务 status
   └── status !== 'active' → 返回 { code: 5, message: '该任务已停止收集，无法修改' }
3. 原有提交逻辑（upsert work_records）
```

---

#### `GET /fill/:token/history` — 基本不变
`token → staff_id → work_records JOIN collection_tasks`，无需变更。

---

#### 新增：`GET /fill/:token/task/:taskId/records`
历史编辑回显接口。

**逻辑**：
```
token → staff_id
SELECT * FROM work_records WHERE task_id = :taskId AND staff_id = :staffId AND is_active = true
ORDER BY created_at ASC
```

**响应**：
```json
{
  "task": { "id": "...", "title": "...", "status": "active/closed" },
  "records": [
    { "requirement_title": "...", "version": "...", "product_managers": [...], "hours": 8 },
    ...
  ]
}
```

---

## 三、前端变更

### 3.1 TaskList.vue — 首选收集项按钮

**新增 computed**：
```javascript
const preferredTask = computed(() =>
  taskStore.list.find(t => t.is_preferred) ?? null
)
```

**操作列新增按钮**（仅 `row.status === 'active'` 时显示）：
```vue
<el-button
  v-if="row.status === 'active'"
  type="text" size="small"
  @click="handlePreferred(row)"
>
  {{ row.is_preferred ? '取消收集首选' : '设置为首选收集项' }}
</el-button>
```

**handlePreferred 逻辑**：
```javascript
async function handlePreferred(task) {
  if (task.is_preferred) {
    await api.patch(`/tasks/${task.id}/preferred`, { preferred: false })
    await taskStore.fetchAll()
    return
  }
  if (preferredTask.value) {
    await ElMessageBox.confirm(
      `《${preferredTask.value.title}》已开启收集首选，是否切换为当前任务《${task.title}》作为首选收集项？`,
      '切换首选收集项', { type: 'warning', confirmButtonText: '确认切换', cancelButtonText: '取消' }
    )
  }
  await api.patch(`/tasks/${task.id}/preferred`, { preferred: true })
  await taskStore.fetchAll()
}
```

---

### 3.2 PersonnelPage.vue — 列表 + 链接操作区完整实现

**布局**：`el-table`，列：姓名 | 角色 | 状态 | 链接操作区

**链接操作区模板**（每行）：
```vue
<template #default="{ row }">
  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
    <!-- 预设文本框 -->
    <el-input
      v-model="notifyTexts[row.id]"
      size="small"
      style="width:220px;"
      :placeholder="DEFAULT_NOTIFY_TEXT"
    />
    <!-- 打开链接 -->
    <el-button size="small" type="primary" link
      @click="openFillLink(row)">打开链接</el-button>
    <!-- 复制链接 -->
    <el-button size="small" link
      @click="copyLink(row)">复制链接</el-button>
    <!-- 复制带标题的链接 -->
    <el-button size="small" link
      @click="copyWithTitle(row)">复制带标题</el-button>
  </div>
</template>
```

**JS 逻辑**：
```javascript
const DEFAULT_NOTIFY_TEXT = '请填写上周工作内容，您的专属链接如下：'
// 每人独立的预设文本，key 为 staff.id
const notifyTexts = reactive({})

function openFillLink(staff) {
  window.open(staff.fillUrl, '_blank')
}

function copyLink(staff) {
  navigator.clipboard.writeText(staff.fillUrl)
  ElMessage.success('链接已复制')
}

function copyWithTitle(staff) {
  const text = notifyTexts[staff.id] ?? DEFAULT_NOTIFY_TEXT
  const content = `${staff.name}同学${text}\n${staff.fillUrl}`
  navigator.clipboard.writeText(content)
  ElMessage.success('带标题的链接已复制')
}
```

---

### 3.3 TaskDetail.vue — 移除链接管理 Tab

迁移完成后执行：
- 移除 `<el-tab-pane label="链接管理">` 及其内部全部代码
- 移除 `links`、`sortedLinks`、`generatingLinks`、`generateLinks`、`copyLinkOnly`、`copyAll`、`buildFillUrl`、`notifyText` 等 state 和方法
- 移除相关 `import`

---

### 3.4 FillPage.vue — 完整改造

#### 新增 state
```javascript
const noPreferredTask = ref(false)       // 无首选任务
const isEditingHistory = ref(false)       // 是否处于历史编辑模式
const editingTask = ref(null)             // 当前编辑的历史任务对象
const preferredTask = ref(null)           // 首选任务（从接口获取）
```

#### 数据加载变更
```javascript
// GET /fill/:token 响应处理
const data = res.data
staff.value    = data.staff
preferredTask.value = data.task
noPreferredTask.value = data.noPreferredTask
task.value     = data.task   // 当前展示任务（默认首选）
records.value  = data.records
initRows()
```

#### 历史编辑流程
```javascript
async function startEditHistory(historyTask) {
  const res = await api.get(`/fill/${token}/task/${historyTask.id}/records`)
  const { task: t, records } = res.data
  editingTask.value = t
  task.value = t
  rows.value = records.length
    ? records.map(r => ({ ...r }))
    : [emptyRow()]
  isEditingHistory.value = true
}

function returnToPreferred() {
  isEditingHistory.value = false
  editingTask.value = null
  task.value = preferredTask.value
  initRows()   // 恢复首选任务数据
}
```

#### 提交逻辑
```javascript
async function handleSubmit() {
  const taskId = isEditingHistory.value ? editingTask.value.id : preferredTask.value.id
  const res = await api.post(`/fill/${token}/submit`, { task_id: taskId, records: validRows })
  if (res.code === 5) {
    ElMessage.warning('该任务已停止收集，无法修改')
    return
  }
  // 成功逻辑不变：broadcastDataChange + loadHistory + 重置
  if (isEditingHistory.value) {
    isEditingHistory.value = false
    editingTask.value = null
    task.value = preferredTask.value
    initRows()
  }
}
```

#### 模板关键变更

**左侧标题区**：
```vue
<!-- 编辑历史标记 -->
<span v-if="isEditingHistory" class="edit-history-badge">【编辑历史数据】</span>
{{ task?.title || '' }}

<!-- 返回首选任务按钮（编辑历史 + 有首选任务时显示） -->
<el-button
  v-if="isEditingHistory && preferredTask"
  size="small" type="info" link
  @click="returnToPreferred"
  style="margin-left:8px;"
>← 返回最新工时收集</el-button>
```

**无首选任务提示（左侧）**：
```vue
<div v-if="noPreferredTask && !isEditingHistory" class="no-preferred-tip">
  <el-empty description="暂无开放中的收集任务，请联系管理员" />
</div>
<template v-else-if="!noPreferredTask || isEditingHistory">
  <!-- 正常填写表单 -->
</template>
```

**右侧历史编辑按钮**：
```vue
<!-- 每个历史任务条目的状态标签右侧 -->
<el-button size="small" link @click="startEditHistory(histTask)">编辑</el-button>
```

**提交按钮文字**：
```vue
<el-button type="primary" @click="handleSubmit">
  {{ isEditingHistory ? '编辑完成' : '提交工时' }}
</el-button>
```

---

## 四、Sequelize 模型变更

### 4.1 新增 `StaffFillLink` 模型

```javascript
// models/StaffFillLink.js
module.exports = (sequelize, DataTypes) => {
  const StaffFillLink = sequelize.define('StaffFillLink', {
    id:       { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    staff_id: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
    token:    { type: DataTypes.STRING(100), allowNull: false, unique: true },
  }, { tableName: 'staff_fill_links', timestamps: true, underscored: true });

  StaffFillLink.associate = models => {
    StaffFillLink.belongsTo(models.Staff, { foreignKey: 'staff_id', as: 'staff' });
    models.Staff.hasOne(StaffFillLink, { foreignKey: 'staff_id', as: 'fillLink' });
  };
  return StaffFillLink;
};
```

### 4.2 `CollectionTask` 模型新增字段

```javascript
is_preferred: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
```

---

## 五、改动影响评估（更新版）

| 模块 | 改动程度 | 说明 |
|------|---------|------|
| collection_tasks 表 | 小 | 加 is_preferred 字段 |
| staff_fill_links 表 | 大 | 新建表 + 数据迁移脚本 |
| work_records 表 | 无 | 不变 |
| routes/tasks.js | 小 | 新增 PATCH preferred 接口（含 active 校验） |
| routes/fill.js | 中 | token 解析逻辑改变，submit 新增 task_id 参数 |
| routes/staff.js | 小 | GET 列表 join fillLink，追加 fillToken/fillUrl |
| TaskList.vue | 小 | 操作列新增首选按钮 + ElMessageBox |
| PersonnelPage.vue | 中 | 重构为列表，新增链接操作区（预设文本+3个操作） |
| TaskDetail.vue | 小 | 迁移后移除 links Tab 及相关代码 |
| FillPage.vue | 中高 | 新增历史编辑流程、无首选任务空态、返回按钮 |
