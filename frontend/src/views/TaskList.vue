<script setup>
/**
 * TaskList.vue — 任务收集页
 * v1.4.3: 页面加载动画
 * v1.4.0: 年份筛选 + Q1-Q4季度页签 + 跨季度任务归前一季度（REQ-30）
 * v1.1.0: 编辑/删除任务 + 停止/开始收集 + 实时活动状态轮询(REQ-17)
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskStore } from '../stores/task'
import { ElMessage, ElMessageBox } from 'element-plus'
import CreateTaskModal from '../components/CreateTaskModal.vue'
import api from '../api'
import { onDataChange, SYNC_EVENTS } from '../utils/sync'

const router = useRouter()
const taskStore = useTaskStore()
const pageLoading = ref(true)  // v1.4.3: 页面初始加载状态

/* ========== 常量 ========== */
const CURRENT_YEAR = new Date().getFullYear()
const QUARTER_OPTIONS = ['Q1', 'Q2', 'Q3', 'Q4']
const QUARTER_MONTHS = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12] }

/** 维度中文映射 */
const DIMENSION_LABEL = {
  day: '日', week: '周', half_month: '半月', month: '月',
  quarter: '季度', half_year: '半年', year: '年'
}

/* ========== 年份 & 季度筛选状态 ========== */
const selectedYear = ref(CURRENT_YEAR)
const activeQuarter = ref(getCurrentQuarter())

function getCurrentQuarter() {
  const m = new Date().getMonth() + 1
  return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'
}

/** 年份下拉选项：从任务数据中提取+当前年，倒序排列 */
const yearOptions = computed(() => {
  const years = new Set([CURRENT_YEAR])
  for (const t of taskStore.list) {
    const y = t.year || new Date(t.start_date).getFullYear()
    if (y) years.add(y)
  }
  return [...years].sort((a, b) => b - a)
})

/**
 * 判断任务归属季度
 * 规则：统一使用 end_date 判定季度（跨季度任务归后一季度）
 */
function getTaskQuarter(task) {
  const endDate = task.end_date ? new Date(task.end_date) : null
  const startDate = task.start_date ? new Date(task.start_date) : null
  const refDate = endDate || startDate

  if (!refDate) return 'Q1'
  const m = refDate.getMonth() + 1
  return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'
}

/** 当前年份+季度筛选后的任务列表 */
const filteredTasks = computed(() => {
  return taskStore.list.filter(task => {
    const taskYear = task.year || new Date(task.start_date).getFullYear()
    if (taskYear !== selectedYear.value) return false
    return getTaskQuarter(task) === activeQuarter.value
  })
})

/** 各季度的任务数量（用于Tab标题） */
const quarterCounts = computed(() => {
  const counts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
  for (const task of taskStore.list) {
    const taskYear = task.year || new Date(task.start_date).getFullYear()
    if (taskYear !== selectedYear.value) continue
    const q = getTaskQuarter(task)
    if (counts[q] !== undefined) counts[q]++
  }
  return counts
})

/* ========== REQ-17: 实时活动状态轮询 ========== */
const POLL_INTERVAL_MS = 5000
let pollTimer = null
const activityMap = ref({}) // { taskId: { editing: [], submitted: [] } }

/** 轮询所有任务的活动状态 */
async function pollActivity() {
  const tasks = taskStore.list || []
  for (const task of tasks) {
    try {
      const res = await api.get(`/tasks/${task.id}/activity`)
      const data = res.data.data || res.data || {}
      activityMap.value[task.id] = data
    } catch {
      // 静默失败
    }
  }
}

function startPolling() {
  pollActivity()
  pollTimer = setInterval(pollActivity, POLL_INTERVAL_MS)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

let cleanupSync = null

onMounted(async () => {
  pageLoading.value = true
  await taskStore.fetchAll()
  startPolling()
  // 监听工时变更广播，自动刷新任务列表
  cleanupSync = onDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, () => {
    taskStore.fetchAll()
  })
  pageLoading.value = false
})

onUnmounted(() => {
  stopPolling()
  if (cleanupSync) cleanupSync()
})

function viewTask(id) {
  router.push(`/tasks/${id}`)
}

/* ========== 编辑任务 ========== */
const showEditModal = ref(false)
const editingTask = ref(null)

function openEdit(task) {
  editingTask.value = { ...task }
  showEditModal.value = true
}

function handleEditDone() {
  showEditModal.value = false
  editingTask.value = null
  taskStore.fetchAll()
}

/* ========== 删除任务 ========== */
async function deleteTask(task) {
  try {
    await ElMessageBox.confirm(
      `确认删除任务「${task.title}」？此操作不可恢复。`,
      '删除任务',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    )
    await taskStore.remove(task.id)
    ElMessage.success('任务已删除')
  } catch {
    // 用户取消
  }
}

/* ========== 停止/开始收集 ========== */
async function toggleCollection(task) {
  const newStatus = task.status === 'active' ? 'closed' : 'active'
  const label = newStatus === 'active' ? '开始收集' : '停止收集'
  try {
    await taskStore.updateStatus(task.id, newStatus)
    ElMessage.success(`已${label}`)
  } catch {
    ElMessage.error('操作失败')
  }
}

/** 获取任务的活动标签 */
function getActivityTags(taskId) {
  const activity = activityMap.value[taskId]
  if (!activity) return []
  const tags = []
  if (activity.editing && activity.editing.length > 0) {
    tags.push({ type: 'editing', text: `${activity.editing.join('、')} 正在编辑任务`, color: '#00B42A' })
  }
  if (activity.submitted && activity.submitted.length > 0) {
    tags.push({ type: 'submitted', text: `${activity.submitted.join('、')} 提交任务`, color: '#165DFF' })
  }
  return tags
}
</script>

<template>
  <div>
    <!-- v1.4.3: 页面加载中动画 -->
    <div v-if="pageLoading" class="dt-page-loading">
      <div class="dt-page-spinner"></div>
      <p style="margin-top:16px; color:var(--color-text-3); font-size:14px;">正在加载中...</p>
    </div>
    <template v-else>
    <div class="dt-page-header flex-between">
      <div>
        <h1 class="dt-page-title">任务收集</h1>
        <p class="dt-page-description">管理和查看所有收集任务</p>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <!-- 年份筛选 -->
        <el-select v-model="selectedYear" style="width:120px;" size="default">
          <el-option v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-button circle @click="taskStore.fetchAll()" title="刷新数据" style="font-size:16px;">🔄</el-button>
      </div>
    </div>

    <!-- 加载状态 -->
    <el-skeleton v-if="taskStore.loading" :rows="5" animated />

    <!-- Q1-Q4 大页签 -->
    <el-tabs v-else v-model="activeQuarter" class="dt-quarter-tabs">
      <el-tab-pane
        v-for="q in QUARTER_OPTIONS"
        :key="q"
        :name="q"
      >
        <template #label>
          <div class="dt-quarter-tab-label">
            <span class="dt-quarter-tab-name">{{ q }}</span>
            <span class="dt-quarter-tab-count">{{ quarterCounts[q] }} 个任务</span>
          </div>
        </template>

        <!-- 该季度有任务 -->
        <div v-if="filteredTasks.length > 0" class="dt-data-card">
          <el-table :data="filteredTasks" style="cursor:pointer;">
            <el-table-column label="时间范围" width="130">
              <template #default="{ row }">
                <span style="font-family:var(--font-mono); font-size:13px; color:var(--color-text-3);">
                  {{ row.start_date }}<br/>{{ row.end_date }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="任务标题" min-width="300">
              <template #default="{ row }">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span style="font-weight:600; color:var(--color-text-1); cursor:pointer;" @click="viewTask(row.id)">{{ row.title }}</span>
                  <!-- REQ-17: 实时活动标签 -->
                  <span
                    v-for="tag in getActivityTags(row.id)"
                    :key="tag.type"
                    class="dt-activity-tag"
                    :style="{ backgroundColor: tag.color + '15', color: tag.color, borderColor: tag.color + '40' }"
                  >
                    <span class="dt-activity-dot" :style="{ backgroundColor: tag.color }"></span>
                    {{ tag.text }}
                  </span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="维度" width="80">
              <template #default="{ row }">
                <span class="dt-tag dt-tag-gray">{{ DIMENSION_LABEL[row.time_dimension] || row.time_dimension }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <span class="dt-badge" :class="{
                  'dt-badge-active': row.status === 'active',
                  'dt-badge-draft': row.status === 'draft',
                  'dt-badge-closed': row.status === 'closed'
                }">
                  {{ row.status === 'active' ? '收集中' : row.status === 'draft' ? '草稿' : '已停止' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="240" align="center">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click.stop="viewTask(row.id)">查看</el-button>
                <el-button type="warning" link size="small" @click.stop="openEdit(row)">编辑</el-button>
                <el-button :type="row.status === 'active' ? 'info' : 'success'" link size="small" @click.stop="toggleCollection(row)">
                  {{ row.status === 'active' ? '停止收集' : '开始收集' }}
                </el-button>
                <el-button type="danger" link size="small" @click.stop="deleteTask(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 该季度空状态 -->
        <div v-else class="dt-empty" style="padding:60px;">
          <div class="dt-empty-icon">📋</div>
          <p class="dt-empty-text">{{ selectedYear }}年 {{ q }} 暂无收集任务</p>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 编辑任务弹窗 -->
    <CreateTaskModal
      v-if="showEditModal"
      :visible="showEditModal"
      :edit-task="editingTask"
      @close="showEditModal = false"
      @created="handleEditDone"
    />
    </template>
  </div>
</template>

<style scoped>
/* REQ-17: 实时活动标签 */
.dt-activity-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid;
  animation: activityPulse 2s ease-in-out infinite;
}

.dt-activity-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: dotBlink 1.5s ease-in-out infinite;
}

@keyframes activityPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

@keyframes dotBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ===== 大号页签样式 ===== */
.dt-quarter-tabs :deep(.el-tabs__header) {
  margin-bottom: 24px;
}

.dt-quarter-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.dt-quarter-tabs :deep(.el-tabs__nav) {
  display: flex;
  gap: 12px;
  border: none !important;
}

.dt-quarter-tabs :deep(.el-tabs__active-bar) {
  display: none;
}

.dt-quarter-tabs :deep(.el-tabs__item) {
  height: auto !important;
  line-height: normal !important;
  padding: 0 !important;
  border: none !important;
}

.dt-quarter-tab-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 140px;
  padding: 14px 10px;
  border-radius: 10px;
  background: var(--color-bg-white);
  border: 2px solid var(--color-border);
  transition: all 0.25s cubic-bezier(0.34, 0.69, 0.1, 1);
  cursor: pointer;
  box-shadow: var(--shadow-1);
}

.dt-quarter-tab-label:hover {
  border-color: var(--color-primary-hover);
  box-shadow: 0 6px 20px rgba(22, 93, 255, 0.12);
  transform: translateY(-2px);
}

.dt-quarter-tab-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-2);
  line-height: 1.2;
}

.dt-quarter-tab-count {
  font-size: 12px;
  color: var(--color-text-4);
  margin-top: 4px;
}

/* 激活态 */
:deep(.el-tabs__item.is-active) .dt-quarter-tab-label {
  border-color: var(--color-primary);
  background: linear-gradient(135deg, rgba(22,93,255,0.06), rgba(114,46,209,0.04));
  box-shadow: 0 6px 20px rgba(22, 93, 255, 0.15);
}

:deep(.el-tabs__item.is-active) .dt-quarter-tab-name {
  color: var(--color-primary);
}

:deep(.el-tabs__item.is-active) .dt-quarter-tab-count {
  color: var(--color-primary);
  opacity: 0.8;
}
</style>
