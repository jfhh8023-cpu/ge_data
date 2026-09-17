<script setup>
/**
 * StatsPage.vue — 周期统计（季度）页
 * Tab 1: 部门全观 — 三级筛选器 + 概要卡片 + 明细表 + Canvas 柱状图
 * Tab 2: 研发聚焦 — 人员选择 + 概要卡片 + 手风琴任务列表
 *
 * v1.4.3: 页面加载动画 + 产品经理列修复（过滤数字字符串）
 * v1.4.2: 卡片排序调整、合计行格式修正、明细表/个人聚焦列错位修复
 * v1.4.1: 移除总计列、合计行显示小时、个人聚焦修复、一起看交替背景
 * v1.1.0 改动:
 *   - S4-1: 数据源改为基于 WorkRecord + Staff role 聚合（REQ-11）
 *   - S4-2: 筛选器布局已在页面顶部三联排列（REQ-12）
 *   - S4-3: 柱状图数据源改为后端 pmDistribution + 合并单元格表（REQ-13）
 *   - S4-4: 角色工时卡片（REQ-19）
 *   - S4-5: 个人聚焦自动展开最近周期（REQ-15）
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useStatsStore } from '../stores/stats'
import { useTaskStore } from '../stores/task'
import { usePmStore } from '../stores/pm'
import { useRoleStore } from '../stores/roles'
import api from '../api'
import { ElMessage } from 'element-plus'
import { ArrowLeft, ArrowRight, ArrowUp } from '@element-plus/icons-vue'
import { onDataChange, SYNC_EVENTS } from '../utils/sync'
import { generateAndDownloadExcel, uploadExcelToServer } from '../utils/excel'
import { useAuthStore } from '../stores/auth'
import { ROLE_AI_DEV, ROLE_VOIP, ROLE_AI_QUALITY, normalizeRole, roleColor, roleLabel, roleTagStyle } from '../utils/roles'
import { summarizeWorkHours } from '../utils/workHours'
import { sortRecordsByCreatedAt, latestCreatedAt } from '../utils/recordOrder'
import ProductHoursChart from '../components/ProductHoursChart.vue'
import DeliverySummary from '../components/DeliverySummary.vue'
import StatsHoursCard from '../components/StatsHoursCard.vue'
import DeliveryStatusNotice from '../components/DeliveryStatusNotice.vue'
import IncompleteRequirementsDialog from '../components/IncompleteRequirementsDialog.vue'
import { incompleteRequirementRows } from '../utils/deliveryStatus'
import StaffDeliveryList from '../components/StaffDeliveryList.vue'
import StatsCountsCard from '../components/StatsCountsCard.vue'
import DepartmentPeopleDialog from '../components/DepartmentPeopleDialog.vue'
import StatsGroupedRecordTable from '../components/StatsGroupedRecordTable.vue'
import StatsRecordTable from '../components/StatsRecordTable.vue'
import StatsProgressTable from '../components/StatsProgressTable.vue'
import { DELIVERY_NOTE, hasDeliveryVersion, summarizeDelivery, summarizeStaffDelivery, deliveryMetricTip, weightedRateText, requirementProgressText } from '../utils/deliverySummary'
import { isFullCreditRecord } from '../utils/effectiveHours'
import { sortStatsRows, recordSource, recordStaffId, requirementIdentity, uniqueStatsRecords, recordTableRows } from '../utils/statsTable'

const statsStore = useStatsStore()
const authStore = useAuthStore()
const taskStore = useTaskStore()
const pmStore = usePmStore()
const roleStore = useRoleStore()
const router = useRouter()

/* ========== 常量 ========== */
const CURRENT_YEAR = new Date().getFullYear()
const CHART_BAR_WIDTH = 18
const barMeta = computed(() => [
  ...roleStore.list.filter(role => role.key !== 'ai_pm').map(role => ({ key: role.key, label: role.short_name, color: role.color })),
  { key: 'total', label: '总计', color: '#F53F3F' }
])
const WEEK_WINDOW_SIZE = 9
const WEEK_MIN_WINDOW_SIZE = 4
const WEEK_FOCUS_INDEX = 4
const WEEK_WINDOW_STEP = 2
const WEEK_CHIP_SLOT_WIDTH = 54
const WEEK_NAV_SLOT_WIDTH = 72

const PM_THEME_COLOR = '#722ED1'
const analysisRoleMeta = computed(() => roleStore.list.map(role => ({
  key: role.key,
  label: role.short_name,
  name: role.name,
  color: role.color
})))
const WORKLOAD_REPORT_PATH = 'api/local-reports/workload-analysis/devtracker_workload_all_latest.html'
const ANALYSIS_KEYWORD_DEFS = [
  { name: '语音', pattern: /语音|通话|呼叫|坐席|热线|TTS|SIP|kamailio|vos|VOS|DID|网关|线路|外呼|群呼|CC/i },
  { name: 'AI/智能体', pattern: /智能体|Agent|agent|AI|意图识别|知识库/i },
  { name: '工单/任务', pattern: /工单|任务|待办|审批|流转/ },
  { name: '监控/告警', pattern: /监控|告警|日志|链路|审计|报表|统计/ },
  { name: '性能/优化', pattern: /优化|性能|压测|卡顿|稳定|改进|升级/ },
  { name: '部署/运维', pattern: /部署|服务器|环境|网关|TLS|证书|服务|运维/ },
  { name: '短信', pattern: /短信|SMS/i },
  { name: '界面体验', pattern: /前端|页面|界面|列表|按钮|展示|排序|UI/i },
  { name: '质量问题', pattern: /测试|质量|问题|缺陷|bug|修复|异常|定位/i }
]

/* ========== 金银铜牌常量 ========== */
const MEDAL_EMOJI = ['🥇', '🥈', '🥉']
const MEDAL_CLASS = ['medal-gold', 'medal-silver', 'medal-bronze']

function getMedalRank(records, currentHours) {
  const uniqueHours = [...new Set(records.map(r => parseFloat(r.hours || 0)))]
    .sort((a, b) => b - a)
    .slice(0, 3)
  const h = parseFloat(currentHours || 0)
  const idx = uniqueHours.indexOf(h)
  return idx >= 0 && idx < 3 ? idx : -1
}

/* ========== Tab 切换 ========== */
const activeTab = ref('department')
const pageLoading = ref(true)  // v1.4.3: 页面初始加载状态
const pmSortOrder = ref('') // 默认按记录创建时间倒序；支持手动按工时排序
const showBackTop = ref(false)
const hideZeroValueBars = ref(true)

/* ========== 弹窗状态 ========== */
const analysisDialogVisible = ref(false)
const departmentPeopleVisible = ref(false)
const analysisActiveTab = ref('staff')
const analysisDetailsRef = ref(null)
const analysisTableHeight = ref(300)
let analysisResizeObserver = null

function measureAnalysisTable() {
  const pane = analysisDetailsRef.value?.querySelector('.el-tab-pane:not([style*="display: none"])')
  if (!pane || !pane.querySelector(':scope > .el-table')) return
  const reserved = Array.from(pane.children).filter(el => !el.classList.contains('el-table')).reduce((sum, el) => {
    const style = getComputedStyle(el)
    return sum + el.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0)
  }, 0)
  analysisTableHeight.value = Math.max(100, Math.floor(pane.clientHeight - reserved - 2))
}

watch([analysisDialogVisible, analysisActiveTab, analysisDetailsRef], async () => {
  await nextTick()
  analysisResizeObserver?.disconnect()
  const content = analysisDetailsRef.value?.querySelector('.el-tabs__content')
  if (analysisDialogVisible.value && content) {
    analysisResizeObserver = new ResizeObserver(measureAnalysisTable)
    analysisResizeObserver.observe(content)
    measureAnalysisTable()
  }
}, { flush: 'post' })
const progressListDialogVisible = ref(false)
const progressListTitle = ref('')
const progressListRows = ref([])
const analysisDimension = ref('total')
const analysisSourceType = ref('')
const analysisDemandSourceId = ref('')
const analysisStaffId = ref('')
const mainDimension = ref('total')
const mainStaffId = ref('')
const mainRecordTabs = [
  { key: 'engineering', label: '研发及其他人员' },
  { key: 'product_manager', label: 'AI产品经理' }
]
const mainRecordTab = computed({
  get: () => ['productOnly', 'ai_pm'].includes(mainDimension.value) ? 'product_manager' : 'engineering',
  set: sourceType => {
    mainDimension.value = sourceType === 'product_manager' ? 'productOnly' : 'total'
    mainStaffId.value = ''
  }
})
const mainRecordRoles = computed(() => roleStore.list.filter(role => role.key !== 'ai_pm'))

/* ========== 筛选状态（共享） ========== */
const selectedYear = ref(CURRENT_YEAR)
const selectedQuarter = ref(getCurrentQuarter())
const selectedTaskId = ref('all')
const selectedNaturalWeekTaskId = ref('')
const weekWindowStart = ref(0)
const weekSelectorRef = ref(null)
const weekWindowSize = ref(WEEK_WINDOW_SIZE)

let weekSelectorResizeObserver = null

function getCurrentQuarter() {
  return getQuarterByMonth(new Date().getMonth() + 1)
}

function getQuarterByMonth(month) {
  return month <= 3 ? 'Q1' : month <= 6 ? 'Q2' : month <= 9 ? 'Q3' : 'Q4'
}

const yearOptions = computed(() => {
  const years = []
  for (let y = CURRENT_YEAR + 1; y >= CURRENT_YEAR - 2; y--) years.push(y)
  return years
})

const quarterOptions = ['Q1', 'Q2', 'Q3', 'Q4']

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getQuarterDateRange(year, quarter) {
  const startMonthMap = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 }
  const startMonth = startMonthMap[quarter] ?? 0
  return {
    start: startOfDay(new Date(year, startMonth, 1)),
    end: startOfDay(new Date(year, startMonth + 3, 0))
  }
}

function getNaturalWeekStart(date) {
  const d = startOfDay(date)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d
}

function getISOWeekNumber(date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = utcDate.getUTCDay() || 7
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1))
  return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7)
}

function taskMatchesWeek(task, week) {
  if (!task || (task.time_dimension && task.time_dimension !== 'week')) return false
  const taskStart = String(task.start_date || '').slice(0, 10)
  const taskEnd = String(task.end_date || '').slice(0, 10)
  if (taskStart === week.startDate || taskEnd === week.endDate) return true
  return Number(task.week_number) === week.weekNumber
}

function taskRecordCount(task) {
  const count = Number(task?.record_count ?? task?.recordCount ?? 0)
  return Number.isFinite(count) ? count : 0
}

function updateWeekWindowSize() {
  const el = weekSelectorRef.value
  if (!el) return
  const labelWidth = el.querySelector?.('.dt-week-selector-label')?.offsetWidth || 44
  const available = el.clientWidth - labelWidth - WEEK_NAV_SLOT_WIDTH
  const nextSize = Math.max(
    WEEK_MIN_WINDOW_SIZE,
    Math.min(WEEK_WINDOW_SIZE, Math.floor(available / WEEK_CHIP_SLOT_WIDTH))
  )
  if (Number.isFinite(nextSize) && nextSize !== weekWindowSize.value) {
    weekWindowSize.value = nextSize
  }
  weekWindowStart.value = clampWeekWindowStart(weekWindowStart.value)
}

const quarterWeeks = computed(() => {
  const { start, end } = getQuarterDateRange(Number(selectedYear.value), selectedQuarter.value)
  const today = startOfDay(new Date())
  const isCurrentQuarter = Number(selectedYear.value) === today.getFullYear()
    && selectedQuarter.value === getQuarterByMonth(today.getMonth() + 1)
  const weeks = []

  for (let cursor = getNaturalWeekStart(start); cursor <= end; cursor = addDays(cursor, 7)) {
    const weekEnd = addDays(cursor, 6)
    if (weekEnd < start || weekEnd > end) continue
    if (isCurrentQuarter && cursor > today) continue

    const weekNumber = getISOWeekNumber(cursor)
    const baseWeek = {
      key: `${selectedYear.value}-W${String(weekNumber).padStart(2, '0')}`,
      weekNumber,
      label: `${weekNumber}周`,
      startDate: formatDateKey(cursor),
      endDate: formatDateKey(weekEnd)
    }
    const task = (statsStore.tasks || []).find(t => taskMatchesWeek(t, baseWeek))
    const recordCount = taskRecordCount(task)
    weeks.push({
      ...baseWeek,
      taskId: task?.id || '',
      taskTitle: task?.title || '',
      recordCount,
      state: !task ? 'no-task' : recordCount > 0 ? 'ready' : 'empty'
    })
  }

  return weeks.sort((a, b) => new Date(b.endDate) - new Date(a.endDate))
})

function clampWeekWindowStart(start) {
  const maxStart = Math.max(0, quarterWeeks.value.length - weekWindowSize.value)
  return Math.min(Math.max(start, 0), maxStart)
}

const visibleQuarterWeeks = computed(() => {
  if (quarterWeeks.value.length <= weekWindowSize.value) return quarterWeeks.value
  const start = clampWeekWindowStart(weekWindowStart.value)
  return quarterWeeks.value.slice(start, start + weekWindowSize.value)
})

const hasHiddenWeeksLeft = computed(() => {
  if (quarterWeeks.value.length <= weekWindowSize.value) return false
  return clampWeekWindowStart(weekWindowStart.value) > 0
})

const hasHiddenWeeksRight = computed(() => {
  if (quarterWeeks.value.length <= weekWindowSize.value) return false
  const start = clampWeekWindowStart(weekWindowStart.value)
  return start + weekWindowSize.value < quarterWeeks.value.length
})

const weekFocusIndex = computed(() => Math.min(WEEK_FOCUS_INDEX, Math.max(0, weekWindowSize.value - 1)))

const selectedWeekKey = computed(() => {
  const weekTaskId = selectedNaturalWeekTaskId.value || selectedTaskId.value
  const week = quarterWeeks.value.find(w => w.taskId && w.taskId === weekTaskId)
  return week?.key || ''
})

const indicatorWeekKey = computed(() => {
  if (selectedWeekKey.value) return selectedWeekKey.value
  return quarterWeeks.value.find(w => w.state === 'ready')?.key || ''
})

function shiftWeekWindow(direction) {
  weekWindowStart.value = clampWeekWindowStart(weekWindowStart.value + direction * WEEK_WINDOW_STEP)
}

function selectQuarterWeek(week, visibleIndex) {
  if (week.state !== 'ready' || !week.taskId) return
  selectedNaturalWeekTaskId.value = week.taskId
  if (quarterWeeks.value.length <= weekWindowSize.value) return

  if (visibleIndex > weekFocusIndex.value) {
    weekWindowStart.value = clampWeekWindowStart(weekWindowStart.value + visibleIndex - weekFocusIndex.value)
  } else if (visibleIndex < weekFocusIndex.value) {
    weekWindowStart.value = clampWeekWindowStart(weekWindowStart.value - (weekFocusIndex.value - visibleIndex))
  }
}

watch([selectedYear, selectedQuarter], () => {
  weekWindowStart.value = 0
  selectedNaturalWeekTaskId.value = ''
})

watch(quarterWeeks, async () => {
  weekWindowStart.value = clampWeekWindowStart(weekWindowStart.value)
  await nextTick()
  updateWeekWindowSize()
})

watch(weekWindowSize, () => {
  weekWindowStart.value = clampWeekWindowStart(weekWindowStart.value)
})

watch(selectedTaskId, (taskId, oldTaskId) => {
  if (taskId !== oldTaskId) selectedNaturalWeekTaskId.value = ''
  if (!taskId || taskId === 'all' || quarterWeeks.value.length <= weekWindowSize.value) return
  const idx = quarterWeeks.value.findIndex(w => w.taskId === taskId)
  if (idx >= 0) {
    weekWindowStart.value = clampWeekWindowStart(idx - weekFocusIndex.value)
  }
})

const taskOptions = computed(() => {
  const sorted = [...(statsStore.tasks || [])].sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
  return [{ id: 'all', title: '全部周期' }, ...sorted]
})

const effectiveTaskId = computed(() => selectedNaturalWeekTaskId.value || selectedTaskId.value)

const selectedEffectiveTask = computed(() => {
  const taskId = effectiveTaskId.value
  if (!taskId || taskId === 'all') return null
  return (statsStore.tasks || []).find(t => t.id === taskId) || null
})

function reportPeriodKeyForTask(task) {
  const fallback = `quarter:${selectedYear.value}-${selectedQuarter.value}`
  if (!task || selectedTaskId.value === 'all') return fallback
  const dimension = task.time_dimension || task.timeDimension || ''
  const endDate = String(task.end_date || task.start_date || '')
  const year = String(task.year || endDate.slice(0, 4) || selectedYear.value)
  if (dimension === 'year') return `year:${year}`
  if (dimension === 'quarter') {
    const month = Number(endDate.slice(5, 7))
    const quarter = task.quarter || (month ? getQuarterByMonth(month) : selectedQuarter.value)
    return `quarter:${year}-${quarter}`
  }
  if (dimension === 'month') {
    const monthKey = String(task.month || endDate.slice(0, 7) || '')
    return monthKey ? `month:${monthKey}` : fallback
  }
  return fallback
}

function selectedReportParentPeriodKey() {
  if (selectedTaskId.value === 'all') return `quarter:${selectedYear.value}-${selectedQuarter.value}`
  const task = (statsStore.tasks || []).find(t => t.id === selectedTaskId.value)
  return reportPeriodKeyForTask(task)
}

/** 当前筛选的标签文字（用于柱状图标题） */
const filterLabel = computed(() => {
  const task = selectedEffectiveTask.value
  if (task) return task.title
  return selectedQuarter.value
})

const selectedPeriodRangeText = computed(() => {
  const tasks = statsStore.tasks || []
  if (effectiveTaskId.value !== 'all') {
    return selectedEffectiveTask.value ? formatTaskPeriod(selectedEffectiveTask.value) : '未识别周期范围'
  }
  if (!tasks.length) return '当前筛选暂无周期'
  const start = tasks.reduce((min, t) => !min || new Date(t.start_date) < new Date(min) ? t.start_date : min, '')
  const end = tasks.reduce((max, t) => !max || new Date(t.end_date) > new Date(max) ? t.end_date : max, '')
  return start && end ? `${start} 至 ${end}` : '未识别周期范围'
})

const statsScopeTitle = computed(() => `${selectedYear.value}年 ${selectedQuarter.value} / ${filterLabel.value}`)

/* ========== 数据加载 ========== */
/* 跨页面数据同步监听 */
let cleanupSync = null

function updateBackTopVisibility() {
  showBackTop.value = window.scrollY > 320
}

function scrollToStatsTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
  window.requestAnimationFrame(() => {
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  })
}

onMounted(async () => {
  pageLoading.value = true
  await Promise.all([taskStore.fetchAll(), pmStore.fetchAll(), roleStore.fetchAll({ force: true })])
  await loadDeptStats()
  await nextTick()
  updateWeekWindowSize()
  setTimeout(updateWeekWindowSize, 50)
  if (typeof ResizeObserver !== 'undefined' && weekSelectorRef.value) {
    weekSelectorResizeObserver = new ResizeObserver(() => updateWeekWindowSize())
    weekSelectorResizeObserver.observe(weekSelectorRef.value)
  }
  window.addEventListener('resize', updateWeekWindowSize)
  window.addEventListener('scroll', updateBackTopVisibility, { passive: true })
  updateBackTopVisibility()
  // 监听工时变更广播，自动刷新统计
  cleanupSync = onDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, () => {
    loadDeptStats()
  })
  pageLoading.value = false
})

onUnmounted(() => {
  analysisResizeObserver?.disconnect()
  if (cleanupSync) cleanupSync()
  if (weekSelectorResizeObserver) weekSelectorResizeObserver.disconnect()
  window.removeEventListener('resize', updateWeekWindowSize)
  window.removeEventListener('scroll', updateBackTopVisibility)
})

async function loadDeptStats() {
  await statsStore.fetch({
    year: selectedYear.value,
    quarter: selectedQuarter.value,
    taskId: effectiveTaskId.value,
    pmSort: pmSortOrder.value || undefined
  })
}

watch([selectedYear, selectedQuarter, selectedTaskId, selectedNaturalWeekTaskId], async ([year, quarter], [oldYear, oldQuarter]) => {
  if ((year !== oldYear || quarter !== oldQuarter) && selectedTaskId.value !== 'all') {
    selectedTaskId.value = 'all'
    return
  }
  if (activeTab.value === 'department') {
    await loadDeptStats()
  } else if (activeTab.value === 'personal') {
    // 刷新部门统计（保持 taskOptions 下拉和 staff 列表同步）
    await statsStore.fetch({
      year: selectedYear.value,
      quarter: selectedQuarter.value,
      taskId: effectiveTaskId.value
    })
    // 根据当前 viewMode 刷新个人数据
    if (viewMode.value === 'individual' && selectedStaffId.value) {
      await statsStore.fetchPersonal(selectedStaffId.value, {
        year: selectedYear.value,
        quarter: selectedQuarter.value,
        taskId: effectiveTaskId.value
      })
    } else if (viewMode.value === 'all') {
      await loadAllPersonalData()
    }

  } else if (activeTab.value === 'product') {
    // 刷新部门统计（保持 taskOptions 同步）
    await statsStore.fetch({
      year: selectedYear.value,
      quarter: selectedQuarter.value,
      taskId: effectiveTaskId.value
    })
    if (pmViewMode.value === 'individual' && selectedPmId.value) {
      await statsStore.fetchPmFocus(selectedPmId.value, {
        year: selectedYear.value,
        quarter: selectedQuarter.value,
        taskId: effectiveTaskId.value
      })
    } else if (pmViewMode.value === 'all') {
      await loadAllPmData()
    }
  }
})

/* ========== 角色工时（基于后端 roleSummary，REQ-11/REQ-19） ========== */
const periodRecords = computed(() => uniqueStatsRecords(statsStore.records || [], statsStore.workHours))
const currentPeriodTasks = computed(() => (statsStore.tasks || []).filter(task => effectiveTaskId.value === 'all' || String(task.id) === String(effectiveTaskId.value)))
const departmentPeople = computed(() => summarizeStaffDelivery(periodRecords.value, statsStore.workHours))
const roleTotals = computed(() => {
  return Object.fromEntries(roleStore.list.map(role => [role.key, periodRecords.value
    .filter(record => normalizeRole(record.staff?.role || record.role) === role.key)
    .reduce((sum, record) => sum + toNumber(record.hours), 0)]))
})


function capacityUnits({ role = '', sourceType = '', staffId = '', units = statsStore.workHours?.units || [] } = {}) {
  return units.filter(unit => (!role || normalizeRole(unit.role) === role)
    && (!staffId || String(unit.staffId) === String(staffId))
    && (!sourceType || (sourceType === 'product_manager' ? normalizeRole(unit.role) === 'ai_pm' : normalizeRole(unit.role) !== 'ai_pm')))
}

function hoursMetric(records, options = {}) {
  if (!statsStore.workHours) return null
  return { ...summarizeWorkHours(records, capacityUnits(options)), scopeNote: statsStore.workHours.scopeNote }
}

const roleWorkHours = computed(() => Object.fromEntries(roleStore.list.map(role => [role.key,
  hoursMetric(periodRecords.value.filter(record => normalizeRole(record.staff?.role || record.role) === role.key), { role: role.key })
])))
const analysisCapacityUnits = computed(() => capacityUnits({ role: analysisDimensionMeta.value.role, sourceType: analysisSourceType.value, staffId: analysisStaffId.value }))
const analysisWorkHours = computed(() => hoursMetric(analysisRecords.value, { units: analysisCapacityUnits.value }))
const progressListRoleKey = ref('')
const progressListVersionType = ref('')
const hasVersion = hasDeliveryVersion

const departmentDelivery = computed(() => summarizeDelivery(periodRecords.value, statsStore.workHours))
const roleDelivery = computed(() => Object.fromEntries(roleStore.list.map(role => [role.key,
  summarizeDelivery(periodRecords.value.filter(record => normalizeRole(record.staff?.role || record.role) === role.key), roleWorkHours.value[role.key])
])))
const analysisVersionType = ref('all')
watch(analysisVersionType, async () => { await nextTick(); measureAnalysisTable() })
const analysisRecordScope = ref('current')
const analysisCustomYear = ref(CURRENT_YEAR)
const analysisCustomQuarter = ref(getCurrentQuarter())
const analysisCustomTaskId = ref('all')
const analysisUsesRemoteScope = computed(() => analysisRecordScope.value !== 'current')
const analysisCustomYears = computed(() => [...new Set([...yearOptions.value, ...(taskStore.list || []).map(task => Number(task.year)).filter(Boolean)])].sort((a, b) => b - a))
const analysisCustomTasks = computed(() => (taskStore.list || []).filter(task => {
  if (Number(task.year) !== Number(analysisCustomYear.value)) return false
  const month = Number(String(task.end_date || task.start_date || '').slice(5, 7))
  return analysisCustomQuarter.value === 'all' || (month && getQuarterByMonth(month) === analysisCustomQuarter.value)
}).sort((a, b) => String(b.end_date || '').localeCompare(String(a.end_date || ''))))
const analysisPeriodModeLabel = computed(() => analysisRecordScope.value === 'all' ? '全部周期' : analysisRecordScope.value === 'custom' ? '所选周期' : '当前周期')
const analysisPeriodTitle = computed(() => {
  if (analysisRecordScope.value === 'all') return '全部可见历史'
  if (analysisRecordScope.value === 'current') return statsScopeTitle.value
  const task = analysisCustomTasks.value.find(task => String(task.id) === String(analysisCustomTaskId.value))
  return task ? formatTaskPeriod(task) : `${analysisCustomYear.value}年 ${analysisCustomQuarter.value === 'all' ? '全年' : analysisCustomQuarter.value}`
})
const analysisPeriodRangeText = computed(() => analysisRecordScope.value === 'current' ? selectedPeriodRangeText.value : analysisPeriodTitle.value)
const deliveryDialogRecords = computed(() => analysisUsesRemoteScope.value
  ? sortRecordsByCreatedAt(uniqueStatsRecords(statsStore.progressDetails?.records || [], statsStore.progressDetails?.workHours)) : analysisRecords.value)
const analysisScopeCapacity = computed(() => analysisUsesRemoteScope.value ? statsStore.progressDetails?.workHours : analysisWorkHours.value)
const analysisScopeTasks = computed(() => analysisUsesRemoteScope.value ? statsStore.progressDetails?.tasks || [] : currentPeriodTasks.value)
const deliveryDialogSummary = computed(() => summarizeDelivery(deliveryDialogRecords.value, analysisScopeCapacity.value))
const incompleteDialogVisible = ref(false)
const incompleteSource = ref({ kind: 'card', role: '' })
const incompleteScope = computed(() => {
  if (incompleteSource.value.kind === 'analysis') return {
    records: deliveryDialogRecords.value, capacity: analysisScopeCapacity.value, tasks: analysisScopeTasks.value,
    label: `${analysisPeriodRangeText.value} · ${analysisScopeLabel.value}`
  }
  const role = incompleteSource.value.role
  return {
    records: role ? periodRecords.value.filter(record => normalizeRole(record.staff?.role || record.role) === role) : periodRecords.value,
    capacity: role ? roleWorkHours.value[role] : statsStore.workHours,
    tasks: currentPeriodTasks.value,
    label: `${selectedPeriodRangeText.value} · ${role ? roleDisplay(role) : '部门'}`
  }
})
const incompleteRows = computed(() => incompleteRequirementRows(incompleteScope.value.records, incompleteScope.value.capacity, incompleteScope.value.tasks)
  .map(row => ({ ...row, roleLabel: roleDisplay(row.role) })))
function openIncompleteRequirements(role = '', fromAnalysis = false) {
  incompleteSource.value = { kind: fromAnalysis ? 'analysis' : 'card', role }
  incompleteDialogVisible.value = true
}
const deliveryDialogRows = computed(() => deliveryDialogRecords.value.filter(record => analysisVersionType.value === 'all' || hasDeliveryVersion(record) === (analysisVersionType.value === 'versioned')))
const analysisShowsUnversioned = computed(() => analysisActiveTab.value === 'noVersion' || (analysisActiveTab.value === 'records' && analysisVersionType.value === 'noVersion'))
function recordGroupDelivery(records) {
  if (!analysisScopeCapacity.value) return null
  const keys = new Set(records.map(record => JSON.stringify([String(record.staff_id || record.staff?.id || ''), String(record.task_id || '')])))
  const units = (analysisScopeCapacity.value.units || []).filter(unit => keys.has(JSON.stringify([String(unit.staffId), String(unit.taskId)])))
  return summarizeDelivery(records, summarizeWorkHours(records, units))
}
function withRecordDelivery(record) {
  return { ...record, roleLabel: roleDisplay(record.staff?.role || record.role, true), deliveryRate: hasDeliveryVersion(record) ? recordGroupDelivery([record])?.deliveryRate ?? null : null }
}
const analysisRawRows = computed(() => recordTableRows(deliveryDialogRows.value.map(withRecordDelivery), analysisScopeTasks.value))
const analysisTrackingRows = computed(() => recordTableRows(deliveryDialogRecords.value.map(withRecordDelivery), analysisScopeTasks.value))
function deliveryFromInfo(info) {
  return info?.deliverySummary || summarizeDelivery((info?.tasks || []).flatMap(task => task.records || []), info?.workHours)
}
watch(analysisVersionType, () => resetAnalysisPage('records'))
watch(analysisRecordScope, () => ANALYSIS_PAGE_KEYS.forEach(resetAnalysisPage))
async function changeDeliveryScope() {
  ANALYSIS_PAGE_KEYS.forEach(resetAnalysisPage)
  if (!analysisUsesRemoteScope.value) return
  const scope = analysisRecordScope.value
  try {
    await loadProgressDetails(scope)
  } catch {
    if (analysisRecordScope.value === scope) ElMessage.error('所选范围工时加载失败，请刷新或切回当前周期后重试')
  }
}
async function changeAnalysisCustomPeriod() {
  analysisCustomTaskId.value = 'all'
  await changeDeliveryScope()
}

function roleSummaryHours(summary = {}, role) {
  if (role === ROLE_AI_DEV && summary[role] === undefined) return Number(summary.frontend || 0) + Number(summary.backend || 0)
  if (role === ROLE_AI_QUALITY && summary[role] === undefined) return Number(summary.test || 0)
  return Number(summary[role] || 0)
}

function roleDisplay(role, compact = false) {
  return roleLabel(role, compact)
}

function rolePillStyle(role, compact = false) {
  const color = roleColor(role)
  const palette = { background: `${color}14`, color }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: compact ? '1px 5px' : '2px 10px',
    borderRadius: '9999px',
    fontSize: compact ? '10px' : '11px',
    fontWeight: '500',
    lineHeight: compact ? '16px' : '18px',
    minWidth: compact ? '42px' : '54px',
    whiteSpace: 'nowrap',
    ...palette
  }
}

/* ========== 柱状图按同一原始记录范围聚合，每条研发记录归属首位产品经理 ========== */
const chartData = computed(() => {
  const groups = new Map()
  for (const record of periodRecords.value) {
    if (recordSource(record) !== 'engineering') continue
    const name = firstPmName(record.product_managers)
    if (!groups.has(name)) groups.set(name, { name, total: 0, ...Object.fromEntries(roleStore.list.map(role => [role.key, 0])) })
    const row = groups.get(name)
    const role = normalizeRole(record.staff?.role || record.role)
    row.total += toNumber(record.hours)
    row[role] = (row[role] || 0) + toNumber(record.hours)
  }
  return [...groups.values()].filter(row => row.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'zh-CN'))
})

const engineeringChartSources = computed(() => barMeta.value
  .filter(bar => bar.key !== 'total')
  .map(bar => ({ id: bar.key, name: bar.label, color: bar.color })))
const engineeringChartRows = computed(() => chartData.value.map(row => ({
  staffId: row.name,
  staffName: row.name,
  total: toNumber(row.total),
  sourceValues: Object.fromEntries(engineeringChartSources.value.map(source => [source.id, roleSummaryHours(row, source.id)]))
})))
const productRecords = computed(() => periodRecords.value.filter(record => recordSource(record) === 'product_manager'))
const productChartSources = computed(() => (statsStore.demandSources || []).slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)))
const productManagerChartRows = computed(() => {
  const sourceList = productChartSources.value
  const sourceByName = new Map(sourceList.map(source => [source.name, source]))
  const grouped = new Map()
  for (const record of productRecords.value) {
    const staffName = record.staff?.name || record.staff_name || '-'
    const staffId = record.staff?.id || record.staff_id || staffName
    if (!grouped.has(staffId)) {
      grouped.set(staffId, {
        staffId,
        staffName,
        total: 0,
        sourceValues: Object.fromEntries(sourceList.map(source => [source.id, 0]))
      })
    }
    const row = grouped.get(staffId)
    const hours = toNumber(record.hours)
    row.total += hours
    const names = (record.demand_sources || []).filter(name => sourceByName.has(name))
    if (!names.length) continue
    const rawWeights = record.demand_source_weights || {}
    const supplied = names.map(name => Number(rawWeights[name])).map(value => Number.isFinite(value) && value >= 0 ? value : 0)
    const weightTotal = supplied.reduce((sum, value) => sum + value, 0)
    names.forEach((name, index) => {
      const weight = weightTotal > 0 ? supplied[index] / weightTotal : 1 / names.length
      const source = sourceByName.get(name)
      row.sourceValues[source.id] += hours * weight
    })
  }
  return [...grouped.values()]
    .map(row => ({
      ...row,
      total: Number(row.total.toFixed(1)),
      sourceValues: Object.fromEntries(Object.entries(row.sourceValues).map(([id, value]) => [id, Number(value.toFixed(1))]))
    }))
    .sort((a, b) => b.total - a.total || a.staffName.localeCompare(b.staffName, 'zh-Hans-CN'))
})
function formatChartHours(value) {
  const hours = Number(value)
  return Number.isFinite(hours) ? String(Number(hours.toFixed(1))) : '0'
}
const chartBarGap = computed(() => {
  const values = [
    ...engineeringChartRows.value.flatMap(row => Object.values(row.sourceValues)),
    ...productManagerChartRows.value.flatMap(row => Object.values(row.sourceValues))
  ]
  return Math.max(8, ...values.map(value => formatChartHours(value).length * 6 + 4 - CHART_BAR_WIDTH))
})
// Allocate width by each chart's actual group density; totals no longer reserve a bar slot.
// Keep the allocation stable when toggling zeroes, then let the chart wrap if needed.
function chartPanelWidth(rows) {
  const groupWidth = Math.max(76, ...rows.map(row => {
    const count = Object.values(row.sourceValues || {}).filter(value => Number(value) > 0).length
    return count * CHART_BAR_WIDTH + Math.max(0, count - 1) * chartBarGap.value + 16
  }))
  return Math.max(340, rows.length * (groupWidth + 8) - 8 + 34)
}
const departmentChartLayout = computed(() => ({
  '--engineering-chart-width': `${chartPanelWidth(engineeringChartRows.value)}fr`,
  '--product-chart-width': `${chartPanelWidth(productManagerChartRows.value)}fr`
}))

function selectProductChartManager(staffId) {
  const query = { year: selectedYear.value, quarter: selectedQuarter.value, taskId: effectiveTaskId.value }
  if (authStore.isAdmin) query.admin = '1'
  else if (authStore.token) query.token = authStore.token
  const routeData = router.resolve({ name: 'ProductManagerHours', params: { staffId }, query })
  window.open(routeData.href, '_blank', 'noopener')
}

const analysisVersionedRows = computed(() => analysisData.value.progressRows.filter(row => row.versionType !== '无版本号'))
const analysisNoVersionRows = computed(() => analysisData.value.progressRows.filter(row => row.versionType === '无版本号'))
const ANALYSIS_PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100, 200, 300]
const ANALYSIS_PAGE_KEYS = ['records', 'tracking', 'versioned', 'noVersion', 'pm', 'staff', 'task', 'version', 'requirement', 'keyword', 'quality', 'progress', 'progressModal']
const analysisPagination = ref(Object.fromEntries(ANALYSIS_PAGE_KEYS.map(key => [key, { currentPage: 1, pageSize: 20 }])))
const analysisSorts = ref(Object.fromEntries(ANALYSIS_PAGE_KEYS.map(key => [key, ['records', 'tracking', 'versioned', 'noVersion', 'progress', 'progressModal'].includes(key) ? { prop: 'created_at', order: 'descending' } : { prop: '', order: null }])))

function changeAnalysisSort(key, sort) {
  analysisSorts.value[key] = { prop: sort.prop, order: sort.order }
  resetAnalysisPage(key)
}

function pagedAnalysisRows(key, rows = []) {
  const state = analysisPagination.value[key]
  if (!state) return rows
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize))
  if (state.currentPage > totalPages) state.currentPage = totalPages
  const start = (state.currentPage - 1) * state.pageSize
  return sortStatsRows(rows, analysisSorts.value[key]).slice(start, start + state.pageSize)
}

function analysisPageTotal(rows = []) {
  return rows.length
}

function resetAnalysisPage(key) {
  if (analysisPagination.value[key]) analysisPagination.value[key].currentPage = 1
}

/* The two detail tabs partition the same period records by who submitted them. */
const mainScopeMeta = computed(() => {
  const role = ['total', 'engineering', 'productOnly'].includes(mainDimension.value) ? '' : mainDimension.value
  return {
    label: role ? roleDisplay(role) : mainRecordTabs.find(tab => tab.key === mainRecordTab.value).label,
    role,
    sourceType: mainRecordTab.value
  }
})
const mainStaffOptions = computed(() => [...new Map(capacityUnits(mainScopeMeta.value)
  .map(unit => [String(unit.staffId), { id: String(unit.staffId), name: unit.staffName, role: unit.role }])).values()])
const mainScopeLabel = computed(() => `${mainScopeMeta.value.label}${mainStaffId.value ? ` · ${mainStaffOptions.value.find(person => person.id === mainStaffId.value)?.name || mainStaffId.value}` : ''}`)
const mainScopeRecords = computed(() => sortRecordsByCreatedAt(periodRecords.value.filter(record =>
  (!mainScopeMeta.value.role || normalizeRole(record.staff?.role || record.role) === mainScopeMeta.value.role)
  && (!mainScopeMeta.value.sourceType || recordSource(record) === mainScopeMeta.value.sourceType)
  && (!mainStaffId.value || recordStaffId(record) === mainStaffId.value))))
const mainScopeCapacity = computed(() => hoursMetric(mainScopeRecords.value, { ...mainScopeMeta.value, staffId: mainStaffId.value }))
const mainScopeDelivery = computed(() => summarizeDelivery(mainScopeRecords.value, mainScopeCapacity.value))
const mainRecordRows = computed(() => recordTableRows(mainScopeRecords.value.map(record => ({
  ...record, roleLabel: roleDisplay(record.staff?.role || record.role, true)
})), statsStore.tasks))
watch(mainStaffOptions, people => { if (mainStaffId.value && !people.some(person => person.id === mainStaffId.value)) mainStaffId.value = '' })
function changeMainDimension() { mainStaffId.value = '' }
function selectStatsCard(dimension = 'total') {
  mainDimension.value = dimension
  mainStaffId.value = ''
  openAnalysisDialog(dimension)
}
function openMainAnalysis(tab = 'staff') {
  openAnalysisDialog(mainScopeMeta.value.role || 'total', mainScopeMeta.value.sourceType, '', mainStaffId.value)
  analysisActiveTab.value = tab
}
const departmentCounts = computed(() => [
  { key: 'records', label: '提交记录数', value: periodRecords.value.length, color: '#165DFF', action: 'records', tip: '当前周期非离职人员已保存记录数，按来源与记录ID去重，包含五类工时及普通无版本记录。' },
  { key: 'requirements', label: '统计需求总数', value: new Set(periodRecords.value.filter(record => !isFullCreditRecord(record)).map(requirementIdentity)).size, color: '#FF7D00', action: 'requirement', tip: '当前范围普通需求按周期、版本、精确标题去重；不包含请假、培训、公司会议、出差、团建。' },
  { key: 'tasks', label: '收集任务数', value: currentPeriodTasks.value.length, color: '#009688', action: 'task', tip: '当前筛选范围可见的收集任务数，含尚无提交记录的任务。' },
  { key: 'staff', label: '部门人数', value: departmentPeople.value.length, color: '#722ED1', action: 'staff', tip: '当前非离职且所选范围有记录的研发与产品人员，按人员ID去重；没有记录的人员不计入。' }
])
function openDepartmentCount(tab) {
  mainDimension.value = 'total'
  mainStaffId.value = ''
  if (tab === 'staff') departmentPeopleVisible.value = true
  else {
    openAnalysisDialog('total')
    analysisActiveTab.value = tab
  }
}

function toNumber(val) {
  const n = parseFloat(val || 0)
  return Number.isFinite(n) ? n : 0
}

function formatRecordCreatedAt(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatTaskPeriod(task) {
  if (!task) return '-'
  const year = task.year || String(task.start_date || '').slice(0, 4) || String(selectedYear.value)
  const week = String(task.week_number || '').padStart(2, '0')
  const weekText = week ? `第${week}周` : '未识别周'
  return `${year}-${weekText} ${task.start_date || '-'}~${task.end_date || '-'}`
}

function taskSortTime(task) {
  return task?.end_date ? new Date(task.end_date).getTime() : 0
}

function firstPmName(productManagers) {
  const arr = parseJsonField(productManagers).filter(isValidPMName)
  return arr[0] || '不在上述'
}

function taskWeekLabel(task) {
  const weekNumber = Number(task?.week_number)
  if (Number.isInteger(weekNumber) && weekNumber > 0) return `W${String(weekNumber).padStart(2, '0')}`
  return '-'
}

function groupAnalysisRows(records, keyGetter, labelGetter) {
  const map = new Map()
  for (const rec of records) {
    const key = keyGetter(rec)
    const label = labelGetter ? labelGetter(rec) : key
    if (!map.has(key)) {
      const initial = {
        key,
        label,
        total: 0,
        recordCount: 0,
        records: [],
        requirementSet: new Set(),
        taskSet: new Set(),
        weekSet: new Set()
      }
      roleStore.list.forEach(role => { initial[role.key] = 0 })
      map.set(key, initial)
    }
    const row = map.get(key)
    row.records.push(rec)
    const hours = toNumber(rec.hours)
    const role = normalizeRole(rec.staff?.role || rec.role)
    row.total += hours
    row.recordCount += 1
    row.taskSet.add(rec.task_id)
    const task = analysisScopeTasks.value.find(item => item.id === rec.task_id)
    const weekLabel = taskWeekLabel(task)
    if (weekLabel !== '-') row.weekSet.add(weekLabel)
    if (!isFullCreditRecord(rec)) row.requirementSet.add(requirementIdentity(rec))
    if (row[role] !== undefined) row[role] += hours
  }
  return sortRecordsByCreatedAt([...map.values()]
    .map(row => {
      const result = {
        ...row,
        created_at: latestCreatedAt(row.records),
        total: Number(row.total.toFixed(1)),
        taskCount: row.taskSet.size,
        requirementCount: row.requirementSet.size,
        weeks: [...row.weekSet].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
        share: 0
      }
      roleStore.list.forEach(role => { result[role.key] = Number((row[role.key] || 0).toFixed(1)) })
      return result
    }))
}

const analysisDimensionMeta = computed(() => {
  const meta = { total: { label: analysisSourceType.value === 'engineering' ? 'AI研发' : analysisSourceType.value === 'product_manager' ? 'AI产品' : '部门', role: '', color: '#F53F3F' } }
  roleStore.list.forEach(role => { meta[role.key] = { label: role.name, role: role.key, color: role.color } })
  return meta[analysisDimension.value] || meta.total
})

const analysisVisibleRoles = computed(() => {
  const role = analysisDimensionMeta.value.role
  if (role) return [role]
  if (analysisSourceType.value === 'product_manager') return ['ai_pm']
  if (analysisSourceType.value === 'engineering') return analysisRoleMeta.value.filter(item => item.key !== 'ai_pm').map(item => item.key)
  return analysisRoleMeta.value.map(item => item.key)
})

function showAnalysisRole(role) {
  return analysisVisibleRoles.value.includes(role)
}

const analysisRecords = computed(() => {
  const sourceRecords = sortRecordsByCreatedAt(periodRecords.value)
  const records = analysisSourceType.value
    ? sourceRecords.filter(record => recordSource(record) === analysisSourceType.value)
    : sourceRecords
  const role = analysisDimensionMeta.value.role
  const scoped = records.filter(record => (!role || normalizeRole(record.staff?.role || record.role) === role)
    && (!analysisStaffId.value || recordStaffId(record) === analysisStaffId.value))
  if (!analysisDemandSourceId.value) return scoped
  const source = statsStore.demandSources.find(item => item.id === analysisDemandSourceId.value)?.name || analysisDemandSourceId.value
  return scoped.filter(record => (record.demand_sources || []).includes(source)).map(record => {
    const sources = record.demand_sources || []
    const weights = sources.map(name => Math.max(0, Number(record.demand_source_weights?.[name]) || 0))
    const total = weights.reduce((sum, value) => sum + value, 0)
    const fraction = total > 0 ? weights[sources.indexOf(source)] / total : 1 / sources.length
    return { ...record, originalHours: record.hours, hours: toNumber(record.hours) * fraction }
  })
})

const analysisData = computed(() => {
  const records = deliveryDialogRecords.value
  const total = records.reduce((sum, rec) => sum + toNumber(rec.hours), 0)
  const roleTotals = Object.fromEntries(roleStore.list.map(role => [role.key, 0]))
  for (const rec of records) {
    const role = normalizeRole(rec.staff?.role || rec.role)
    if (roleTotals[role] !== undefined) roleTotals[role] += toNumber(rec.hours)
  }
  const requirementKey = requirementIdentity
  const pmRows = groupAnalysisRows(records, rec => rec.is_product_manager_record ? `product:${rec.staff_id || rec.staff?.id}` : firstPmName(rec.product_managers), rec => rec.is_product_manager_record ? rec.staff?.name || '-' : firstPmName(rec.product_managers)).map(row => ({ ...row, share: total ? Number((row.total * 100 / total).toFixed(1)) : 0 }))
  const staffRows = sortRecordsByCreatedAt(summarizeStaffDelivery(records, analysisScopeCapacity.value))
    .map(row => ({
      ...row,
      key: row.staffId,
      label: `${row.staffName}（${roleDisplay(row.role, true)}）`,
      total: row.recordedHours,
      share: total ? Number((row.recordedHours * 100 / total).toFixed(1)) : 0
    }))
  const versionRows = groupAnalysisRows(records, rec => isFullCreditRecord(rec) ? String(rec.version || '五类工时（历史未填版本）').trim() : hasDeliveryVersion(rec) ? String(rec.version).trim() : '无版本号').map(row => ({ ...row, share: total ? Number((row.total * 100 / total).toFixed(1)) : 0 }))
  const requirementRows = groupAnalysisRows(records.filter(rec => !isFullCreditRecord(rec)), requirementKey, rec => rec.requirement_title || '-').map(row => ({ ...row, share: total ? Number((row.total * 100 / total).toFixed(1)) : 0 }))
  const taskGroups = new Map(groupAnalysisRows(records, rec => String(rec.task_id || '-')).map(row => [row.key, row]))
  const allowedTaskIds = new Set((analysisScopeCapacity.value?.units || []).map(unit => String(unit.taskId)))
  const limitedPeople = analysisDimensionMeta.value.role || analysisStaffId.value || analysisSourceType.value
  const taskRows = sortRecordsByCreatedAt(analysisScopeTasks.value.filter(task => !limitedPeople || allowedTaskIds.has(String(task.id)) || taskGroups.has(String(task.id))).map(task => {
    const row = taskGroups.get(String(task.id)) || {
      total: 0, recordCount: 0, requirementCount: 0, taskCount: 1,
      ...Object.fromEntries(roleStore.list.map(role => [role.key, 0]))
    }
    return {
      ...row,
      key: String(task.id),
      label: formatTaskPeriod(task),
      created_at: task.created_at,
      sortTime: taskSortTime(task),
      share: total ? Number((row.total * 100 / total).toFixed(1)) : 0
    }
  }))
  const roleComboRows = groupAnalysisRows(records.filter(rec => !isFullCreditRecord(rec)), requirementKey, rec => rec.requirement_title || '-')
    .map(row => ({
      combo: roleStore.list.filter(role => row[role.key] > 0).map(role => role.short_name).join('+') || '无角色',
      total: row.total,
      requirementCount: 1
    }))
    .reduce((arr, row) => {
      const found = arr.find(item => item.combo === row.combo)
      if (found) {
        found.total = Number((found.total + row.total).toFixed(1))
        found.requirementCount += 1
      } else {
        arr.push({ ...row })
      }
      return arr
    }, [])
    .map(row => ({ ...row, share: total ? Number((row.total * 100 / total).toFixed(1)) : 0 }))
    .sort((a, b) => b.total - a.total)
  const keywordRows = ANALYSIS_KEYWORD_DEFS.map(def => {
    const hitRecords = records.filter(rec => def.pattern.test(`${rec.requirement_title || ''} ${rec.version || ''}`))
    const hours = hitRecords.reduce((sum, rec) => sum + toNumber(rec.hours), 0)
    return {
      label: def.name,
      total: Number(hours.toFixed(1)),
      share: total ? Number((hours * 100 / total).toFixed(1)) : 0,
      recordCount: hitRecords.length,
      requirementCount: new Set(hitRecords.filter(rec => !isFullCreditRecord(rec)).map(requirementKey)).size
    }
  }).filter(row => row.total > 0).sort((a, b) => b.total - a.total)
  const emptyPmRecords = records.filter(rec => !isFullCreditRecord(rec) && !rec.is_product_manager_record && parseJsonField(rec.product_managers).filter(isValidPMName).length === 0)
  const missingVersionRecords = records.filter(rec => !hasDeliveryVersion(rec))
  const zeroHoursRecords = records.filter(rec => toNumber(rec.hours) <= 0)
  const qualityRows = [
    { label: '空AI产品经理', records: emptyPmRecords },
    { label: '未填版本', records: missingVersionRecords },
    { label: '0 或负工时', records: zeroHoursRecords }
  ].map(item => {
    const hours = item.records.reduce((sum, rec) => sum + toNumber(rec.hours), 0)
    return {
      label: item.label,
      recordCount: item.records.length,
      total: Number(hours.toFixed(1)),
      share: total ? Number((hours * 100 / total).toFixed(1)) : 0
    }
  })
  const progressMap = new Map()
  for (const rec of records) {
    const version = String(rec.version || '').trim()
    const person = rec.staff?.name || '-'
    const key = JSON.stringify([rec.staff_id || rec.staff?.id || person, hasVersion(rec) ? version : '__NO_VERSION__', String(rec.requirement_title || '').trim(), isFullCreditRecord(rec) ? rec.id : ''])
    if (!progressMap.has(key)) progressMap.set(key, [])
    progressMap.get(key).push(rec)
  }
  const progressRows = sortRecordsByCreatedAt([...progressMap.values()].map(group => {
    const first = group[0]
    const metric = recordGroupDelivery(group)
    const progress = metric?.requirementProgress ?? null
    return {
      person: first.staff?.name || '-',
      role: roleDisplay(first.staff?.role, true),
      roleKey: normalizeRole(first.staff?.role || first.role),
      records: group.map(withRecordDelivery),
      created_at: latestCreatedAt(group),
      version: String(first.version || '').trim(),
      versionType: isFullCreditRecord(first) ? '五类有效工时' : hasVersion(first) ? '有版本号' : '无版本号',
      requirement: first.requirement_title || '-',
      hours: Number(group.reduce((sum, row) => sum + toNumber(row.hours), 0).toFixed(1)),
      deliveredHours: metric?.deliveredHours ?? 0,
      deliveryRate: metric?.deliveryRate ?? null,
      weightedDeliveryRate: metric?.weightedDeliveryRate ?? null,
      fullCredit: isFullCreditRecord(first),
      standardHours: metric?.standardHours ?? 0,
      weeks: [...new Set(group.map(record => taskWeekLabel(analysisScopeTasks.value.find(task => task.id === record.task_id))))].filter(week => week !== '-'),
      progress,
      completed: progress != null && progress >= 100
    }
  }))
  return {
    total: Number(total.toFixed(1)),
    recordCount: records.length,
    requirementCount: new Set(records.filter(rec => !isFullCreditRecord(rec)).map(requirementKey)).size,
    taskCount: taskRows.length,
    avgRecordHours: records.length ? Number((total / records.length).toFixed(1)) : 0,
    avgRequirementHours: requirementRows.length ? Number((total / requirementRows.length).toFixed(1)) : 0,
    roleTotals: Object.fromEntries(roleStore.list.map(role => [role.key, Number((roleTotals[role.key] || 0).toFixed(1))])),
    pmRows,
    staffRows,
    versionRows,
    requirementRows,
    taskRows,
    roleComboRows,
    keywordRows,
    qualityRows,
    progressRows
  }
})

const analysisScopeLabel = computed(() => {
  const person = analysisStaffId.value ? analysisScopeCapacity.value?.units?.find(unit => String(unit.staffId) === analysisStaffId.value)?.staffName : ''
  return `${analysisDimensionMeta.value.label}${person ? ` · ${person}` : ''}`
})
const analysisDialogTitle = computed(() => `${analysisPeriodTitle.value}｜${analysisScopeLabel.value}工时明细`)
const analysisGroupTabs = computed(() => [
  { key: 'pm', label: 'AI产品经理', rows: analysisData.value.pmRows, roles: true, requirements: true },
  { key: 'task', label: '周期', rows: analysisData.value.taskRows, roles: true, requirements: true },
  { key: 'version', label: '版本', rows: analysisData.value.versionRows, roles: true, weeks: true, requirements: true },
  { key: 'requirement', label: '需求', rows: analysisData.value.requirementRows, roles: true },
  { key: 'keyword', label: '关键词', rows: analysisData.value.keywordRows, requirements: true },
  { key: 'quality', label: '数据质量', rows: analysisData.value.qualityRows }
])
const analysisProgressTabs = computed(() => [
  { key: 'versioned', label: '有效工时（版本及五类）', rows: analysisVersionedRows.value },
  { key: 'noVersion', label: '无版本号版本', rows: analysisNoVersionRows.value },
  { key: 'progress', label: '需求进度', rows: analysisData.value.progressRows }
])
function analysisExportVersion() {
  return analysisActiveTab.value === 'records' ? analysisVersionType.value
    : ['versioned', 'noVersion'].includes(analysisActiveTab.value) ? analysisActiveTab.value : ''
}

const analysisTopRows = computed(() => ({
  period: [...analysisData.value.taskRows].sort((a, b) => b.total - a.total)[0],
  pm: [...analysisData.value.pmRows].sort((a, b) => b.total - a.total)[0],
  staff: [...analysisData.value.staffRows].sort((a, b) => b.total - a.total)[0],
  requirement: [...analysisData.value.requirementRows].sort((a, b) => b.total - a.total)[0],
  version: [...analysisData.value.versionRows].sort((a, b) => b.total - a.total)[0],
  keyword: analysisData.value.keywordRows[0],
  combo: analysisData.value.roleComboRows[0]
}))

const analysisRoleRows = computed(() => {
  return analysisRoleMeta.value
    .filter(item => showAnalysisRole(item.key))
    .map(item => {
      const hours = analysisData.value.roleTotals[item.key] || 0
      const share = analysisData.value.total ? Number((hours * 100 / analysisData.value.total).toFixed(1)) : 0
      return {
        ...item,
        hours,
        share
      }
    })
})

const analysisRoleSummaryText = computed(() => {
  if (analysisDimensionMeta.value.role) {
    const row = analysisRoleRows.value[0]
    return row ? `${row.label} ${row.hours.toFixed(1)}h。` : ''
  }
  return `${roleStore.list.map(role => `${role.name} ${Number(analysisData.value.roleTotals[role.key] || 0).toFixed(1)}h`).join('，')}。`
})

async function openAnalysisDialog(dimension = 'total', sourceType = '', demandSourceId = '', staffId = '') {
  analysisDimension.value = dimension
  analysisSourceType.value = sourceType
  analysisDemandSourceId.value = demandSourceId
  analysisStaffId.value = String(staffId || '')
  analysisVersionType.value = 'all'
  analysisRecordScope.value = 'current'
  analysisCustomYear.value = selectedYear.value
  analysisCustomQuarter.value = selectedQuarter.value
  analysisCustomTaskId.value = effectiveTaskId.value
  analysisActiveTab.value = 'staff'
  ANALYSIS_PAGE_KEYS.forEach(resetAnalysisPage)
  analysisDialogVisible.value = true
}

function analysisPeriodParams(scope) {
  const custom = scope === 'custom'
  return {
    scope: scope === 'all' ? 'all' : 'current',
    year: custom ? analysisCustomYear.value : selectedYear.value,
    quarter: custom ? analysisCustomQuarter.value : selectedQuarter.value,
    taskId: custom ? analysisCustomTaskId.value : effectiveTaskId.value
  }
}

async function loadProgressDetails(scope = 'all') {
  const params = {
    ...analysisPeriodParams(scope),
    sourceType: analysisSourceType.value,
    role: analysisDimensionMeta.value.role,
    demandSourceId: analysisDemandSourceId.value,
    staffId: analysisStaffId.value
  }
  await statsStore.fetchProgressDetails(params)
}

function downloadProgressDetails(scope = 'all', versionType = '', roleKey = '') {
  const params = new URLSearchParams({
    ...analysisPeriodParams(scope),
    sourceType: analysisSourceType.value,
    role: roleKey || analysisDimensionMeta.value.role,
    versionType: versionType === 'noVersion' ? 'no_version' : versionType,
    demandSourceId: analysisDemandSourceId.value,
    staffId: analysisStaffId.value
  })
  const base = api.defaults.baseURL || '/api'
  const url = `${base}/stats/export.xlsx?${params.toString()}`
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener'
  link.click()
}

function openProgressList(roleKey = '', versionType = '') {
  progressListRoleKey.value = roleKey
  progressListVersionType.value = versionType
  const role = roleKey ? roleStore.list.find(item => item.key === roleKey) : null
  const versionLabel = versionType === 'versioned' ? '有效工时' : versionType === 'noVersion' ? '普通无版本' : ''
  progressListTitle.value = `${role ? `${role.name}` : analysisDimensionMeta.value.label}${versionLabel ? ` · ${versionLabel}` : ''}需求进度明细`
  progressListRows.value = analysisData.value.progressRows.filter(row => {
    const roleMatch = !role || row.roleKey === role.key
    const versionMatch = !versionType || (versionType === 'versioned' ? row.versionType !== '无版本号' : row.versionType === '无版本号')
    return roleMatch && versionMatch
  })
  resetAnalysisPage('progressModal')
  progressListDialogVisible.value = true
}

function workloadReportUrl(extra = {}) {
  const params = new URLSearchParams()
  params.set('year', String(selectedYear.value))
  params.set('quarter', selectedQuarter.value)
  if (effectiveTaskId.value !== 'all') {
    params.set('taskId', effectiveTaskId.value)
    if (selectedNaturalWeekTaskId.value) {
      params.set('parentPeriod', selectedReportParentPeriodKey())
    }
  } else {
    params.set('period', `quarter:${selectedYear.value}-${selectedQuarter.value}`)
  }
  if (extra.dimension) params.set('dimension', extra.dimension)
  const base = import.meta.env.BASE_URL || '/'
  return `${base}${WORKLOAD_REPORT_PATH}?${params.toString()}`
}

function openWorkloadReportPage(dimension = 'total') {
  const url = workloadReportUrl({ dimension })
  const opened = window.open(url, '_blank')
  if (!opened) ElMessage.info('浏览器拦截了新窗口，请允许弹窗后重试')
}

/* ========== 研发图表姓名入口 ========== */
function selectEngineeringChartManager(name) {
  const pm = pmStore.list.find(item => item.name === name)
  if (pm?.token) {
    const routeData = router.resolve({ path: `/pm/view/${pm.token}`, query: { year: selectedYear.value, quarter: 0, month: 0 } })
    window.open(routeData.href, '_blank', 'noopener')
  }
}

/* ========== Tab 2: 研发聚焦 ========== */
const selectedStaffId = ref('')
const expandedTaskIds = ref([])

/** v1.4.4: 判断任务是否是上一个自然周（用于默认展开） */
function taskIsLastWeek(task) {
  if (task.time_dimension !== 'week') return false
  const today = new Date()
  const dayOfWeek = today.getDay() || 7
  const lastMonday = new Date(today)
  lastMonday.setDate(today.getDate() - dayOfWeek - 6)
  const y = lastMonday.getFullYear()
  const m = String(lastMonday.getMonth() + 1).padStart(2, '0')
  const d = String(lastMonday.getDate()).padStart(2, '0')
  return task.start_date === `${y}-${m}-${d}`
}

/** 选择人员（REQ-15：自动展开上一周任务） */
async function selectStaff(staffId) {
  selectedStaffId.value = staffId
  expandedTaskIds.value = []
  await statsStore.fetchPersonal(staffId, {
    year: selectedYear.value,
    quarter: selectedQuarter.value,
    taskId: effectiveTaskId.value
  })
  // v1.4.4: 默认展开上一周任务；若无则展开第一个有记录的任务
  const tasks = statsStore.personalData?.tasks || []
  const lastWeekTask = tasks.find(t => taskIsLastWeek(t))
  if (lastWeekTask) {
    expandedTaskIds.value = [lastWeekTask.id]
  } else {
    const firstWithRecords = tasks.find(t => t.records?.length > 0)
    if (firstWithRecords) expandedTaskIds.value = [firstWithRecords.id]
  }
}

/** 切换 Tab 时的初始化 */
watch(activeTab, async (tab) => {
  if (tab === 'department') {
    await loadDeptStats()
  } else if (tab === 'personal') {
    // 切换到个人 Tab 时，先刷新部门统计以保持 staff / taskOptions 同步
    await statsStore.fetch({
      year: selectedYear.value,
      quarter: selectedQuarter.value,
      taskId: effectiveTaskId.value
    })
    // 刷新个人数据
    if (viewMode.value === 'individual' && selectedStaffId.value) {
      await statsStore.fetchPersonal(selectedStaffId.value, {
        year: selectedYear.value,
        quarter: selectedQuarter.value,
        taskId: effectiveTaskId.value
      })
    } else if (viewMode.value === 'all') {
      await loadAllPersonalData()
    }

  } else if (tab === 'product') {
    // 切换到产品聚焦 Tab 时，刷新部门统计 + PM 列表
    await statsStore.fetch({
      year: selectedYear.value,
      quarter: selectedQuarter.value,
      taskId: effectiveTaskId.value
    })
    await pmStore.fetchAll()
    if (pmViewMode.value === 'individual' && selectedPmId.value) {
      await statsStore.fetchPmFocus(selectedPmId.value, {
        year: selectedYear.value,
        quarter: selectedQuarter.value,
        taskId: effectiveTaskId.value
      })
    } else if (pmViewMode.value === 'all') {
      await loadAllPmData()
    }
  }
})

/* ========== 研发聚焦双模式 ========== */
const viewMode = ref('individual')  // 'individual' | 'all'
const allPersonalData = ref({})
const expandAllLatestWeek = ref(true)
const allExpandedMap = ref({})
const coreRoleKeys = [ROLE_AI_DEV, ROLE_VOIP, ROLE_AI_QUALITY]
const additionalRoles = computed(() => roleStore.list.filter(role => !coreRoleKeys.includes(role.key)))

function roleSectionHeaderStyle(role) {
  const color = roleColor(role)
  return { fontSize: '14px', fontWeight: 600, color, marginBottom: '12px', padding: '8px 12px', background: `${color}14`, borderRadius: '8px', textAlign: 'center', whiteSpace: 'nowrap' }
}

function rolePersonGroupStyle(role, index) {
  const alternate = index % 2 === 1
  return { marginBottom: '16px', background: alternate ? `${roleColor(role)}0F` : 'transparent', borderRadius: '8px', padding: alternate ? '10px' : '0' }
}

function syncCollectiveLatestWeekExpansion() {
  const nextExpandedMap = {}
  if (expandAllLatestWeek.value) {
    Object.values(allPersonalData.value).forEach(group => {
      if (!Array.isArray(group)) return
      group.forEach(person => {
        const staffId = person.staff?.id
        const latestTask = person.tasks?.[0]
        if (staffId && latestTask?.id) {
          nextExpandedMap[`${staffId}_${latestTask.id}`] = true
        }
      })
    })
  }
  allExpandedMap.value = nextExpandedMap
}

async function loadAllPersonalData() {
  const grouped = Object.fromEntries(roleStore.list.map(role => [role.key, []]))
  for (const staff of statsStore.staff) {
    try {
      const res = await api.get(`/stats/personal/${staff.id}`, {
        params: { year: selectedYear.value, quarter: selectedQuarter.value, taskId: effectiveTaskId.value }
      })
      const data = res.data || res || {}
      data.staff = staff
      // REQ-25c: 周期倒序（最新在前）
      if (data.tasks?.length) {
        data.tasks.sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
      }
      const role = normalizeRole(staff.role)
      if (!grouped[role]) grouped[role] = []
      grouped[role].push(data)
    } catch { /* skip */ }
  }
  allPersonalData.value = grouped
  syncCollectiveLatestWeekExpansion()
}

async function switchViewMode(mode) {
  viewMode.value = mode
  if (mode === 'all') {
    await loadAllPersonalData()
  }
}

/** 手风琴面板展开/收起 */
function toggleTask(taskId) {
  const idx = expandedTaskIds.value.indexOf(taskId)
  if (idx === -1) {
    expandedTaskIds.value.push(taskId)
  } else {
    expandedTaskIds.value.splice(idx, 1)
  }
}

/* REQ-25a: 一起查看模式下的折叠状态管理 */
function toggleAllTask(staffId, taskId) {
  const key = `${staffId}_${taskId}`
  allExpandedMap.value[key] = !allExpandedMap.value[key]
}
function isAllExpanded(staffId, taskId) {
  return !!allExpandedMap.value[`${staffId}_${taskId}`]
}

/* ========== Tab 3: 产品聚焦 ========== */
const selectedPmId = ref('')
const pmViewMode = ref('individual')  // 'individual' | 'all'
const allPmFocusData = ref([])
const pmExpandedTaskIds = ref([])
const pmAllExpandedMap = ref({})

/** PM 聚焦信息 */
const pmFocusInfo = computed(() => pmList.value.some(pm => String(pm.id) === String(selectedPmId.value)) ? statsStore.pmFocusData : null)

/** Only current non-resigned attribution PMs with records in the selected scope. */
const pmList = computed(() => {
  const active = new Map(pmStore.activePms.map(pm => [String(pm.id), pm]))
  return (statsStore.pmDistribution || []).filter(item => item.records?.length && active.has(String(item.id)))
    .map(item => active.get(String(item.id)))
})
watch(pmList, people => {
  if (selectedPmId.value && !people.some(pm => String(pm.id) === String(selectedPmId.value))) selectedPmId.value = ''
})

/** 选择产品经理 */
async function selectPm(pmId) {
  selectedPmId.value = pmId
  pmExpandedTaskIds.value = []
  await statsStore.fetchPmFocus(pmId, {
    year: selectedYear.value,
    quarter: selectedQuarter.value,
    taskId: effectiveTaskId.value
  })
  // 默认展开最近一个周期（按 start_date 最新）
  const tasks = statsStore.pmFocusData?.tasks || []
  const tasksWithRecords = tasks.filter(t => t.records?.length > 0)
  if (tasksWithRecords.length > 0) {
    const latest = tasksWithRecords.reduce((a, b) => new Date(a.start_date) > new Date(b.start_date) ? a : b)
    pmExpandedTaskIds.value = [latest.id]
  }
}

/** 切换 PM 查看模式 */
async function switchPmViewMode(mode) {
  pmViewMode.value = mode
  if (mode === 'all') {
    await loadAllPmData()
  }
}

/** 加载所有 PM 的聚焦数据 */
async function loadAllPmData() {
  const results = []
  for (const pm of pmList.value) {
    try {
      const res = await api.get(`/stats/pm/${pm.id}`, {
        params: { year: selectedYear.value, quarter: selectedQuarter.value, taskId: effectiveTaskId.value }
      })
      const data = res.data.data || res.data || {}
      // 周期倒序（最新在前）
      if (data.tasks?.length) {
        data.tasks.sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
      }
      if (data.pm) results.push(data)
    } catch { /* skip */ }
  }
  allPmFocusData.value = results
  // 默认展开每个 PM 最近一个有记录的周期
  const newMap = {}
  for (const pmData of results) {
    const pmId = pmData.pm?.id
    if (!pmId) continue
    const tasksWithRecords = (pmData.tasks || []).filter(t => t.records?.length > 0)
    if (tasksWithRecords.length > 0) {
      const latest = tasksWithRecords[0]  // 已经按 start_date 倒序，第一个就是最新
      newMap[`${pmId}_${latest.id}`] = true
    }
  }
  pmAllExpandedMap.value = newMap
}

/** 获取 PM 的 token（用于跳转专属链接） */
function getPmToken(pmId) {
  const pm = pmStore.list.find(p => p.id === pmId)
  return pm?.token || ''
}

/** PM 手风琴面板展开/收起 */
function togglePmTask(taskId) {
  const idx = pmExpandedTaskIds.value.indexOf(taskId)
  if (idx === -1) {
    pmExpandedTaskIds.value.push(taskId)
  } else {
    pmExpandedTaskIds.value.splice(idx, 1)
  }
}

/** PM 一起查看折叠管理 */
function togglePmAllTask(pmId, taskId) {
  const key = `${pmId}_${taskId}`
  pmAllExpandedMap.value[key] = !pmAllExpandedMap.value[key]
}
function isPmAllExpanded(pmId, taskId) {
  return !!pmAllExpandedMap.value[`${pmId}_${taskId}`]
}

/** PM 一起查看 — 展开/收起全部周期 */
const pmAllShowAll = ref({})

function isPmAllShowingAll(pmId) {
  return !!pmAllShowAll.value[pmId]
}

function togglePmAllShowAll(pmId) {
  pmAllShowAll.value[pmId] = !pmAllShowAll.value[pmId]
}

/** 获取 PM 在一起查看中的可见任务列表 */
function getVisiblePmTasks(pmData) {
  const pmId = pmData.pm?.id
  const tasks = pmData.tasks || []
  if (!pmId || tasks.length <= 1 || isPmAllShowingAll(pmId)) {
    return tasks
  }
  // 只显示第一个有记录的（已默认展开的最新周期）
  const expandedKey = Object.keys(pmAllExpandedMap.value).find(k => k.startsWith(`${pmId}_`) && pmAllExpandedMap.value[k])
  if (expandedKey) {
    const expandedTaskId = expandedKey.split('_')[1]
    const found = tasks.find(t => String(t.id) === expandedTaskId)
    return found ? [found] : [tasks[0]]
  }
  return [tasks[0]]
}

/** 个人信息 */
const personalInfo = computed(() => statsStore.personalData)

/** 人员头像首字 */
function getInitial(name) {
  return name ? name.charAt(name.length - 1) : '?'
}

/** 安全解析可能是 JSON 字符串的字段（v1.4.3：过滤数字类型值和数字字符串，仅保留有效人名） */
function isValidPMName(v) {
  if (typeof v !== 'string') return false
  // 过滤数字字符串（如 "16.0"、"8" 等）
  if (!isNaN(v) && v.trim() !== '') return false
  // 过滤空字符串
  if (v.trim() === '') return false
  return true
}

function parseJsonField(val) {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    try {
      let parsed = JSON.parse(val)
      if (typeof parsed === 'string') parsed = JSON.parse(parsed)
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }
  return []
}

/** 格式化产品经理字段 */
function formatPM(val) {
  const arr = parseJsonField(val)
  return arr.length > 0 ? arr.join(', ') : '-'
}

/* ========== v2.0.0: 全量导出 ========== */
function exportStatsData() {
  const records = sortRecordsByCreatedAt(periodRecords.value)
  if (!records.length) { ElMessage.warning('暂无数据可导出'); return }
  const summaryRows = [['范围', '有效已交付/h', '应交付工时/h（工作日×8）', '有效交付率', '加权交付率', '需求填报进度', '进度覆盖']]
  for (const [name, metric] of [['部门', departmentDelivery.value], ...roleStore.list.map(role => [role.name, roleDelivery.value[role.key]])]) {
    summaryRows.push([name, metric?.deliveredHours ?? 0, metric?.standardHours ?? 0, metric?.deliveryRate == null ? '不适用' : String(metric.deliveryRate) + '%', weightedRateText(metric), metric?.requirementProgress == null ? '—' : `${metric.requirementProgress}%`, metric?.progressCoverage == null ? '—' : `${metric.progressCoverage}%`])
  }
  const detailRows = rows => [['人员', '岗位', '版本号', '需求', '填写工时/h', '创建时间'], ...rows.map(record => [record.staff?.name || '-', roleDisplay(record.staff?.role || record.role), hasDeliveryVersion(record) ? record.version : '无版本号', record.requirement_title || '-', Number(record.hours || 0), formatRecordCreatedAt(record.created_at)])]
  const sheets = [
    { name: '交付汇总', data: summaryRows, colWidths: [24, 18, 26, 18, 18, 18, 18] },
    { name: '有效工时（版本及五类）', data: detailRows(records.filter(hasDeliveryVersion)), colWidths: [16, 18, 18, 42, 18, 26] },
    { name: '无版本工时（仅记录）', data: detailRows(records.filter(record => !hasDeliveryVersion(record))), colWidths: [16, 18, 18, 42, 18, 26] },
    { name: '口径说明', data: [['统计范围', selectedPeriodRangeText.value], ['说明', DELIVERY_NOTE], ['日历状态', departmentDelivery.value?.calendarStatus || '待核实']], colWidths: [20, 105] }
  ]
  const filename = '周期统计_' + selectedYear.value + '年' + selectedQuarter.value + '.xlsx'
  const blob = generateAndDownloadExcel({ filename, sheets })
  uploadExcelToServer(blob, { source_page: 'stats', upload_type: 'export', filename }).catch(() => {})
  ElMessage.success('导出成功')
}

</script>

<template>
  <div>
    <!-- v1.4.3: 页面加载中动画 -->
    <div v-if="pageLoading" class="dt-page-loading">
      <div class="dt-page-spinner"></div>
      <p style="margin-top:16px; color:var(--color-text-3); font-size:14px;">正在加载中，请稍后...</p>
    </div>
    <template v-else>
    <div class="dt-page-header flex-between">
      <div>
        <h1 class="dt-page-title">周期统计（季度）｜{{ selectedPeriodRangeText }}</h1>
        <p class="dt-page-description">部门工时趋势与个人贡献分析 · 当前范围：{{ statsScopeTitle }}</p>
      </div>
      <div class="dt-stats-actions">
        <button type="button" class="dt-btn dt-btn-primary dt-btn-sm dt-analysis-open-btn" @click="openWorkloadReportPage('total')">📊 周期数据分析</button>
        <el-button v-if="authStore.hasPermission('btn:stats:export', 'view')" size="small" @click="exportStatsData">📤 导出Excel</el-button>
        <el-button circle @click="loadDeptStats" title="刷新数据" style="font-size:16px;">🔄</el-button>
      </div>
    </div>

    <!-- 年度 / 季度 / 任务周期 三联筛选器（两个 Tab 共享，REQ-12） -->
    <div class="dt-period-filter">
      <div class="dt-period-filter-row">
        <el-select v-model="selectedYear" class="dt-year-select" aria-label="统计年份" style="width:120px;">
          <el-option v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="selectedQuarter" class="dt-quarter-select" aria-label="统计季度" style="width:100px;">
          <el-option v-for="q in quarterOptions" :key="q" :label="q" :value="q" />
        </el-select>
        <el-select v-model="selectedTaskId" class="dt-task-period-select" placeholder="选择任务周期">
          <el-option v-for="t in taskOptions" :key="t.id" :label="t.title" :value="t.id" />
        </el-select>
        <div v-if="visibleQuarterWeeks.length" ref="weekSelectorRef" class="dt-week-selector" aria-label="自然周快捷选择">
          <span class="dt-week-selector-label">自然周</span>
          <button v-if="hasHiddenWeeksLeft" type="button" class="dt-week-nav" title="向左显示更多自然周" aria-label="向左显示更多自然周" @click="shiftWeekWindow(-1)">
            <el-icon><ArrowLeft /></el-icon>
          </button>
          <div class="dt-week-selector-window">
            <button
              v-for="(week, index) in visibleQuarterWeeks"
              :key="week.key"
              type="button"
              class="dt-week-chip"
              :class="{
                'dt-week-chip-active': indicatorWeekKey === week.key,
                'dt-week-chip-disabled': week.state === 'no-task',
                'dt-week-chip-empty': week.state === 'empty'
              }"
              :disabled="week.state !== 'ready'"
              :title="week.state === 'ready' ? `${week.startDate} 至 ${week.endDate}` : week.state === 'empty' ? `${week.startDate} 至 ${week.endDate} 已生成任务，暂无统计数据` : `${week.startDate} 至 ${week.endDate} 暂无收集任务`"
              @click="selectQuarterWeek(week, index)"
            >
              <span>{{ week.label }}</span>
              <i v-if="indicatorWeekKey === week.key" class="dt-week-chip-pointer"></i>
            </button>
          </div>
          <button v-if="hasHiddenWeeksRight" type="button" class="dt-week-nav" title="向右显示更多自然周" aria-label="向右显示更多自然周" @click="shiftWeekWindow(1)">
            <el-icon><ArrowRight /></el-icon>
          </button>
        </div>
      </div>
    </div>

    <!-- 双 Tab 切换 -->
    <el-tabs v-model="activeTab" type="border-card" class="dt-stats-tabs">

      <el-tab-pane label="部门展示" name="department">

        <div class="dt-summary-strip" :style="{ '--delivery-card-count': roleStore.list.length + 1 }">
          <div class="dt-delivery-cards">
            <StatsHoursCard :label="`${filterLabel} · 部门`" :hours="departmentDelivery?.recordedHours" :metric="departmentDelivery" color="#F53F3F" background-color="#effafa" hover-background-color="#e3f6f6" :class="{ 'is-selected-scope': mainDimension === 'total' && !mainStaffId }" @select="selectStatsCard('total')" @view-incomplete="openIncompleteRequirements()" />
            <StatsHoursCard v-for="role in roleStore.list" :key="role.key" :label="role.name" :hours="roleTotals[role.key]" :metric="roleDelivery[role.key]" :color="role.color" :class="{ 'is-selected-scope': mainDimension === role.key && !mainStaffId }" @select="selectStatsCard(role.key)" @view-incomplete="openIncompleteRequirements(role.key)" />
          </div>
          <StatsCountsCard :items="departmentCounts" :caption="`${filterLabel} · 部门统计`" @select="openDepartmentCount" />
        </div>
        <p class="dt-delivery-brief" :title="DELIVERY_NOTE">有版本普通工时及请假、培训、公司会议、出差、团建计入有效交付；普通无版本仅记录。</p>

        <!-- 柱宽固定，面板按每组完整系列数分配可用宽度。 -->
        <div class="dt-department-chart-grid" :style="departmentChartLayout">
          <div class="dt-data-card dt-department-chart-card" data-testid="department-engineering-chart">
            <div class="dt-chart-card-heading">
              <h3>AI研发工时分布 · 按AI产品经理归属人 — {{ filterLabel }}</h3>
              <label class="dt-product-demand-zero-toggle">隐藏零值 <el-switch v-model="hideZeroValueBars" size="small" aria-label="隐藏零值柱状图" /></label>
            </div>
            <ProductHoursChart expandable :rows="engineeringChartRows" :sources="engineeringChartSources" :hide-zero="hideZeroValueBars" :bar-width="CHART_BAR_WIDTH" :bar-gap="chartBarGap" aria-label="AI研发工时按产品经理归属人分布" empty-text="当前范围暂无研发工时" @select="selectEngineeringChartManager" />
          </div>
          <div class="dt-data-card dt-department-chart-card" data-testid="department-product-chart">
            <div class="dt-chart-card-heading">
              <h3>AI产品经理工时分布（按人员与需求方） — {{ filterLabel }}</h3>
              <label class="dt-product-demand-zero-toggle">隐藏零值 <el-switch v-model="hideZeroValueBars" size="small" aria-label="隐藏零值产品柱状图" /></label>
            </div>
            <ProductHoursChart expandable :rows="productManagerChartRows" :sources="productChartSources" :hide-zero="hideZeroValueBars" :bar-width="CHART_BAR_WIDTH" :bar-gap="chartBarGap" @select="selectProductChartManager" />
          </div>
        </div>

        <div class="dt-data-card dt-main-records" data-testid="stats-main-records">
          <el-tabs v-model="mainRecordTab" class="dt-main-record-tabs" data-testid="main-record-tabs">
            <el-tab-pane v-for="tab in mainRecordTabs" :key="tab.key" :name="tab.key" :label="tab.label">
              <div v-if="mainRecordTab === tab.key" :data-record-source="tab.key">
                <div class="dt-main-records-toolbar">
                  <strong>工时明细 · {{ mainScopeLabel }}</strong>
                  <el-select v-if="mainRecordTab === 'engineering'" v-model="mainDimension" size="small" aria-label="明细岗位范围" @change="changeMainDimension">
                    <el-option label="全部非产品经理" value="total" />
                    <el-option v-for="role in mainRecordRoles" :key="role.key" :label="role.name" :value="role.key" />
                  </el-select>
                  <el-select v-model="mainStaffId" size="small" clearable aria-label="明细人员范围" placeholder="全部人员">
                    <el-option v-for="person in mainStaffOptions" :key="person.id" :label="person.name" :value="person.id" />
                  </el-select>
                  <el-button size="small" @click="openMainAnalysis()">查看当前范围分析</el-button>
                </div>
                <div class="dt-main-records-totals" data-testid="main-record-totals">
                  <span>{{ mainScopeRecords.length }} 条记录</span><span>总工时 <strong>{{ mainScopeDelivery?.recordedHours ?? '—' }}h</strong></span>
                  <span :title="deliveryMetricTip(mainScopeDelivery, 'deliveredHours')">有效已交付 <strong>{{ mainScopeDelivery?.deliveredHours ?? '—' }}h</strong></span>
                  <span>无版本工时 <strong>{{ mainScopeDelivery?.unversionedHours ?? '—' }}h</strong></span>
                </div>
                <StatsGroupedRecordTable :rows="mainRecordRows" :max-height="560" />
              </div>
            </el-tab-pane>
          </el-tabs>
        </div>
      </el-tab-pane>

      <el-tab-pane label="研发聚焦" name="personal">
        <!-- 模式切换按钮 -->
        <div class="dt-focus-mode-toolbar">
          <div class="dt-focus-mode-buttons">
            <button
              :class="['dt-btn', 'dt-btn-sm', viewMode === 'individual' ? 'dt-btn-primary' : 'dt-btn-outline']"
              @click="switchViewMode('individual')"
            >单独查看</button>
            <button
              :class="['dt-btn', 'dt-btn-sm', viewMode === 'all' ? 'dt-btn-primary' : 'dt-btn-outline']"
              @click="switchViewMode('all')"
            >一起查看</button>
          </div>
          <label v-if="viewMode === 'all'" class="dt-focus-collective-toggle">
            <span>集体展开最近一周</span>
            <el-switch
              v-model="expandAllLatestWeek"
              size="small"
              aria-label="集体展开最近一周"
              @change="syncCollectiveLatestWeekExpansion"
            />
          </label>
        </div>

        <!-- ====== 单独查看模式 ====== -->
        <template v-if="viewMode === 'individual'">
          <!-- 人员平铺选择 -->
          <div class="dt-staff-selector">
            <span
              v-for="s in statsStore.staff"
              :key="s.id"
              class="dt-staff-chip"
              :class="{ 'dt-staff-chip-active': selectedStaffId === s.id }"
              @click="selectStaff(s.id)"
            >
              <span class="dt-staff-dot" :style="{ backgroundColor: roleColor(s.role) }"></span>
              {{ s.name }}
            </span>
            <span v-if="!statsStore.staff.length" style="font-size:13px; color:var(--color-text-3);">
              暂无人员数据
            </span>
          </div>

          <!-- 未选择人员 -->
          <div v-if="!selectedStaffId" class="dt-empty" style="padding:60px;">
            <div class="dt-empty-icon">👤</div>
            <p class="dt-empty-text">请选择一位研发人员查看个人统计</p>
          </div>

          <!-- 加载中 -->
          <el-skeleton v-else-if="statsStore.personalLoading" :rows="6" animated />

          <!-- 个人数据 -->
          <template v-else-if="personalInfo">
            <!-- 个人概要卡片 -->
            <div class="dt-personal-header" style="margin-top:8px;">
              <div class="dt-personal-avatar" :style="{ background: roleColor(personalInfo.staff?.role) }">
                {{ getInitial(personalInfo.staff?.name) }}
              </div>
              <div class="dt-personal-info">
                <div class="dt-personal-name">
                  {{ personalInfo.staff?.name }}
                  <span class="dt-tag" :style="roleTagStyle(personalInfo.staff?.role)">
                    {{ roleDisplay(personalInfo.staff?.role, true) }}
                  </span>
                </div>
                <DeliverySummary :metric="deliveryFromInfo(personalInfo)" />
              </div>
            </div>

            <!-- 参与任务列表（手风琴） -->
            <div v-if="personalInfo.tasks && personalInfo.tasks.length > 0" class="dt-accordion-list">
              <div
                v-for="task in personalInfo.tasks"
                :key="task.id"
                class="dt-accordion-item"
              >
                <div class="dt-accordion-header" @click="toggleTask(task.id)" :style="{ opacity: task.records.length === 0 ? 0.5 : 1 }">
                  <span class="dt-accordion-arrow" :class="{ 'dt-accordion-arrow-open': expandedTaskIds.includes(task.id) }">▶</span>
                  <span style="font-weight:500; flex:1;">{{ task.title }}</span>
                  <span style="font-size:12px; color:var(--color-text-3); margin-right:12px;">
                    {{ formatTaskPeriod(task) }}
                  </span>
                  <span class="dt-tag dt-tag-gray" style="font-size:11px;">
                    {{ task.records.length > 0 ? task.records.length + ' 条记录' : '暂无记录' }}
                  </span>
                </div>
                <transition name="accordion">
                  <div v-if="expandedTaskIds.includes(task.id)" class="dt-accordion-body">
                    <div v-if="task.records.length === 0" style="padding:16px; text-align:center; color:var(--color-text-3); font-size:13px;">该周期暂无提交记录</div>
                    <el-table v-else :data="sortRecordsByCreatedAt(task.records)" border size="small" style="width:100%;" table-layout="fixed"

                    >
                      <el-table-column type="index" label="#" width="45" align="center" />
                      <el-table-column prop="version" label="版本号" width="100" sortable>
                        <template #default="{ row }">
                          <span style="font-family:var(--font-mono);">{{ row.version || '-' }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="requirement_title" label="需求标题" min-width="180" align="left" header-align="center" show-overflow-tooltip sortable />
                      <el-table-column prop="product_managers" label="AI产品经理" min-width="130" sortable>
                        <template #default="{ row }">
                          <span style="word-break:break-all;">{{ formatPM(row.product_managers) }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="hours" label="工时(小时)" width="100" align="center" sortable
                        :sort-method="(a, b) => parseFloat(a.hours||0) - parseFloat(b.hours||0)"
                      >
                        <template #default="{ row }">
                          <span style="font-weight:700; color:var(--color-primary);">{{ parseFloat(row.hours || 0).toFixed(1) }}</span>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </transition>
              </div>
            </div>

            <div v-else class="dt-empty" style="padding:40px;">
              <div class="dt-empty-icon">📊</div>
              <p class="dt-empty-text">该人员在所选周期暂无提交记录</p>
            </div>
          </template>
        </template>

        <!-- ====== 一起查看模式（REQ-25 优化） ====== -->
        <template v-else>
          <div class="dt-personal-role-grid">
            <!-- AI开发工程师列 -->
            <div>
              <h3 :style="roleSectionHeaderStyle(ROLE_AI_DEV)">{{ roleDisplay(ROLE_AI_DEV) }}</h3>
              <div v-for="(person, pIdx) in allPersonalData.ai_dev" :key="person.staff?.id" class="dt-research-person-group" :style="rolePersonGroupStyle(ROLE_AI_DEV, pIdx)">
                <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--color-bg-2); border-radius:8px; margin-bottom:4px;">
                  <div class="dt-role-avatar" :style="{ background: roleColor(ROLE_AI_DEV) }">{{ getInitial(person.staff?.name) }}</div>
                  <span style="font-weight:600; font-size:13px;">{{ person.staff?.name }}</span>
                </div>
                <DeliverySummary :metric="deliveryFromInfo(person)" />
                <div v-if="person.tasks?.length" style="padding-left:8px;">
                  <div v-for="(task, taskIndex) in person.tasks" :key="task.id" class="dt-research-person-task" :data-latest="taskIndex === 0 ? 'true' : 'false'" :data-expanded="isAllExpanded(person.staff?.id, task.id) ? 'true' : 'false'" style="border-bottom:1px solid var(--color-border-light);">
                    <div
                      style="display:flex; justify-content:space-between; padding:4px 4px; cursor:pointer; font-size:13px;"
                      @click="toggleAllTask(person.staff?.id, task.id)"
                    >
                      <span style="color:var(--color-text-2); display:flex; align-items:center; gap:4px;">
                        <span :style="{ transform: isAllExpanded(person.staff?.id, task.id) ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s', fontSize: '10px', color: 'var(--color-text-4)' }">▶</span>
                        {{ task.title.replace('语音业务线-2026年', '') }}
                      </span>
                      <span style="font-weight:700; color:var(--color-primary); font-size:13px;">{{ task.records.reduce((s,r) => s + parseFloat(r.hours || 0), 0).toFixed(1) }}H</span>
                    </div>
                    <div v-if="isAllExpanded(person.staff?.id, task.id)" class="dt-research-person-task-body" style="padding:4px 8px 8px 20px; font-size:12px; color:var(--color-text-3);">
                      <div v-for="(rec, ri) in sortRecordsByCreatedAt(task.records)" :key="ri" style="display:flex; justify-content:space-between; padding:2px 0;">
                        <span>{{ rec.requirement_title || '-' }}</span>
                        <span style="font-weight:600; color:var(--color-text-2);">{{ rec.hours }}H</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else style="font-size:12px; color:var(--color-text-4); padding:8px;">暂无数据</div>
              </div>
            </div>
            <!-- VOIP工程师列 -->
            <div>
              <h3 :style="roleSectionHeaderStyle(ROLE_VOIP)">{{ roleDisplay(ROLE_VOIP) }}</h3>
              <div v-for="(person, pIdx) in allPersonalData.voip" :key="person.staff?.id" class="dt-research-person-group" :style="rolePersonGroupStyle(ROLE_VOIP, pIdx)">
                <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--color-bg-2); border-radius:8px; margin-bottom:4px;">
                  <div class="dt-role-avatar" :style="{ background: roleColor(ROLE_VOIP) }">{{ getInitial(person.staff?.name) }}</div>
                  <span style="font-weight:600; font-size:13px;">{{ person.staff?.name }}</span>
                </div>
                <DeliverySummary :metric="deliveryFromInfo(person)" />
                <div v-if="person.tasks?.length" style="padding-left:8px;">
                  <div v-for="(task, taskIndex) in person.tasks" :key="task.id" class="dt-research-person-task" :data-latest="taskIndex === 0 ? 'true' : 'false'" :data-expanded="isAllExpanded(person.staff?.id, task.id) ? 'true' : 'false'" style="border-bottom:1px solid var(--color-border-light);">
                    <div
                      style="display:flex; justify-content:space-between; padding:4px 4px; cursor:pointer; font-size:13px;"
                      @click="toggleAllTask(person.staff?.id, task.id)"
                    >
                      <span style="color:var(--color-text-2); display:flex; align-items:center; gap:4px;">
                        <span :style="{ transform: isAllExpanded(person.staff?.id, task.id) ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s', fontSize: '10px', color: 'var(--color-text-4)' }">▶</span>
                        {{ task.title.replace('语音业务线-2026年', '') }}
                      </span>
                      <span style="font-weight:700; color:#00B42A; font-size:13px;">{{ task.records.reduce((s,r) => s + parseFloat(r.hours || 0), 0).toFixed(1) }}H</span>
                    </div>
                    <div v-if="isAllExpanded(person.staff?.id, task.id)" class="dt-research-person-task-body" style="padding:4px 8px 8px 20px; font-size:12px; color:var(--color-text-3);">
                      <div v-for="(rec, ri) in sortRecordsByCreatedAt(task.records)" :key="ri" style="display:flex; justify-content:space-between; padding:2px 0;">
                        <span>{{ rec.requirement_title || '-' }}</span>
                        <span style="font-weight:600; color:var(--color-text-2);">{{ rec.hours }}H</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else style="font-size:12px; color:var(--color-text-4); padding:8px;">暂无数据</div>
              </div>
            </div>
            <!-- AI质量工程师列 -->
            <div>
              <h3 :style="roleSectionHeaderStyle(ROLE_AI_QUALITY)">{{ roleDisplay(ROLE_AI_QUALITY) }}</h3>
              <div v-for="(person, pIdx) in allPersonalData.ai_quality" :key="person.staff?.id" class="dt-research-person-group" :style="rolePersonGroupStyle(ROLE_AI_QUALITY, pIdx)">
                <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--color-bg-2); border-radius:8px; margin-bottom:4px;">
                  <div class="dt-role-avatar" :style="{ background: roleColor(ROLE_AI_QUALITY) }">{{ getInitial(person.staff?.name) }}</div>
                  <span style="font-weight:600; font-size:13px;">{{ person.staff?.name }}</span>
                </div>
                <DeliverySummary :metric="deliveryFromInfo(person)" />
                <div v-if="person.tasks?.length" style="padding-left:8px;">
                  <div v-for="(task, taskIndex) in person.tasks" :key="task.id" class="dt-research-person-task" :data-latest="taskIndex === 0 ? 'true' : 'false'" :data-expanded="isAllExpanded(person.staff?.id, task.id) ? 'true' : 'false'" style="border-bottom:1px solid var(--color-border-light);">
                    <div
                      style="display:flex; justify-content:space-between; padding:4px 4px; cursor:pointer; font-size:13px;"
                      @click="toggleAllTask(person.staff?.id, task.id)"
                    >
                      <span style="color:var(--color-text-2); display:flex; align-items:center; gap:4px;">
                        <span :style="{ transform: isAllExpanded(person.staff?.id, task.id) ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s', fontSize: '10px', color: 'var(--color-text-4)' }">▶</span>
                        {{ task.title.replace('语音业务线-2026年', '') }}
                      </span>
                      <span style="font-weight:700; color:var(--color-primary); font-size:13px;">{{ task.records.reduce((s,r) => s + parseFloat(r.hours || 0), 0).toFixed(1) }}H</span>
                    </div>
                    <div v-if="isAllExpanded(person.staff?.id, task.id)" class="dt-research-person-task-body" style="padding:4px 8px 8px 20px; font-size:12px; color:var(--color-text-3);">
                      <div v-for="(rec, ri) in sortRecordsByCreatedAt(task.records)" :key="ri" style="display:flex; justify-content:space-between; padding:2px 0;">
                        <span>{{ rec.requirement_title || '-' }}</span>
                        <span style="font-weight:600; color:var(--color-text-2);">{{ rec.hours }}H</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else style="font-size:12px; color:var(--color-text-4); padding:8px;">暂无数据</div>
              </div>
            </div>
            <div v-for="role in additionalRoles" :key="role.key">
              <h3 :style="roleSectionHeaderStyle(role.key)">{{ role.name }}</h3>
              <div v-for="(person, pIdx) in (allPersonalData[role.key] || [])" :key="person.staff?.id" class="dt-research-person-group" :style="rolePersonGroupStyle(role.key, pIdx)">
                <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--color-bg-2); border-radius:8px; margin-bottom:4px;">
                  <div class="dt-role-avatar" :style="{ background: role.color }">{{ getInitial(person.staff?.name) }}</div>
                  <span style="font-weight:600; font-size:13px;">{{ person.staff?.name }}</span>
                </div>
                <DeliverySummary :metric="deliveryFromInfo(person)" />
                <div v-if="person.tasks?.length" style="padding-left:8px;">
                  <div v-for="(task, taskIndex) in person.tasks" :key="task.id" class="dt-research-person-task" :data-latest="taskIndex === 0 ? 'true' : 'false'" :data-expanded="isAllExpanded(person.staff?.id, task.id) ? 'true' : 'false'" style="border-bottom:1px solid var(--color-border-light);">
                    <div style="display:flex; justify-content:space-between; padding:4px; cursor:pointer; font-size:13px;" @click="toggleAllTask(person.staff?.id, task.id)">
                      <span style="color:var(--color-text-2); display:flex; align-items:center; gap:4px;">
                        <span :style="{ transform: isAllExpanded(person.staff?.id, task.id) ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s', fontSize: '10px', color: 'var(--color-text-4)' }">▶</span>
                        {{ task.title.replace('语音业务线-2026年', '') }}
                      </span>
                      <span :style="{ fontWeight: 700, color: role.color, fontSize: '13px' }">{{ task.records.reduce((sum, record) => sum + parseFloat(record.hours || 0), 0).toFixed(1) }}H</span>
                    </div>
                    <div v-if="isAllExpanded(person.staff?.id, task.id)" class="dt-research-person-task-body" style="padding:4px 8px 8px 20px; font-size:12px; color:var(--color-text-3);">
                      <div v-for="(record, recordIndex) in sortRecordsByCreatedAt(task.records)" :key="recordIndex" style="display:flex; justify-content:space-between; padding:2px 0;">
                        <span>{{ record.requirement_title || '-' }}</span>
                        <span style="font-weight:600; color:var(--color-text-2);">{{ record.hours }}H</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else style="font-size:12px; color:var(--color-text-4); padding:8px;">暂无数据</div>
              </div>
            </div>
          </div>
        </template>
      </el-tab-pane>

      <!-- ===== Tab 3: AI产品经理聚焦 ===== -->
      <el-tab-pane label="产品经理聚焦" name="product">
        <!-- 模式切换按钮 -->
        <div style="display:flex; gap:8px; margin-bottom:16px;">
          <button
            :class="['dt-btn', 'dt-btn-sm', pmViewMode === 'individual' ? 'dt-btn-pm-active' : 'dt-btn-outline']"
            @click="switchPmViewMode('individual')"
          >单独查看</button>
          <button
            :class="['dt-btn', 'dt-btn-sm', pmViewMode === 'all' ? 'dt-btn-pm-active' : 'dt-btn-outline']"
            @click="switchPmViewMode('all')"
          >一起查看</button>
        </div>

        <!-- ====== 单独查看模式 ====== -->
        <template v-if="pmViewMode === 'individual'">
          <!-- PM 选择器 -->
          <div class="dt-staff-selector">
            <span
              v-for="pm in pmList"
              :key="pm.id"
              class="dt-pm-chip"
              :class="{ 'dt-pm-chip-active': selectedPmId === pm.id }"
              @click="selectPm(pm.id)"
            >
              <span class="dt-pm-dot"></span>
              {{ pm.name }}
            </span>
            <span v-if="!pmList.length" style="font-size:13px; color:var(--color-text-3);">
              暂无AI产品经理数据
            </span>
          </div>

          <!-- 未选择 PM -->
          <div v-if="!selectedPmId" class="dt-empty" style="padding:60px;">
            <div class="dt-empty-icon">📦</div>
            <p class="dt-empty-text">请选择一位AI产品经理查看聚焦统计</p>
          </div>

          <!-- 加载中 -->
          <el-skeleton v-else-if="statsStore.pmFocusLoading" :rows="6" animated />

          <!-- PM 数据 -->
          <template v-else-if="pmFocusInfo?.pm">
            <!-- PM 概要卡片 -->
            <div class="dt-personal-header dt-pm-header" style="margin-top:8px;">
              <div class="dt-personal-avatar" :style="{ background: PM_THEME_COLOR }">
                {{ getInitial(pmFocusInfo.pm?.name) }}
              </div>
              <div class="dt-personal-info">
                <div class="dt-personal-name">
                  {{ pmFocusInfo.pm?.name }}
                  <span class="dt-tag dt-tag-purple">AI产品经理</span>
                </div>
                <DeliverySummary :metric="deliveryFromInfo(pmFocusInfo)" />
              </div>
            </div>

            <!-- 参与任务列表（手风琴） -->
            <div v-if="pmFocusInfo.tasks && pmFocusInfo.tasks.length > 0" class="dt-accordion-list">
              <div
                v-for="task in pmFocusInfo.tasks"
                :key="task.id"
                class="dt-accordion-item"
              >
                <div class="dt-accordion-header" @click="togglePmTask(task.id)" :style="{ opacity: task.records.length === 0 ? 0.5 : 1 }">
                  <span class="dt-accordion-arrow" :class="{ 'dt-accordion-arrow-open': pmExpandedTaskIds.includes(task.id) }">▶</span>
                  <span style="font-weight:500; flex:1;">{{ task.title }}</span>
                  <span style="font-size:12px; color:var(--color-text-3); margin-right:12px;">
                    {{ formatTaskPeriod(task) }}
                  </span>
                  <span class="dt-tag dt-tag-gray" style="font-size:11px;">
                    {{ task.records.length > 0 ? task.records.length + ' 条记录' : '暂无记录' }}
                  </span>
                </div>
                <transition name="accordion">
                  <div v-if="pmExpandedTaskIds.includes(task.id)" class="dt-accordion-body">
                    <div v-if="task.records.length === 0" style="padding:16px; text-align:center; color:var(--color-text-3); font-size:13px;">该周期暂无提交记录</div>
                    <el-table v-else :data="sortRecordsByCreatedAt(task.records)" border size="small" style="width:100%;" table-layout="fixed"

                    >
                      <el-table-column type="index" label="#" width="45" align="center" />
                      <el-table-column prop="version" label="版本号" width="100" sortable>
                        <template #default="{ row }">
                          <span style="font-family:var(--font-mono);">{{ row.version || '-' }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="requirement_title" label="需求标题" min-width="180" align="left" header-align="center" show-overflow-tooltip sortable />
                      <el-table-column prop="staffName" label="人员" width="100" align="center" sortable />
                      <el-table-column prop="role" label="角色" width="80" align="center" sortable>
                        <template #default="{ row }">
                          <span v-if="row.role && row.role !== '-'"
                            :style="rolePillStyle(row.role)"
                          >{{ roleDisplay(row.role, true) }}</span>
                          <span v-else style="color:var(--color-text-4);">-</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="hours" label="工时(小时)" width="120" align="center" sortable
                        :sort-method="(a, b) => parseFloat(a.hours||0) - parseFloat(b.hours||0)"
                      >
                        <template #default="{ row }">
                          <div class="hours-cell" :class="MEDAL_CLASS[getMedalRank(task.records, row.hours)] || ''">
                            <span class="hours-val">{{ parseFloat(row.hours || 0).toFixed(1) }}</span>
                            <span v-if="getMedalRank(task.records, row.hours) >= 0" class="medal-badge">
                              {{ MEDAL_EMOJI[getMedalRank(task.records, row.hours)] }}
                            </span>
                          </div>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </transition>
              </div>
            </div>

            <div v-else class="dt-empty" style="padding:40px;">
              <div class="dt-empty-icon">📊</div>
              <p class="dt-empty-text">该AI产品经理在所选周期暂无相关工时记录</p>
            </div>
          </template>
        </template>

        <!-- ====== 一起查看模式 ====== -->
        <template v-else>
          <div v-if="allPmFocusData.length === 0" class="dt-empty" style="padding:60px;">
            <div class="dt-empty-icon">📦</div>
            <p class="dt-empty-text">暂无AI产品经理数据</p>
          </div>
          <div v-else class="dt-pm-all-grid">
            <div
              v-for="pmData in allPmFocusData"
              :key="pmData.pm?.id"
              class="dt-pm-all-card"
            >
              <!-- PM 头部 -->
              <div class="dt-pm-all-card-header">
                <div style="width:32px; height:32px; border-radius:50%; background:#722ED1; color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600;">{{ getInitial(pmData.pm?.name) }}</div>
                <div style="flex:1; min-width:0;">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-weight:600; font-size:14px;">{{ pmData.pm?.name }}</span>
                  </div>
                </div>
                <router-link
                  v-if="getPmToken(pmData.pm?.id)"
                  :to="{ path: `/pm/view/${getPmToken(pmData.pm?.id)}`, query: { year: selectedYear, quarter: 0, month: 0 } }"
                  target="_blank"
                  class="dt-pm-view-all-btn"
                >查看全部 →</router-link>
              </div>
              <!-- 任务周期列表 -->
              <DeliverySummary :metric="deliveryFromInfo(pmData)" />
              <div v-if="pmData.tasks?.length" class="dt-pm-all-card-body">
                <div v-for="task in getVisiblePmTasks(pmData)" :key="task.id" style="margin-bottom:2px;">
                  <div
                    class="dt-pm-all-task-header"
                    @click="togglePmAllTask(pmData.pm?.id, task.id)"
                  >
                    <span style="color:var(--color-text-2); display:flex; align-items:center; gap:4px; flex:1; min-width:0;">
                      <span :style="{ transform: isPmAllExpanded(pmData.pm?.id, task.id) ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s', fontSize: '10px', color: 'var(--color-text-4)' }">▶</span>
                      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{{ task.title.replace('语音业务线-2026年', '') }}</span>
                    </span>
                    <span style="font-weight:700; color:#722ED1; font-size:12px; flex-shrink:0;">{{ task.records.reduce((s,r) => s + parseFloat(r.hours || 0), 0).toFixed(1) }}H</span>
                  </div>
                  <!-- 展开后用表格展示，含金银铜 -->
                  <div v-if="isPmAllExpanded(pmData.pm?.id, task.id)" style="padding:0 4px 8px;">
                    <el-table
                      :data="sortRecordsByCreatedAt(task.records)"
                      border size="small"
                      style="width:100%;"
                      table-layout="fixed"

                    >
                      <el-table-column type="index" label="#" width="32" align="center" />
                      <el-table-column prop="version" label="版本" width="65" sortable>
                        <template #default="{ row }">
                          <span style="font-family:monospace; font-size:11px; white-space:nowrap;">{{ row.version || '-' }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="requirement_title" label="需求标题" min-width="140" align="left" header-align="center" show-overflow-tooltip sortable />
                      <el-table-column prop="staffName" label="人员" width="65" align="center" sortable />
                      <el-table-column prop="role" label="角色" width="55" align="center" sortable>
                        <template #default="{ row }">
                          <span v-if="row.role && row.role !== '-'"
                            :style="rolePillStyle(row.role, true)"
                          >{{ roleDisplay(row.role, true) }}</span>
                          <span v-else style="color:#C9CDD4;">-</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="hours" label="工时" width="80" align="center" sortable
                        :sort-method="(a, b) => parseFloat(a.hours||0) - parseFloat(b.hours||0)"
                      >
                        <template #default="{ row }">
                          <div class="hours-cell" :class="MEDAL_CLASS[getMedalRank(task.records, row.hours)] || ''">
                            <span class="hours-val">{{ parseFloat(row.hours || 0).toFixed(1) }}</span>
                            <span v-if="getMedalRank(task.records, row.hours) >= 0" class="medal-badge">
                              {{ MEDAL_EMOJI[getMedalRank(task.records, row.hours)] }}
                            </span>
                          </div>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </div>
                <!-- 展开全部周期 / 收起 按钮 -->
                <div
                  v-if="pmData.tasks.length > 1 && !isPmAllShowingAll(pmData.pm?.id)"
                  class="dt-pm-expand-bar"
                  @click="togglePmAllShowAll(pmData.pm?.id)"
                >
                  <span>展开全部周期（{{ pmData.tasks.length }}个）▼</span>
                </div>
                <div
                  v-if="pmData.tasks.length > 1 && isPmAllShowingAll(pmData.pm?.id)"
                  class="dt-pm-collapse-bar"
                  @click="togglePmAllShowAll(pmData.pm?.id)"
                >
                  <span>▲ 收起</span>
                </div>
              </div>
              <div v-else style="font-size:12px; color:var(--color-text-4); padding:12px; text-align:center;">暂无数据</div>
            </div>
          </div>
        </template>
      </el-tab-pane>
    </el-tabs>

    <DepartmentPeopleDialog v-model="departmentPeopleVisible" :people="departmentPeople" :scope-label="statsScopeTitle" />
    <IncompleteRequirementsDialog v-model="incompleteDialogVisible" :scope-label="incompleteScope.label" :rows="incompleteRows" />
    <el-dialog v-model="analysisDialogVisible" :title="analysisDialogTitle" width="92%" top="4vh" class="dt-delivery-dialog" @opened="measureAnalysisTable">
      <div class="dt-analysis-spotlight" :class="{ 'is-custom-period': analysisRecordScope === 'custom' }" data-testid="analysis-spotlight" v-loading="analysisUsesRemoteScope && statsStore.progressDetailsLoading">
      <section class="dt-delivery-dialog-summary">
        <h3>{{ analysisScopeLabel }}<span>{{ analysisPeriodModeLabel }}</span></h3>
        <DeliverySummary :metric="deliveryDialogSummary" :unversioned="analysisShowsUnversioned" show-expected-hours show-weighted compact-labels :all-periods="analysisRecordScope === 'all'" :period-label="analysisRecordScope === 'custom' ? '所选周期' : ''" />
        <DeliveryStatusNotice v-if="!analysisShowsUnversioned" :metric="deliveryDialogSummary" @view-incomplete="openIncompleteRequirements('', true)" />
        <div class="dt-analysis-inline-kpis">
          <button type="button" :title="deliveryMetricTip(deliveryDialogSummary, 'recordedHours')" @click="openProgressList()">总工时 <strong>{{ analysisData.total.toFixed(1) }}h</strong></button>
          <button type="button" title="当前范围已保存记录数，按来源和记录ID去重，包含五类和普通无版本记录。" @click="openProgressList()">记录 <strong>{{ analysisData.recordCount }}</strong></button>
          <button type="button" title="当前范围按周期、版本、标题去重的普通需求数量，不包含请假、培训、公司会议、出差、团建。" @click="analysisActiveTab = 'requirement'">需求 <strong>{{ analysisData.requirementCount }}</strong></button>
          <button type="button" title="当前筛选范围内可见的收集周期数量。" @click="analysisActiveTab = 'task'">收集任务 <strong>{{ analysisData.taskCount }}</strong></button>
        </div>
        <p :title="DELIVERY_NOTE">有版本普通工时及五类工时计入有效交付；普通无版本仅记录。</p>
      </section>
      <section class="dt-analysis-people" data-testid="analysis-people">
        <div class="dt-analysis-people-heading"><h3>{{ analysisShowsUnversioned ? '无版本号记录' : '人员交付情况' }}</h3><span v-if="!analysisShowsUnversioned">{{ analysisData.staffRows.length }} 人 · 工时单位 h</span></div>
        <StaffDeliveryList v-if="!analysisShowsUnversioned" :people="analysisData.staffRows" :max-rows="20" />
        <p v-else class="dt-analysis-record-only">无版本号仅记录工时，不计交付率。下方列表可查看、排序和导出记录。</p>
      </section>
      </div>
      <div class="dt-delivery-toolbar">
        <el-select v-model="analysisRecordScope" size="small" style="width:115px" aria-label="记录周期范围" @change="changeDeliveryScope">
          <el-option label="当前周期" value="current" /><el-option label="其他周期" value="custom" /><el-option label="全部周期" value="all" />
        </el-select>
        <template v-if="analysisRecordScope === 'custom'">
          <el-select v-model="analysisCustomYear" size="small" style="width:100px" aria-label="弹窗统计年份" @change="changeAnalysisCustomPeriod"><el-option v-for="year in analysisCustomYears" :key="year" :label="`${year}年`" :value="year" /></el-select>
          <el-select v-model="analysisCustomQuarter" size="small" style="width:95px" aria-label="弹窗统计季度" @change="changeAnalysisCustomPeriod"><el-option label="全年" value="all" /><el-option v-for="quarter in quarterOptions" :key="quarter" :label="quarter" :value="quarter" /></el-select>
          <el-select v-model="analysisCustomTaskId" size="small" style="width:210px" aria-label="弹窗具体周期" @change="changeDeliveryScope"><el-option label="范围内所有周期" value="all" /><el-option v-for="task in analysisCustomTasks" :key="task.id" :label="task.title" :value="task.id" /></el-select>
        </template>
        <span class="dt-analysis-current-scope">{{ analysisPeriodRangeText }} · {{ analysisScopeLabel }}</span>
        <el-button v-if="analysisUsesRemoteScope" size="small" plain :loading="statsStore.progressDetailsLoading" @click="changeDeliveryScope">刷新</el-button>
        <el-button size="small" plain @click="downloadProgressDetails(analysisRecordScope, analysisExportVersion())">导出 Excel</el-button>
        <el-button size="small" type="primary" plain @click="openWorkloadReportPage(analysisDimension)">{{ analysisUsesRemoteScope || analysisStaffId ? '打开页面周期完整报告' : '打开完整报告页' }}</el-button>
      </div>
      <div class="dt-analysis-role-pills">
        <button v-for="role in analysisRoleRows" :key="role.key" type="button" :style="{ color: role.color }" @click="openProgressList(role.key)">{{ role.label }} <strong>{{ role.hours.toFixed(1) }}h</strong></button>
      </div>
      <div ref="analysisDetailsRef" class="dt-analysis-details">
      <el-tabs v-model="analysisActiveTab" class="dt-restored-analysis-tabs" v-loading="analysisUsesRemoteScope && statsStore.progressDetailsLoading">
        <el-tab-pane label="总览" name="overview">
          <div class="dt-analysis-overview">
            <div class="dt-analysis-findings"><h4>核心解读</h4><ul>
              <li>{{ analysisData.recordCount }} 条记录、{{ analysisData.requirementCount }} 个需求、{{ analysisData.taskCount }} 个周期。</li>
              <li>{{ analysisRoleSummaryText }}</li>
              <li>平均单条 {{ analysisData.avgRecordHours.toFixed(1) }}h，平均单需求 {{ analysisData.avgRequirementHours.toFixed(1) }}h。</li>
              <li v-if="analysisTopRows.period">峰值周期：{{ analysisTopRows.period.label }}，{{ analysisTopRows.period.total }}h。</li>
            </ul></div>
            <div class="dt-analysis-findings"><h4>重点维度</h4><ul>
              <li v-if="analysisTopRows.pm">AI产品经理最高：{{ analysisTopRows.pm.label }}，{{ analysisTopRows.pm.total }}h / {{ analysisTopRows.pm.share }}%。</li>
              <li v-if="analysisTopRows.staff">人员最高：{{ analysisTopRows.staff.label }}，{{ analysisTopRows.staff.total }}h / {{ analysisTopRows.staff.share }}%。</li>
              <li v-if="analysisTopRows.requirement">需求最高：{{ analysisTopRows.requirement.label }}，{{ analysisTopRows.requirement.total }}h / {{ analysisTopRows.requirement.share }}%。</li>
              <li v-if="analysisTopRows.combo">协作形态最高：{{ analysisTopRows.combo.combo }}，{{ analysisTopRows.combo.total }}h / {{ analysisTopRows.combo.share }}%。</li>
            </ul></div>
          </div>
          <div class="dt-analysis-mini-bars"><div v-for="role in analysisRoleRows" :key="role.key" class="dt-analysis-mini-bar"><span>{{ role.label }}</span><div><i :style="{ width: `${role.share}%`, background: role.color }"></i></div><strong>{{ role.hours.toFixed(1) }}h</strong></div></div>
        </el-tab-pane>
        <el-tab-pane label="人员" name="staff">
          <el-table :data="pagedAnalysisRows('staff', analysisData.staffRows)" row-key="staffId" border size="small" class="dt-staff-delivery-table" :default-sort="analysisSorts.staff" @sort-change="changeAnalysisSort('staff', $event)" :max-height="analysisTableHeight" empty-text="当前范围暂无应交付人员">
            <el-table-column prop="label" label="人员" min-width="170" show-overflow-tooltip sortable="custom" />
            <el-table-column prop="standardHours" label="应交付工时/h" min-width="135" align="right" sortable="custom"><template #default="{ row }">
              <span :title="deliveryMetricTip(row, 'standardHours')">{{ row.calendarStatus === 'invalid_period' ? '—' : row.standardHours }}</span>
            </template></el-table-column>
            <el-table-column prop="deliveredHours" label="有效已交付/h" min-width="135" align="right" sortable="custom"><template #default="{ row }"><span :title="deliveryMetricTip(row, 'deliveredHours')">{{ row.deliveredHours }}</span></template></el-table-column>
            <el-table-column prop="deliveryRate" label="有效交付率" width="115" align="right" sortable="custom"><template #default="{ row }">
              <span :class="{ 'dt-staff-delivery-complete': row.deliveryRate != null && row.deliveryRate >= 100 }" :title="deliveryMetricTip(row, 'deliveryRate')">{{ row.deliveryRate == null ? '—' : `${row.deliveryRate}%` }}</span>
            </template></el-table-column>
            <el-table-column prop="weightedDeliveryRate" label="加权交付率" width="120" align="right" sortable="custom"><template #default="{ row }"><span :title="deliveryMetricTip(row, 'weightedDeliveryRate')" :class="{ 'dt-staff-delivery-complete': row.weightedDeliveryRate != null && row.weightedDeliveryRate >= 100 }">{{ weightedRateText(row) }}</span></template></el-table-column>
            <el-table-column prop="requirementProgress" label="需求填报进度" width="125" align="right" sortable="custom"><template #default="{ row }"><span :title="deliveryMetricTip(row, 'requirementProgress')">{{ requirementProgressText(row) }}</span></template></el-table-column>
            <el-table-column prop="total" label="已填总工时/h" min-width="130" align="right" sortable="custom" />
            <el-table-column prop="share" label="工时占比" width="110" align="right" sortable="custom"><template #default="{ row }">{{ row.share }}%</template></el-table-column>
            <el-table-column prop="recordCount" label="记录数" width="95" sortable="custom" />
            <el-table-column prop="taskCount" label="周期数" width="90" sortable="custom" />
            <el-table-column prop="requirementCount" label="需求数" width="90" sortable="custom" />
          </el-table>
          <el-pagination v-model:current-page="analysisPagination.staff.currentPage" v-model:page-size="analysisPagination.staff.pageSize" class="dt-analysis-pagination" :page-sizes="ANALYSIS_PAGE_SIZE_OPTIONS" :total="analysisData.staffRows.length" layout="total, sizes, prev, pager, next, jumper" @size-change="resetAnalysisPage('staff')" />
        </el-tab-pane>
        <el-tab-pane label="工时记录" name="records">
          <el-radio-group v-model="analysisVersionType" size="small" class="dt-analysis-version-filter" aria-label="版本分类">
            <el-radio-button value="all">全部记录</el-radio-button><el-radio-button value="versioned">有效工时</el-radio-button><el-radio-button value="noVersion">普通无版本（仅记录）</el-radio-button>
          </el-radio-group>
          <StatsRecordTable :max-height="analysisTableHeight" external-sort :sort-state="analysisSorts.records" @sort-change="changeAnalysisSort('records', $event)" :rows="pagedAnalysisRows('records', analysisRawRows)" :tasks="analysisScopeTasks" :record-only="analysisVersionType === 'noVersion'" />
          <el-pagination v-model:current-page="analysisPagination.records.currentPage" v-model:page-size="analysisPagination.records.pageSize" class="dt-analysis-pagination" :page-sizes="ANALYSIS_PAGE_SIZE_OPTIONS" :total="analysisRawRows.length" layout="total, sizes, prev, pager, next, jumper" @size-change="resetAnalysisPage('records')" />
        </el-tab-pane>
        <el-tab-pane label="全部追踪和进度" name="tracking">
          <StatsRecordTable :max-height="analysisTableHeight" external-sort :sort-state="analysisSorts.tracking" @sort-change="changeAnalysisSort('tracking', $event)" :rows="pagedAnalysisRows('tracking', analysisTrackingRows)" :tasks="analysisScopeTasks" />
          <el-pagination v-model:current-page="analysisPagination.tracking.currentPage" v-model:page-size="analysisPagination.tracking.pageSize" class="dt-analysis-pagination" :page-sizes="ANALYSIS_PAGE_SIZE_OPTIONS" :total="analysisTrackingRows.length" layout="total, sizes, prev, pager, next, jumper" @size-change="resetAnalysisPage('tracking')" />
        </el-tab-pane>
        <el-tab-pane v-for="tab in analysisProgressTabs.filter(tab => tab.key !== 'progress')" :key="tab.key" :label="tab.label" :name="tab.key">
          <p v-if="tab.key === 'noVersion'" class="dt-analysis-tab-note">无版本号仅记录工时，不计交付率。</p>
          <StatsProgressTable :max-height="analysisTableHeight" external-sort :sort-state="analysisSorts[tab.key]" @sort-change="changeAnalysisSort(tab.key, $event)" :rows="pagedAnalysisRows(tab.key, tab.rows)" :tasks="analysisScopeTasks" :record-only="tab.key === 'noVersion'" />
          <el-pagination v-model:current-page="analysisPagination[tab.key].currentPage" v-model:page-size="analysisPagination[tab.key].pageSize" class="dt-analysis-pagination" :page-sizes="ANALYSIS_PAGE_SIZE_OPTIONS" :total="tab.rows.length" layout="total, sizes, prev, pager, next, jumper" @size-change="resetAnalysisPage(tab.key)" />
        </el-tab-pane>
        <el-tab-pane v-for="tab in analysisGroupTabs" :key="tab.key" :label="tab.label" :name="tab.key">
          <el-table :data="pagedAnalysisRows(tab.key, tab.rows)" :default-sort="analysisSorts[tab.key]" @sort-change="changeAnalysisSort(tab.key, $event)" border size="small" :max-height="analysisTableHeight" empty-text="当前范围暂无数据">
            <el-table-column prop="label" :label="tab.label === '数据质量' ? '检查项' : tab.label" min-width="180" show-overflow-tooltip sortable="custom" />
            <el-table-column v-if="tab.weeks" prop="weeks" sortable="custom" label="周" width="120"><template #default="{ row }">{{ row.weeks?.join('、') || '-' }}</template></el-table-column>
            <el-table-column prop="total" :label="tab.key === 'keyword' ? '命中工时/h' : '工时/h'" width="110" align="right" sortable="custom" />
            <el-table-column prop="share" label="工时占比" width="110" sortable="custom"><template #default="{ row }">{{ row.share }}%</template></el-table-column>
            <template v-if="tab.roles"><el-table-column v-for="role in analysisRoleMeta.filter(item => showAnalysisRole(item.key))" :key="role.key" :prop="role.key" :label="role.label" min-width="100" sortable="custom" /></template>
            <el-table-column prop="recordCount" label="记录数" width="95" sortable="custom" />
            <el-table-column v-if="tab.tasks" prop="taskCount" label="周期数" width="90" sortable="custom" />
            <el-table-column v-if="tab.requirements" prop="requirementCount" label="需求数" width="90" sortable="custom" />
          </el-table>
          <el-pagination v-model:current-page="analysisPagination[tab.key].currentPage" v-model:page-size="analysisPagination[tab.key].pageSize" class="dt-analysis-pagination" :page-sizes="ANALYSIS_PAGE_SIZE_OPTIONS" :total="tab.rows.length" layout="total, sizes, prev, pager, next, jumper" @size-change="resetAnalysisPage(tab.key)" />
          <p v-if="tab.key === 'keyword'" class="dt-analysis-tab-note">关键词匹配需求名称和版本，同一记录可命中多个关键词，仅用于识别特征。</p>
        </el-tab-pane>
        <el-tab-pane label="需求进度" name="progress">
          <StatsProgressTable :max-height="analysisTableHeight" external-sort :sort-state="analysisSorts.progress" @sort-change="changeAnalysisSort('progress', $event)" :rows="pagedAnalysisRows('progress', analysisData.progressRows)" :tasks="analysisScopeTasks" />
          <el-pagination v-model:current-page="analysisPagination.progress.currentPage" v-model:page-size="analysisPagination.progress.pageSize" class="dt-analysis-pagination" :page-sizes="ANALYSIS_PAGE_SIZE_OPTIONS" :total="analysisData.progressRows.length" layout="total, sizes, prev, pager, next, jumper" @size-change="resetAnalysisPage('progress')" />
        </el-tab-pane>
      </el-tabs>
      </div>
    </el-dialog>
    <el-dialog v-model="progressListDialogVisible" :title="progressListTitle" width="90%" top="7vh" append-to-body>
      <div class="dt-delivery-toolbar"><span class="dt-analysis-current-scope">{{ analysisPeriodRangeText }}</span><el-button size="small" plain @click="downloadProgressDetails(analysisRecordScope, progressListVersionType, progressListRoleKey)">导出 Excel</el-button></div>
      <StatsProgressTable external-sort :sort-state="analysisSorts.progressModal" @sort-change="changeAnalysisSort('progressModal', $event)" :rows="pagedAnalysisRows('progressModal', progressListRows)" :tasks="analysisScopeTasks" :record-only="progressListVersionType === 'noVersion'" />
      <el-pagination v-model:current-page="analysisPagination.progressModal.currentPage" v-model:page-size="analysisPagination.progressModal.pageSize" class="dt-analysis-pagination" :page-sizes="ANALYSIS_PAGE_SIZE_OPTIONS" :total="progressListRows.length" layout="total, sizes, prev, pager, next, jumper" @size-change="resetAnalysisPage('progressModal')" />
    </el-dialog>

    </template>
    <Teleport to="body">
      <button
        v-show="showBackTop"
        type="button"
        class="dt-stats-backtop"
        title="回到顶部"
        aria-label="回到顶部"
        @click="scrollToStatsTop"
      >
        <el-icon><ArrowUp /></el-icon>
      </button>
    </Teleport>
  </div>
</template>

<style scoped>
.dt-main-record-tabs > :deep(.el-tabs__header) { margin: 0; padding: 0 16px; }
.dt-main-record-tabs > :deep(.el-tabs__content) { overflow: hidden; }
.dt-main-records-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:12px 16px; }
.dt-main-records-toolbar .el-select { width:160px; }
.dt-main-records-toolbar strong { margin-right:auto; font-size:14px; }
.dt-main-records-totals { display:flex; flex-wrap:wrap; gap:6px 18px; padding:0 16px 12px; font-size:12px; color:#667085; }
.dt-main-records .dt-analysis-pagination { padding:0 12px 12px; }
.dt-delivery-card.is-selected-scope { outline:2px solid #165dff; outline-offset:-2px; }
.dt-summary-strip { display: grid; grid-template-columns: repeat(var(--delivery-card-count, 6), minmax(0, 1fr)) 192px; grid-auto-rows: 1fr; align-items: stretch; gap: 8px; margin-bottom: 6px; }
.dt-delivery-cards { display: contents; }
.dt-delivery-cards-product { grid-template-columns: minmax(250px, 330px); }
.dt-delivery-brief { margin: 0 0 10px; color: #86909c; font-size: 11px; line-height: 16px; }
:global(.el-dialog.dt-delivery-dialog) { display: flex; flex-direction: column; height: 92dvh; max-height: 92dvh; max-width: 1500px; border-radius: 12px; overflow: hidden; }
:global(.dt-delivery-dialog > .el-dialog__header) { flex-shrink: 0; padding-bottom: 12px; }
:global(.dt-delivery-dialog > .el-dialog__body) { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.dt-analysis-spotlight { display: grid; grid-template-columns: minmax(300px, .85fr) minmax(0, 1.4fr); gap: 14px; flex: 0 0 clamp(180px, 25vh, 250px); min-height: 0; margin-bottom: 12px; }
.dt-delivery-dialog-summary { display: flex; flex-direction: column; justify-content: space-between; gap: 10px; padding: 14px 18px; border: 1px solid #dce7f8; border-radius: 9px; background: linear-gradient(125deg, #f1f6ff, #fbfdff); min-width: 0; overflow-y: auto; }
.dt-delivery-dialog-summary h3, .dt-analysis-people h3 { margin: 0; font-size: 14px; color: #1d2939; }
.dt-delivery-dialog-summary h3 { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dt-delivery-dialog-summary h3 span { font-size: 11px; color: #667085; font-weight: 400; white-space: nowrap; }
.dt-delivery-dialog-summary :deep(.delivery-summary) { gap: 10px 8px; flex-shrink: 0; }
.dt-delivery-dialog-summary :deep(.delivery-metric strong) { font-size: clamp(18px, 1.55vw, 26px); }
.dt-delivery-dialog-summary :deep(.delivery-metric > span) { font-size: 11px; }
.dt-delivery-dialog-summary p { margin: 0; color: #667085; font-size: 11px; line-height: 1.5; }
.dt-analysis-people { display: flex; flex-direction: column; min-height: 0; min-width: 0; padding: 10px 14px; border: 1px solid #e4eaf1; border-radius: 9px; background: #fff; overflow: hidden; }
.dt-analysis-people-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 6px; flex-shrink: 0; }
.dt-analysis-people-heading > span { color: #86909c; font-size: 11px; }
.dt-analysis-people :deep(.staff-delivery-list) { flex: 1; min-height: 0; }
.dt-analysis-record-only { color: #86909c; font-size: 12px; line-height: 1.8; }
.dt-analysis-details { flex: 1; min-height: 0; }
.dt-restored-analysis-tabs { display: flex; flex-direction: column; height: 100%; }
.dt-restored-analysis-tabs :deep(.el-tabs__header) { flex-shrink: 0; }
.dt-restored-analysis-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; overflow: hidden; }
.dt-restored-analysis-tabs :deep(.el-tab-pane) { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow-y: auto; }
.dt-restored-analysis-tabs :deep(.el-tab-pane > *) { flex-shrink: 0; }
.dt-restored-analysis-tabs .dt-analysis-pagination { margin: 8px 0 0; }
.dt-delivery-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.dt-delivery-toolbar .el-radio-group { margin-right: auto; }
.dt-analysis-inline-kpis { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; }
.dt-analysis-inline-kpis button { border: 0; padding: 2px 0; background: none; font: inherit; font-size: 12px; color: #667085; cursor: pointer; }
.dt-analysis-inline-kpis strong { font-size: 16px; color: #344054; margin-left: 3px; }
.dt-analysis-current-scope { flex: 1; min-width: 140px; font-size: 12px; color: #667085; }
.dt-analysis-role-pills { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-bottom: 6px; }
.dt-analysis-role-pills button { display: flex; align-items: center; gap: 5px; padding: 3px 8px; border: 1px solid #e4eaf1; border-radius: 5px; background: #fafcff; cursor: pointer; font: inherit; font-size: 11px; }
.dt-analysis-role-pills button:hover, .dt-analysis-inline-kpis button:hover { background: #e8f3ff; }
.dt-analysis-role-pills button:focus-visible, .dt-analysis-inline-kpis button:focus-visible { outline: 2px solid #165dff; outline-offset: 2px; }
.dt-restored-analysis-tabs :deep(.el-tabs__header) { margin-bottom: 8px; }
.dt-restored-analysis-tabs :deep(.el-tabs__nav-wrap), .dt-restored-analysis-tabs :deep(.el-tabs__nav-scroll) { overflow: visible; padding: 0; }
.dt-restored-analysis-tabs :deep(.el-tabs__nav) { display: flex; flex-wrap: wrap; float: none; width: 100%; transform: none !important; white-space: normal; gap: 0 3px; }
.dt-restored-analysis-tabs :deep(.el-tabs__item) { padding: 0 9px !important; height: 32px; font-size: 12px; border-bottom: 2px solid transparent; }
.dt-restored-analysis-tabs :deep(.el-tabs__item.is-active) { border-bottom-color: #165dff; }
.dt-restored-analysis-tabs :deep(.el-tabs__nav-prev), .dt-restored-analysis-tabs :deep(.el-tabs__nav-next), .dt-restored-analysis-tabs :deep(.el-tabs__active-bar), .dt-restored-analysis-tabs :deep(.el-tabs__nav-wrap::after) { display: none; }
.dt-analysis-version-filter { margin-bottom: 8px; }
.dt-analysis-tab-note { margin: 0 0 8px; color: #86909c; font-size: 12px; }
.dt-staff-delivery-complete { color: #146c2e; background: #e8f7ee; padding: 2px 5px; border-radius: 4px; font-weight: 700; }
.dt-restored-analysis-tabs :deep(.el-tab-pane) { min-width: 0; }
.dt-delivery-records { width: 100%; }
@media (max-width: 1580px) {
  .dt-summary-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .dt-delivery-cards-product { grid-template-columns: minmax(250px, 330px); }
  .dt-summary-strip :deep(.delivery-summary.has-compact-labels) { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .dt-summary-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dt-analysis-spotlight { grid-template-columns: minmax(290px, 1fr) minmax(0, 1fr); gap: 8px; }
  .dt-delivery-dialog-summary { padding: 10px; }
  .dt-delivery-dialog-summary :deep(.delivery-metric strong) { font-size: 18px; }
}
@media (max-width: 600px) {
  .dt-summary-strip { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .dt-delivery-cards-product { grid-template-columns: minmax(0, 1fr); }
  .dt-analysis-spotlight { grid-template-columns: minmax(0, 1fr); grid-template-rows: min-content minmax(105px, 1fr); flex-basis: 38vh; overflow-y: auto; gap: 6px; margin-bottom: 8px; }
  .dt-analysis-spotlight.is-custom-period { flex-basis: 34vh; }
  .dt-delivery-dialog-summary { gap: 6px; padding: 8px 10px; }
  .dt-delivery-dialog-summary :deep(.delivery-summary.has-weighted) { gap: 5px 4px; }
  .dt-delivery-dialog-summary :deep(.delivery-metric strong) { font-size: 17px; }
  .dt-analysis-people { padding: 6px 10px; }
  .dt-analysis-people :deep(.staff-delivery-table) { font-size: 11px; }
  .dt-analysis-people :deep(.staff-delivery-table th), .dt-analysis-people :deep(.staff-delivery-table td) { padding: 3px 2px; }
  .dt-analysis-people-heading h3 { font-size: 12px; }
  .dt-delivery-dialog-summary p { font-size: 11px; }
  .dt-restored-analysis-tabs :deep(.el-tabs__nav-scroll) { overflow-x: auto; }
  .dt-restored-analysis-tabs :deep(.el-tabs__nav) { flex-wrap: nowrap; width: max-content; }
  .dt-delivery-toolbar { gap: 6px; margin-bottom: 6px; }
  .dt-delivery-toolbar .el-button { margin-left: 0; }
  .dt-delivery-dialog-summary .dt-analysis-inline-kpis { gap: 2px 10px; }
  .dt-delivery-dialog-summary .dt-analysis-inline-kpis strong { font-size: 13px; }
}
.dt-focus-mode-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 32px;
  margin-bottom: 16px;
}

.dt-focus-mode-buttons,
.dt-focus-collective-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* 统计页签按业务浏览顺序展示：研发视图紧邻产品视图之前。 */
.dt-stats-tabs > :deep(.el-tabs__header .el-tabs__nav) {
  display: flex;
}

.dt-stats-tabs > :deep(.el-tabs__header .el-tabs__item:nth-child(1)) {
  order: 1;
}

.dt-stats-tabs > :deep(.el-tabs__header .el-tabs__item:nth-child(2)) {
  order: 3;
}

.dt-stats-tabs > :deep(.el-tabs__header .el-tabs__item:nth-child(3)) {
  order: 2;
}

.dt-stats-tabs > :deep(.el-tabs__header .el-tabs__item:nth-child(4)) {
  order: 4;
}

.dt-stats-tabs > :deep(.el-tabs__header .el-tabs__item:nth-child(5)) {
  order: 5;
}

.dt-focus-collective-toggle {
  color: var(--color-text-2, #4E5969);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}

.dt-stat-cards.dt-stat-cards-single-row {
  grid-template-columns: repeat(var(--dt-stat-card-count), minmax(0, 1fr));
  gap: 12px;
  overflow-x: hidden;
  overflow-y: hidden;
  padding: 2px 2px 8px;
}

.dt-stat-cards-single-row .dt-stat-card {
  min-width: 0;
  padding: 16px 10px;
  overflow: hidden;
}

.dt-stat-cards-single-row .dt-stat-card-label {
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.5;
  min-height: 36px;
}

.dt-stat-cards-single-row .dt-stat-card-value {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 4px;
  font-size: clamp(20px, 1.5vw, 28px);
  white-space: normal;
  overflow: visible;
}

.dt-stat-cards-single-row .dt-stat-card-label {
  font-size: 12px;
}

.dt-stat-card-progress {
  margin-top: 6px;
  color: var(--color-text-3, #86909C);
  font-size: 11px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.dt-stat-card-progress-value {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
}

.dt-department-chart-grid {
  display: grid;
  grid-template-columns: minmax(0, var(--engineering-chart-width, 2fr)) minmax(0, var(--product-chart-width, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.dt-department-chart-card {
  min-width: 0;
  padding: 12px;
}

.dt-department-chart-card h3 {
  margin: 0 0 16px;
  color: var(--color-text-1);
  font-size: 15px;
  font-weight: 600;
}

.dt-chart-card-heading { min-height: 32px; display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 6px; }
.dt-chart-card-heading h3 { margin-bottom: 0; }
.dt-chart-card-heading h3 { flex: 1 1 220px; margin: 0; }

.dt-product-demand-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.dt-product-demand-note {
  color: var(--color-text-3, #86909C);
  font-size: 12px;
  white-space: nowrap;
}

.dt-product-demand-chart-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.dt-product-demand-zero-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-2, #4E5969);
  font-size: 12px;
  white-space: nowrap;
}

.dt-product-demand-chart {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  min-height: 220px;
  padding: 18px 16px 34px;
  border-bottom: 1px solid var(--color-border, #E5E6EB);
}

.dt-product-demand-group {
  flex: 1;
  min-width: 120px;
  cursor: pointer;
  text-align: center;
  border-radius: 6px;
  padding: 8px 8px 0;
  transition: background-color .2s ease;
}

.dt-product-demand-group:hover,
.dt-product-demand-group.is-selected {
  background: var(--color-primary-light, #E8F3FF);
}

.dt-product-demand-bars {
  height: 170px;
  display: flex;
  justify-content: center;
  align-items: flex-end;
}

.dt-product-demand-bar {
  width: 42px;
  min-height: 0;
  border-radius: 5px 5px 0 0;
  position: relative;
  transition: height .2s ease;
}

.dt-product-demand-bar span {
  position: absolute;
  left: 50%;
  top: -22px;
  transform: translateX(-50%);
  color: var(--color-text-1, #1D2129);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.dt-product-demand-label {
  margin-top: 12px;
  color: var(--color-text-2, #4E5969);
  font-size: 13px;
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .dt-department-chart-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.dt-stats-actions {
  flex: 0 0 auto;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.dt-analysis-open-btn {
  min-width: 116px;
}

.dt-stats-backtop {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid #D8E7FF;
  border-radius: 50%;
  background: linear-gradient(180deg, #FFFFFF 0%, #F6FAFF 100%);
  color: var(--color-primary, #165DFF);
  box-shadow: 0 6px 18px rgba(22, 93, 255, 0.16);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.dt-stats-backtop:hover {
  background: var(--color-primary-light, #E8F3FF);
  color: var(--color-primary-hover, #4080FF);
  box-shadow: 0 10px 24px rgba(22, 93, 255, 0.2);
  transform: translateY(-1px);
}

.dt-stats-backtop:active {
  transform: translateY(0);
}

.dt-stats-backtop .el-icon {
  font-size: 18px;
}

/* === 季度自然周快捷选择 === */
.dt-period-filter {
  margin-bottom: 0;
  overflow: visible;
  padding-bottom: 0;
}

.dt-period-filter-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 16px;
  width: 100%;
  min-width: 0;
}

.dt-task-period-select {
  flex: 0 1 360px;
  width: clamp(220px, 31vw, 400px);
  min-width: 220px;
}

.dt-week-selector {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex: 1 1 240px;
  min-width: 0;
  min-height: 34px;
  padding-left: 2px;
  overflow: hidden;
}

.dt-week-selector-label {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-3, #86909C);
}

.dt-week-selector-window {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
  overflow: visible;
}

.dt-week-nav {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #D8E7FF;
  border-radius: 8px;
  background: linear-gradient(180deg, #FFFFFF 0%, #F6FAFF 100%);
  color: var(--color-primary, #165DFF);
  box-shadow: 0 1px 2px rgba(22, 93, 255, 0.08);
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.dt-week-nav:hover {
  border-color: var(--color-primary-hover, #4080FF);
  background: var(--color-primary-light, #E8F3FF);
  box-shadow: 0 4px 10px rgba(22, 93, 255, 0.14);
  transform: translateY(-1px);
}

.dt-week-nav:active {
  transform: translateY(0);
  box-shadow: 0 1px 3px rgba(22, 93, 255, 0.12);
}

.dt-week-nav .el-icon {
  font-size: 14px;
}

.dt-week-chip {
  position: relative;
  flex: 0 0 48px;
  min-width: 48px;
  height: 30px;
  padding: 0 6px;
  border: 1px solid var(--color-border, #E5E6EB);
  border-radius: 6px;
  background: #fff;
  color: var(--color-text-2, #4E5969);
  font-size: 13px;
  font-weight: 600;
  line-height: 28px;
  text-align: center;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.dt-week-chip:hover:not(:disabled) {
  color: var(--color-primary, #165DFF);
  border-color: var(--color-primary-hover, #4080FF);
  background: var(--color-primary-light, #E8F3FF);
}

.dt-week-chip-active {
  color: var(--color-text-2, #4E5969);
  background: #fff;
  border-color: var(--color-border, #E5E6EB);
  box-shadow: none;
}

.dt-week-chip-pointer {
  position: absolute;
  left: 50%;
  bottom: 1px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid #A9D3FF;
  transform: translateX(-50%);
}

.dt-week-chip-disabled {
  color: var(--color-text-4, #C9CDD4);
  background: var(--color-bg-2, #F7F8FA);
  border-color: var(--color-border-light, #F2F3F5);
  cursor: not-allowed;
}

.dt-week-chip-empty {
  color: var(--color-text-3, #86909C);
  background: #fff;
  border-color: var(--color-primary, #165DFF);
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .dt-period-filter-row {
    gap: 10px;
    flex-wrap: wrap;
  }

  .dt-year-select, .dt-quarter-select { flex-shrink: 0; }
  .dt-week-selector { flex-basis: 100%; justify-content: flex-start; }

  .dt-task-period-select {
    flex-basis: 240px;
    min-width: 200px;
  }
}

/* === 本地周期分析弹窗 === */
.dt-analysis-scope {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  color: var(--color-text-2, #4E5969);
  font-size: 13px;
}

.dt-analysis-scope span {
  padding: 5px 10px;
  border-radius: 6px;
  background: var(--color-bg-2, #F7F8FA);
  border: 1px solid var(--color-border-light, #F2F3F5);
}

.dt-analysis-kpis {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.dt-analysis-kpi {
  min-width: 0;
  padding: 12px 10px;
  border: 1px solid var(--color-border-light, #F2F3F5);
  border-radius: 8px;
  background: #fff;
  text-align: center;
}

.dt-analysis-kpi-clickable {
  cursor: pointer;
  transition: border-color .16s ease, box-shadow .16s ease;
}

.dt-analysis-kpi-clickable:hover {
  box-shadow: 0 0 0 2px rgba(22, 93, 255, .10);
}

.dt-analysis-kpi > span {
  display: block;
  color: var(--color-text-3, #86909C);
  font-size: 12px;
  margin-bottom: 6px;
}

.dt-analysis-kpi > strong {
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-1, #1D2129);
}

.dt-analysis-kpi > em {
  margin-left: 4px;
  font-style: normal;
  color: var(--color-text-3, #86909C);
  font-size: 12px;
}

.dt-analysis-role-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.dt-analysis-role-item {
  display: flex;
  justify-content: center;
  gap: 10px;
  align-items: center;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
  border: 1px solid transparent;
}

.dt-analysis-role-item strong {
  font-size: 16px;
}

.dt-analysis-fe { color: #165DFF; background: #E8F3FF; border-color: #BEDAFF; }
.dt-analysis-be { color: #00B42A; background: #E8FFEA; border-color: #B7F0C0; }
.dt-analysis-qa { color: #FF7D00; background: #FFF7E8; border-color: #FFD9A8; }

:deep(.el-table th),
:deep(.el-table td),
:deep(.el-table th .cell),
:deep(.el-table td .cell) {
  text-align: center;
  vertical-align: middle;
}

:deep(.el-table th.is-left),
:deep(.el-table td.is-left),
:deep(.el-table th.is-left .cell),
:deep(.el-table td.is-left .cell) {
  text-align: left;
}

.dt-analysis-tabs :deep(.el-table th),
.dt-analysis-tabs :deep(.el-table td) {
  text-align: center;
  vertical-align: middle;
}

.dt-analysis-table :deep(.el-table__header table),
.dt-analysis-table :deep(.el-table__body table) {
  table-layout: auto !important;
}

.dt-analysis-table :deep(.cell) {
  white-space: nowrap;
}

.dt-analysis-table :deep(.dt-analysis-primary-header),
.dt-analysis-table :deep(.dt-analysis-primary-cell) {
  width: 1%;
}

.dt-analysis-table :deep(.dt-analysis-primary-header .cell),
.dt-analysis-table :deep(.dt-analysis-primary-cell .cell) {
  white-space: nowrap;
}

.dt-analysis-pagination {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px 0;
  max-width: 100%;
  margin: 12px 0 4px;
}

.dt-analysis-requirement-table :deep(th.is-left),
.dt-analysis-requirement-table :deep(th.is-left .cell),
.dt-analysis-requirement-table :deep(td.dt-analysis-requirement-cell),
.dt-analysis-requirement-table :deep(td.dt-analysis-requirement-cell .cell) {
  text-align: left !important;
}

.dt-analysis-overview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.dt-analysis-findings {
  border: 1px solid var(--color-border-light, #F2F3F5);
  border-radius: 8px;
  background: #fff;
  padding: 12px 14px;
}

.dt-analysis-findings h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--color-text-1, #1D2129);
}

.dt-analysis-findings ul {
  margin: 0;
  padding-left: 18px;
  color: var(--color-text-2, #4E5969);
  font-size: 13px;
  line-height: 1.7;
}

.dt-analysis-mini-bars {
  display: grid;
  gap: 9px;
}

.dt-analysis-mini-bar {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) 90px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.dt-analysis-mini-bar div {
  height: 16px;
  border-radius: 4px;
  background: #EEF2F7;
  overflow: hidden;
}

.dt-analysis-mini-bar i {
  display: block;
  height: 100%;
  min-width: 2px;
}

.dt-analysis-fe-bg { background: #165DFF; }
.dt-analysis-be-bg { background: #00B42A; }
.dt-analysis-qa-bg { background: #FF7D00; }

.dt-analysis-note {
  margin: 10px 0 0;
  color: var(--color-text-3, #86909C);
  font-size: 12px;
}

.dt-analysis-formula {
  padding: 12px 16px;
  border: 1px solid var(--color-border-light, #F2F3F5);
  border-radius: 8px;
  background: #fff;
  color: var(--color-text-2, #4E5969);
  line-height: 1.8;
}

.dt-analysis-formula code {
  padding: 1px 5px;
  border-radius: 4px;
  background: #F2F3F5;
  color: #1D2129;
}

/* === 人员选择器 === */
.dt-staff-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px 0;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--color-border-light, #F2F3F5);
}

.dt-staff-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-2, #4E5969);
  background: var(--color-bg-2, #F7F8FA);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 0.69, 0.1, 1);
}

.dt-staff-chip:hover {
  background: var(--color-primary-light, #E8F3FF);
  color: var(--color-primary, #165DFF);
  border-color: var(--color-primary, #165DFF);
}

.dt-staff-chip-active {
  background: var(--color-primary, #165DFF);
  color: #fff;
  border-color: var(--color-primary, #165DFF);
  box-shadow: 0 2px 8px rgba(22, 93, 255, 0.25);
}

.dt-staff-chip-active:hover {
  background: var(--color-primary-hover, #4080FF);
  color: #fff;
}

.dt-staff-chip-active .dt-staff-dot {
  background-color: #fff !important;
}

.dt-staff-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* === 个人概要卡片 === */
.dt-personal-header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px;
  background: var(--color-bg-white, #fff);
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.04);
  margin-bottom: 24px;
}

.dt-personal-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.dt-personal-info {
  flex: 1;
}

.dt-personal-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-1, #1D2129);
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.dt-personal-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-text-3, #86909C);
}

.dt-personal-meta-item strong {
  color: var(--color-text-1, #1D2129);
  font-size: 18px;
  font-weight: 700;
  margin-right: 4px;
}

.dt-personal-meta-divider {
  color: var(--color-border, #E5E6EB);
}

/* === 手风琴面板 === */
.dt-accordion-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dt-accordion-item {
  background: var(--color-bg-white, #fff);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
  overflow: hidden;
  border: 1px solid var(--color-border-light, #F2F3F5);
}

.dt-accordion-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 0.69, 0.1, 1);
  font-size: 13px;
  color: var(--color-text-2, #4E5969);
}

.dt-accordion-header:hover {
  background: var(--color-primary-light, #E8F3FF);
}

.dt-accordion-arrow {
  font-size: 10px;
  color: var(--color-text-4, #C9CDD4);
  transition: transform 0.25s ease;
  flex-shrink: 0;
}

.dt-accordion-arrow-open {
  transform: rotate(90deg);
  color: var(--color-primary, #165DFF);
}

.dt-accordion-body {
  padding: 0 16px 10px;
}

/* 手风琴展开/收起过渡 */
.accordion-enter-active,
.accordion-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}

.accordion-enter-from,
.accordion-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.accordion-enter-to,
.accordion-leave-from {
  opacity: 1;
  max-height: 500px;
}

/* === PM 聚焦专属样式 === */
.dt-pm-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-2, #4E5969);
  background: var(--color-bg-2, #F7F8FA);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 0.69, 0.1, 1);
}

.dt-pm-chip:hover {
  background: #F9F0FF;
  color: #722ED1;
  border-color: #722ED1;
}

.dt-pm-chip-active {
  background: #722ED1;
  color: #fff;
  border-color: #722ED1;
  box-shadow: 0 2px 8px rgba(114, 46, 209, 0.25);
}

.dt-pm-chip-active:hover {
  background: #9254DE;
  color: #fff;
}

.dt-pm-chip-active .dt-pm-dot {
  background-color: #fff !important;
}

.dt-pm-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #722ED1;
  flex-shrink: 0;
}

.dt-tag-purple {
  background: #F9F0FF;
  color: #722ED1;
}

.dt-pm-header {
  border-left: 4px solid #722ED1;
}

.dt-btn-pm-active {
  background: #722ED1;
  color: #fff;
  border-color: #722ED1;
}

.dt-btn-pm-active:hover {
  background: #9254DE;
  border-color: #9254DE;
}

/* === 一起查看三列网格 === */
.dt-personal-role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}

.dt-role-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex: 0 0 28px;
}

@media (max-width: 1200px) { .dt-personal-role-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 800px) { .dt-personal-role-grid { grid-template-columns: 1fr; } }

.dt-pm-all-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
@media (max-width: 1200px) { .dt-pm-all-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 800px) { .dt-pm-all-grid { grid-template-columns: 1fr; } }

.dt-pm-all-card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
  overflow: hidden;
  border: 1px solid #F2F3F5;
}

.dt-pm-all-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #F9F0FF 0%, #EDE7F6 100%);
  border-bottom: 1px solid #F2F3F5;
}

.dt-pm-all-card-body {
  padding: 4px 6px;
}

.dt-pm-all-task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 4px;
  cursor: pointer;
  font-size: 12px;
  border-bottom: 1px solid var(--color-border-light, #F2F3F5);
  transition: background 0.2s;
}

.dt-pm-all-task-header:hover {
  background: #F9F0FF;
}

/* === 查看全部按钮 === */
.dt-pm-view-all-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  color: #722ED1;
  background: #F9F0FF;
  border: 1px solid #D3ADF7;
  border-radius: 6px;
  text-decoration: none;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s;
}

.dt-pm-view-all-btn:hover {
  background: #722ED1;
  color: #fff;
  border-color: #722ED1;
}

/* ===== 金银铜牌角标 ===== */
.hours-cell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  padding: 2px 6px;
  border-radius: 6px;
  transition: all 0.3s;
}
.hours-val {
  font-weight: 700; font-size: 12px; color: #165DFF;
}

.medal-badge {
  position: absolute;
  top: -8px; right: -10px;
  font-size: 14px;
  animation: medalPulse 2s ease-in-out infinite;
  filter: drop-shadow(0 0 4px rgba(255, 215, 0, 0.6));
  z-index: 2;
}

/* 金牌 */
.medal-gold {
  background: linear-gradient(135deg, #FFF8E1 0%, #FFE082 50%, #FFF8E1 100%);
  background-size: 200% 200%;
  animation: goldShimmer 3s ease-in-out infinite;
  box-shadow: 0 0 8px rgba(255, 193, 7, 0.4), inset 0 0 4px rgba(255, 215, 0, 0.2);
}
.medal-gold .hours-val { color: #B7791F; font-weight: 800; }
.medal-gold .medal-badge { filter: drop-shadow(0 0 6px rgba(255, 215, 0, 0.8)); }

/* 银牌 */
.medal-silver {
  background: linear-gradient(135deg, #F5F5F5 0%, #E0E0E0 50%, #F5F5F5 100%);
  background-size: 200% 200%;
  animation: silverShimmer 3s ease-in-out infinite;
  box-shadow: 0 0 6px rgba(158, 158, 158, 0.3), inset 0 0 3px rgba(192, 192, 192, 0.3);
}
.medal-silver .hours-val { color: #546E7A; font-weight: 800; }
.medal-silver .medal-badge { filter: drop-shadow(0 0 4px rgba(192, 192, 192, 0.8)); }

/* 铜牌 */
.medal-bronze {
  background: linear-gradient(135deg, #FFF3E0 0%, #FFCC80 50%, #FFF3E0 100%);
  background-size: 200% 200%;
  animation: bronzeShimmer 3s ease-in-out infinite;
  box-shadow: 0 0 6px rgba(255, 152, 0, 0.3), inset 0 0 3px rgba(205, 127, 50, 0.2);
}
.medal-bronze .hours-val { color: #8D5524; font-weight: 800; }
.medal-bronze .medal-badge { filter: drop-shadow(0 0 4px rgba(205, 127, 50, 0.8)); }

/* 动画 */
@keyframes goldShimmer {
  0%, 100% { background-position: 0% 50%; box-shadow: 0 0 8px rgba(255, 193, 7, 0.3); }
  50% { background-position: 100% 50%; box-shadow: 0 0 16px rgba(255, 193, 7, 0.6), 0 0 24px rgba(255, 215, 0, 0.2); }
}
@keyframes silverShimmer {
  0%, 100% { background-position: 0% 50%; box-shadow: 0 0 6px rgba(158, 158, 158, 0.2); }
  50% { background-position: 100% 50%; box-shadow: 0 0 12px rgba(158, 158, 158, 0.4), 0 0 20px rgba(192, 192, 192, 0.15); }
}
@keyframes bronzeShimmer {
  0%, 100% { background-position: 0% 50%; box-shadow: 0 0 6px rgba(255, 152, 0, 0.2); }
  50% { background-position: 100% 50%; box-shadow: 0 0 12px rgba(255, 152, 0, 0.4), 0 0 20px rgba(205, 127, 50, 0.15); }
}
@keyframes medalPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

/* === 展开全部周期 / 收起 === */
.dt-pm-expand-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  margin: 4px 0 0;
  background: linear-gradient(135deg, #F9F0FF 0%, #EDE7F6 100%);
  border: 1px dashed #D3ADF7;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #722ED1;
  cursor: pointer;
  transition: all 0.2s;
}

.dt-pm-expand-bar:hover {
  background: #722ED1;
  color: #fff;
  border-color: #722ED1;
}

.dt-pm-collapse-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 500;
  color: #86909C;
  cursor: pointer;
  transition: color 0.2s;
}

.dt-pm-collapse-bar:hover {
  color: #722ED1;
}

/* v3.2.1: 可点击卡片 */
.dt-stat-card-clickable {
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.25s cubic-bezier(0.34, 0.69, 0.1, 1);
}
.dt-stat-card-clickable:hover {
  border-color: var(--color-primary, #165DFF);
  box-shadow: 0 4px 16px rgba(22, 93, 255, 0.15);
}
.dt-analysis-scope-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 10px;
  color: var(--color-text-3);
  font-size: 12px;
}
.dt-analysis-scope-row span:first-child { flex: 1; }
.dt-progress-value { color: #165DFF; font-weight: 600; }
.dt-progress-completed { color: #16883B !important; background: #E8F7EE; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
@media (max-width: 900px) {
  .dt-analysis-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .dt-analysis-scope-row { flex-wrap: wrap; }
}
@media (max-width: 600px) {
  .dt-page-header { flex-wrap: wrap; gap: 12px; }
  .dt-page-header > div { min-width: 0; max-width: 100%; }
  .dt-page-title { flex: 1 1 auto; width: auto; min-width: 0; max-width: 100%; white-space: normal; overflow-wrap: anywhere; line-height: 1.5; }
  .dt-analysis-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dt-analysis-kpi { padding: 10px 8px; }
  .dt-analysis-role-strip { grid-template-columns: 1fr; }
  .dt-stat-cards.dt-stat-cards-single-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dt-stat-cards-single-row .dt-stat-card-label { white-space: normal; }
}
</style>
