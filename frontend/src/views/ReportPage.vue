<script setup>
/**
 * ReportPage.vue — 需求工时统计页（原汇总报表）
 * v1.4.3: 页面加载动画 + 2秒自动刷新解决权限页跳转白屏
 * v1.4.2: 本周/上周逻辑重写、默认选中修正、编辑模式“不可编辑”提示
 * v1.1.0: 改名 · 上下周期切换 · 默认上一周期 · 编辑模式 · 工时加粗 · 合计修正
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useReportStore } from '../stores/report'
import { useTaskStore } from '../stores/task'
import { ElMessage, ElMessageBox } from 'element-plus'
import { onDataChange, SYNC_EVENTS } from '../utils/sync'

const reportStore = useReportStore()
const taskStore = useTaskStore()

/* ========== 常量 ========== */
const PAGE_SIZE = 20
const SORT_OPTIONS = [
  { key: 'pm', label: '产品经理' },
  { key: 'frontend', label: '前端' },
  { key: 'backend', label: '后端' },
  { key: 'test', label: '测试' }
]
const DIMENSION_LABEL = {
  day: '日', week: '周', half_month: '半月', month: '月',
  quarter: '季度', half_year: '半年', year: '年'
}

/* ========== 状态 ========== */
const selectedTaskId = ref('')
const sortMode = ref('pm')
const currentPage = ref(1)
const editMode = ref(false)
const pageLoading = ref(true)  // v1.4.3: 页面初始加载状态

/* ========== v1.4.2: 日期判断工具函数 ========== */

/** 格式化日期为 YYYY-MM-DD */
function formatDateStr(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 获取 ISO 周数 */
function getISOWeekNumber(d) {
  const tempDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = tempDate.getUTCDay() || 7
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1))
  return Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7)
}

/** 判断任务日期范围是否包含今天 */
function taskContainsToday(task) {
  const today = formatDateStr(new Date())
  return task.start_date <= today && task.end_date >= today
}

/** 判断任务是否是上一个自然周期（上周） */
function taskIsLastWeek(task) {
  if (task.time_dimension !== 'week') return false
  const today = new Date()
  const dayOfWeek = today.getDay() || 7
  const lastMonday = new Date(today)
  lastMonday.setDate(today.getDate() - dayOfWeek - 6)
  return task.start_date === formatDateStr(lastMonday)
}

/* ========== 初始化：v1.4.2 智能默认选中 ========== */
/* 跨页面数据同步监听 */
let cleanupSync = null

onMounted(async () => {
  pageLoading.value = true
  await taskStore.fetchAll()
  if (taskStore.list.length > 0) {
    // 1. 优先找上周任务
    let defaultTask = taskStore.list.find(t => taskIsLastWeek(t))
    // 2. 如果存在包含今天的任务，切换为本周
    const thisWeekTask = taskStore.list.find(t => taskContainsToday(t))
    if (thisWeekTask) defaultTask = thisWeekTask
    // 3. 兆底：最新任务
    if (!defaultTask) defaultTask = taskStore.list[0]
    selectedTaskId.value = defaultTask.id
  }
  // 监听工时变更广播，自动刷新报表
  cleanupSync = onDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, () => {
    if (selectedTaskId.value) {
      reportStore.fetchByTask(selectedTaskId.value)
    }
  })
  pageLoading.value = false

  // v1.4.3: 权限页跳转后白屏修复 — 2秒延迟自动刷新
  const DELAYED_REFRESH_MS = 2000
  const refreshTimer = setTimeout(async () => {
    await taskStore.fetchAll()
    if (selectedTaskId.value) {
      await reportStore.fetchByTask(selectedTaskId.value)
    }
  }, DELAYED_REFRESH_MS)
  // 注册清理
  const origCleanup = cleanupSync
  cleanupSync = () => {
    clearTimeout(refreshTimer)
    if (origCleanup) origCleanup()
  }
})

onUnmounted(() => {
  if (cleanupSync) cleanupSync()
})

watch(selectedTaskId, async (id) => {
  if (id) {
    currentPage.value = 1
    await reportStore.fetchByTask(id)
  }
})

/* ========== 当前选中任务 ========== */
const selectedTask = computed(() => taskStore.list.find(t => t.id === selectedTaskId.value))
const currentTaskIndex = computed(() => taskStore.list.findIndex(t => t.id === selectedTaskId.value))

/** 相对周期前缀映射 */
const RELATIVE_PREFIX = {
  week: ['本周', '上周'],
  month: ['本月', '上月'],
  quarter: ['本季度', '上季度'],
  half_year: ['本半年', '上半年'],
  year: ['本年', '上年'],
  day: ['今天', '昨天'],
  half_month: ['本半月', '上半月']
}

/** v1.4.2: 标题括号内容 — 基于任务日期范围判断前缀，而非列表索引 */
const periodLabel = computed(() => {
  const t = selectedTask.value
  if (!t) return ''
  const dim = t.time_dimension

  // 构建周期名
  let name = ''
  if (dim === 'week') {
    // 使用任务起始日期计算 ISO 周数（比 week_number 字段更准确）
    const wn = t.week_number || getISOWeekNumber(new Date(t.start_date))
    name = `第${wn}周`
  } else if (dim === 'month') {
    name = `${new Date(t.start_date).getMonth() + 1}月`
  } else if (dim === 'quarter') {
    name = `Q${Math.floor(new Date(t.start_date).getMonth() / 3) + 1}`
  } else {
    name = DIMENSION_LABEL[dim] || dim
  }

  // v1.4.2: 基于日期范围判断前缀
  const prefixes = RELATIVE_PREFIX[dim]
  let prefix = ''
  if (prefixes) {
    if (taskContainsToday(t)) {
      prefix = prefixes[0]  // 本周/本月
    } else if (dim === 'week' && taskIsLastWeek(t)) {
      prefix = prefixes[1]  // 上周
    }
  }

  return prefix ? `${prefix}-${name}` : name
})

/* ========== 周期切换 ========== */
function prevTask() {
  const idx = currentTaskIndex.value
  if (idx < taskStore.list.length - 1) {
    selectedTaskId.value = taskStore.list[idx + 1].id
  }
}
function nextTask() {
  const idx = currentTaskIndex.value
  if (idx > 0) {
    selectedTaskId.value = taskStore.list[idx - 1].id
  }
}

/* ========== 排序 ========== */
function formatPeopleCell(people) {
  if (!Array.isArray(people) || people.length === 0) return '-'
  return people.map(p => `${p.staffName} ${p.hours}H`).join(', ')
}

/** 拆分：仅获取姓名列表 */
function formatNames(people) {
  if (!Array.isArray(people) || people.length === 0) return []
  return people.map(p => p.staffName)
}

/** 拆分：仅获取工时列表 */
function formatHoursList(people) {
  if (!Array.isArray(people) || people.length === 0) return []
  return people.map(p => p.hours)
}

const sortedGroups = computed(() => {
  const groups = [...reportStore.groupsWithTotal]
  switch (sortMode.value) {
    case 'pm':
      return groups.sort((a, b) => {
        const pmA = Array.isArray(a.product_managers) ? a.product_managers.join('') : ''
        const pmB = Array.isArray(b.product_managers) ? b.product_managers.join('') : ''
        return pmA.localeCompare(pmB, 'zh-Hans') || (a.version || '').localeCompare(b.version || '')
      })
    case 'frontend':
      return groups.sort((a, b) => (a.frontend?.[0]?.staffName || '').localeCompare(b.frontend?.[0]?.staffName || '', 'zh-Hans'))
    case 'backend':
      return groups.sort((a, b) => (a.backend?.[0]?.staffName || '').localeCompare(b.backend?.[0]?.staffName || '', 'zh-Hans'))
    case 'test':
      return groups.sort((a, b) => (a.test_role?.[0]?.staffName || '').localeCompare(b.test_role?.[0]?.staffName || '', 'zh-Hans'))
    default:
      return groups
  }
})

/* ========== 分页 ========== */
const totalPages = computed(() => Math.ceil(sortedGroups.value.length / PAGE_SIZE))
const pagedGroups = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return sortedGroups.value.slice(start, start + PAGE_SIZE)
})

/* ========== 操作 ========== */
async function addManualRow() {
  if (!selectedTaskId.value) return
  try {
    await reportStore.addManualRow(selectedTaskId.value)
    ElMessage.success('已添加空白行')
  } catch {
    ElMessage.error('添加失败')
  }
}

async function deleteRow(row) {
  try {
    await ElMessageBox.confirm(`确认删除此行？`, '删除', { type: 'warning' })
    await reportStore.deleteRow(row.id)
    ElMessage.success('已删除')
  } catch {
    // 用户取消
  }
}

async function saveRemark(group) {
  try {
    await reportStore.updateRemark(group.id, group.remark)
  } catch {
    // 静默
  }
}

async function saveRowEdit(row) {
  try {
    await reportStore.updateRow(row.id, {
      merged_title: row.merged_title,
      version: row.version,
      product_managers: row.product_managers
    })
    ElMessage.success('已保存')
  } catch {
    ElMessage.error('保存失败')
  }
}

function toggleEditMode() {
  editMode.value = !editMode.value
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
        <h1 class="dt-page-title">
          需求工时统计
          <span v-if="periodLabel" style="font-weight:700; color:var(--color-primary);">（{{ periodLabel }}）</span>
        </h1>
        <p class="dt-page-description">按需求维度汇总各角色工时数据</p>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <span style="font-size:14px; color:var(--color-text-3);">总工时:</span>
        <span style="font-size:24px; font-weight:700; color:var(--color-primary);">
          {{ reportStore.columnTotals.total.toFixed(1) }}
        </span>
        <span style="font-size:14px; color:var(--color-text-3);">小时</span>
        <el-button circle @click="selectedTaskId && reportStore.fetchByTask(selectedTaskId)" title="刷新数据" style="font-size:16px;">🔄</el-button>
      </div>
    </div>

    <!-- 工具条 -->
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <!-- 上下周期切换 -->
        <el-button size="small" @click="prevTask" :disabled="currentTaskIndex >= taskStore.list.length - 1">◀ 上一周期</el-button>
        <!-- 任务选择器 -->
        <el-select v-model="selectedTaskId" placeholder="选择任务" style="width:360px;">
          <el-option v-for="t in taskStore.list" :key="t.id" :label="t.title" :value="t.id" />
        </el-select>
        <el-button size="small" @click="nextTask" :disabled="currentTaskIndex <= 0">下一周期 ▶</el-button>
        <el-button @click="addManualRow">+ 新增行</el-button>
      </div>

      <!-- 排序 + 编辑 -->
      <div style="display:flex; gap:4px; align-items:center;">
        <span style="font-size:13px; color:var(--color-text-3); padding:6px 0; margin-right:8px;">排序:</span>
        <button
          v-for="opt in SORT_OPTIONS" :key="opt.key"
          @click="sortMode = opt.key"
          :class="['dt-btn', 'dt-btn-sm', sortMode === opt.key ? 'dt-btn-primary' : 'dt-btn-outline']"
        >
          {{ opt.label }}
        </button>
        <span style="width:1px; height:20px; background:var(--color-border-light); margin:0 8px;"></span>
        <button
          @click="toggleEditMode"
          :class="['dt-btn', 'dt-btn-sm', editMode ? 'dt-btn-primary' : 'dt-btn-outline']"
        >
          ✏️ 编辑
        </button>
      </div>
    </div>

    <!-- 数据表格 -->
    <div class="dt-data-card">
      <el-skeleton v-if="reportStore.loading" :rows="6" animated />

      <div v-else-if="reportStore.matchGroups.length === 0" class="dt-empty">
        <div class="dt-empty-icon">📊</div>
        <p class="dt-empty-text">暂无汇总数据</p>
      </div>

      <el-table v-else :data="pagedGroups" border show-summary :summary-method="getSummary" style="font-size:14px;">
        <el-table-column type="index" label="序号" width="50" align="center" />
        <el-table-column prop="version" label="版本号" width="110">
          <template #default="{ row }">
            <el-input v-if="editMode && row.status === 'manual_merged'" v-model="row.version" size="small" @blur="saveRowEdit(row)" />
            <span v-else style="font-family:var(--font-mono);">{{ row.version || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="merged_title" label="需求名称" min-width="260">
          <template #default="{ row }">
            <el-input v-if="editMode && row.status === 'manual_merged'" v-model="row.merged_title" size="small" @blur="saveRowEdit(row)" />
            <span v-else style="font-weight:500;">{{ row.merged_title || '(空)' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="产品经理" width="120">
          <template #default="{ row }">
            {{ Array.isArray(row.product_managers) ? row.product_managers.join(', ') : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="前端" align="center">
          <el-table-column label="姓名" width="90">
            <template #default="{ row }">
              <div v-if="formatNames(row.frontend).length">
                <div v-for="(n, i) in formatNames(row.frontend)" :key="i" style="line-height:1.6;">{{ n }}</div>
              </div>
              <span v-else style="color:var(--color-text-4);">-</span>
            </template>
          </el-table-column>
          <el-table-column label="工时/H" width="80" align="center" header-class-name="dt-nowrap-header">
            <template #default="{ row }">
              <div v-if="formatHoursList(row.frontend).length">
                <div v-for="(h, i) in formatHoursList(row.frontend)" :key="i" style="line-height:1.6; font-weight:700; color:#165DFF;">{{ h }}</div>
              </div>
              <span v-else style="color:var(--color-text-4);">-</span>
            </template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="后端" align="center">
          <el-table-column label="姓名" width="100">
            <template #default="{ row }">
              <div v-if="formatNames(row.backend).length">
                <div v-for="(n, i) in formatNames(row.backend)" :key="i" style="line-height:1.6;">{{ n }}</div>
              </div>
              <span v-else style="color:var(--color-text-4);">-</span>
            </template>
          </el-table-column>
          <el-table-column label="工时/H" width="80" align="center" header-class-name="dt-nowrap-header">
            <template #default="{ row }">
              <div v-if="formatHoursList(row.backend).length">
                <div v-for="(h, i) in formatHoursList(row.backend)" :key="i" style="line-height:1.6; font-weight:700; color:#00B42A;">{{ h }}</div>
              </div>
              <span v-else style="color:var(--color-text-4);">-</span>
            </template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="测试" align="center">
          <el-table-column label="姓名" width="90">
            <template #default="{ row }">
              <div v-if="formatNames(row.test_role).length">
                <div v-for="(n, i) in formatNames(row.test_role)" :key="i" style="line-height:1.6;">{{ n }}</div>
              </div>
              <span v-else style="color:var(--color-text-4);">-</span>
            </template>
          </el-table-column>
          <el-table-column label="工时/H" width="80" align="center" header-class-name="dt-nowrap-header">
            <template #default="{ row }">
              <div v-if="formatHoursList(row.test_role).length">
                <div v-for="(h, i) in formatHoursList(row.test_role)" :key="i" style="line-height:1.6; font-weight:700; color:#FF7D00;">{{ h }}</div>
              </div>
              <span v-else style="color:var(--color-text-4);">-</span>
            </template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="总计/小时" width="90" align="center">
          <template #default="{ row }">
            <span style="font-weight:700; color:var(--color-primary);">{{ row._rowTotal.toFixed(1) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="备注" width="150">
          <template #default="{ row }">
            <el-input v-model="row.remark" size="small" placeholder="备注" @blur="saveRemark(row)" />
          </template>
        </el-table-column>
        <!-- 编辑模式操作列 -->
        <el-table-column v-if="editMode" label="操作" width="100" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'manual_merged'" type="danger" link size="small" @click="deleteRow(row)">删除</el-button>
            <span v-else class="dt-tag dt-tag-gray" style="font-size:11px;">不可编辑</span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div v-if="totalPages > 1" style="display:flex; justify-content:center; padding:16px;">
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="PAGE_SIZE"
          :total="sortedGroups.length"
          layout="prev, pager, next"
        />
      </div>
      </div>
    </template>
  </div>
</template>

<script>
import { h } from 'vue'
export default {
  methods: {
    getSummary({ columns, data }) {
      const sums = []
      columns.forEach((col, idx) => {
        if (idx === 0) {
          sums[idx] = h('span', { style: 'font-weight:800; font-size:16px; color:#1D2129;' }, '合计')
          return
        }
        if (col.property === 'version' || col.property === 'merged_title') { sums[idx] = ''; return }
        // 姓名列留空
        if (col.label === '姓名' || col.label === '产品经理') { sums[idx] = ''; return }
        // 前端工时
        if (col.label === '工时/H' && idx <= 6) {
          const val = data.reduce((s, row) => s + (row._frontendTotal || 0), 0).toFixed(1)
          sums[idx] = h('span', { style: 'font-weight:700; font-size:14px; color:#165DFF;' }, val)
          return
        }
        // 后端工时
        if (col.label === '工时/H' && idx <= 8) {
          const val = data.reduce((s, row) => s + (row._backendTotal || 0), 0).toFixed(1)
          sums[idx] = h('span', { style: 'font-weight:700; font-size:14px; color:#00B42A;' }, val)
          return
        }
        // 测试工时
        if (col.label === '工时/H' && idx <= 10) {
          const val = data.reduce((s, row) => s + (row._testTotal || 0), 0).toFixed(1)
          sums[idx] = h('span', { style: 'font-weight:700; font-size:14px; color:#FF7D00;' }, val)
          return
        }
        // 总计列
        if (col.label && col.label.startsWith('总计')) {
          const val = data.reduce((s, row) => s + (row._rowTotal || 0), 0).toFixed(1)
          sums[idx] = h('span', { style: 'font-weight:800; font-size:15px; color:var(--color-primary);' }, val)
          return
        }
        sums[idx] = ''
      })
      return sums
    }
  }
}
</script>

<style scoped>
/* REQ-29: 工时/H列头不换行 */
:deep(.dt-nowrap-header .cell) {
  white-space: nowrap;
}
</style>
