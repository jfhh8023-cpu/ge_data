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

const statsStore = useStatsStore()
const authStore = useAuthStore()
const taskStore = useTaskStore()
const pmStore = usePmStore()
const roleStore = useRoleStore()
const router = useRouter()

/* ========== 常量 ========== */
const CURRENT_YEAR = new Date().getFullYear()
const CANVAS_HEIGHT = 360
const barMeta = computed(() => [
  ...roleStore.list.map(role => ({ key: role.key, label: role.short_name, color: role.color })),
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
const pmSortOrder = ref('desc')  // v3.2.1: 默认工时降序（'' | 'asc' | 'desc'）
const showBackTop = ref(false)
const hideZeroValueBars = ref(true)

/* ========== 弹窗状态 ========== */
const reqStatsDialogVisible = ref(false)
const staffDialogVisible = ref(false)
const analysisDialogVisible = ref(false)
const analysisDimension = ref('total')

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
  window.addEventListener('resize', drawChart)
  window.addEventListener('scroll', updateBackTopVisibility, { passive: true })
  updateBackTopVisibility()
  // 监听工时变更广播，自动刷新统计
  cleanupSync = onDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, () => {
    loadDeptStats()
  })
  pageLoading.value = false
  // v1.4.4: 等待 v-if 切换完成后再绘制图表（解决首次加载图表偶现不显示）
  await nextTick()
  setTimeout(drawChart, 50)
})

onUnmounted(() => {
  if (cleanupSync) cleanupSync()
  if (weekSelectorResizeObserver) weekSelectorResizeObserver.disconnect()
  window.removeEventListener('resize', updateWeekWindowSize)
  window.removeEventListener('resize', drawChart)
  window.removeEventListener('scroll', updateBackTopVisibility)
})

async function loadDeptStats() {
  await statsStore.fetch({
    year: selectedYear.value,
    quarter: selectedQuarter.value,
    taskId: effectiveTaskId.value,
    pmSort: pmSortOrder.value || undefined
  })
  await nextTick()
  drawChart()
}

// v1.4.4: 切换到部门全观时重绘图表
watch(activeTab, async (tab) => {
  if (tab === 'department') {
    await nextTick()
    drawChart()
  }
})

watch(hideZeroValueBars, async () => {
  await nextTick()
  drawChart()
})

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
const roleTotals = computed(() => {
  const summary = statsStore.roleSummary || {}
  return Object.fromEntries(roleStore.list.map(role => {
    if (role.key === ROLE_AI_DEV && summary[role.key] === undefined) {
      return [role.key, Number(summary.frontend || 0) + Number(summary.backend || 0)]
    }
    if (role.key === ROLE_AI_QUALITY && summary[role.key] === undefined) {
      return [role.key, Number(summary.test || 0)]
    }
    return [role.key, Number(summary[role.key] || 0)]
  }))
})

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

/* ========== 柱状图数据（基于后端 pmDistribution，REQ-13） ========== */
const chartData = computed(() => {
  return (statsStore.pmDistribution || []).filter(pm => {
    if (Number(pm.total || 0) > 0) return true
    return roleStore.list.some(role => roleSummaryHours(pm, role.key) > 0)
  })
})

const departmentSummaryCardCount = computed(() => roleStore.list.length + 5)

/* ========== v3.2.1: 需求总数统计（从 pmDistribution 计算） ========== */
const reqStats = computed(() => {
  const pmDist = statsStore.pmDistribution || []
  const allVersions = new Set()
  let noVersionCount = 0
  const perPm = []

  for (const pm of pmDist) {
    const recs = pm.records || []
    const pmVersions = new Set()
    let pmNoVersion = 0
    for (const r of recs) {
      const v = r.version || ''
      if (v && v !== '-' && v.trim() !== '') {
        allVersions.add(v)
        pmVersions.add(v)
      } else {
        noVersionCount++
        pmNoVersion++
      }
    }
    if (pmVersions.size > 0 || pmNoVersion > 0) {
      perPm.push({ name: pm.name, versionCount: pmVersions.size, noVersionCount: pmNoVersion })
    }
  }

  return {
    totalVersions: allVersions.size,
    totalNoVersion: noVersionCount,
    total: allVersions.size + noVersionCount,
    perPm
  }
})

function toNumber(val) {
  const n = parseFloat(val || 0)
  return Number.isFinite(n) ? n : 0
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
        requirementSet: new Set(),
        taskSet: new Set()
      }
      roleStore.list.forEach(role => { initial[role.key] = 0 })
      map.set(key, initial)
    }
    const row = map.get(key)
    const hours = toNumber(rec.hours)
    const role = normalizeRole(rec.staff?.role || rec.role)
    row.total += hours
    row.recordCount += 1
    row.taskSet.add(rec.task_id)
    row.requirementSet.add(`${rec.task_id || ''}||${rec.requirement_title || ''}||${rec.version || ''}`)
    if (row[role] !== undefined) row[role] += hours
  }
  return [...map.values()]
    .map(row => {
      const result = {
        ...row,
        total: Number(row.total.toFixed(1)),
        taskCount: row.taskSet.size,
        requirementCount: row.requirementSet.size,
        share: 0
      }
      roleStore.list.forEach(role => { result[role.key] = Number((row[role.key] || 0).toFixed(1)) })
      return result
    })
    .sort((a, b) => b.total - a.total)
}

const analysisDimensionMeta = computed(() => {
  const meta = { total: { label: '总工时', role: '', color: '#F53F3F' } }
  roleStore.list.forEach(role => { meta[role.key] = { label: `${role.name}总工时`, role: role.key, color: role.color } })
  return meta[analysisDimension.value] || meta.total
})

const analysisVisibleRoles = computed(() => {
  const role = analysisDimensionMeta.value.role
  return role ? [role] : analysisRoleMeta.value.map(item => item.key)
})

function showAnalysisRole(role) {
  return analysisVisibleRoles.value.includes(role)
}

const analysisRecords = computed(() => {
  const records = statsStore.records || []
  const role = analysisDimensionMeta.value.role
  return role ? records.filter(r => normalizeRole(r.staff?.role || r.role) === role) : records
})

const analysisData = computed(() => {
  const records = analysisRecords.value
  const total = records.reduce((sum, rec) => sum + toNumber(rec.hours), 0)
  const roleTotals = Object.fromEntries(roleStore.list.map(role => [role.key, 0]))
  for (const rec of records) {
    const role = normalizeRole(rec.staff?.role || rec.role)
    if (roleTotals[role] !== undefined) roleTotals[role] += toNumber(rec.hours)
  }
  const requirementKey = rec => `${rec.task_id || ''}||${rec.requirement_title || ''}||${rec.version || ''}`
  const pmRows = groupAnalysisRows(records, rec => firstPmName(rec.product_managers)).map(row => ({ ...row, share: total ? Number((row.total * 100 / total).toFixed(1)) : 0 }))
  const staffRows = groupAnalysisRows(records, rec => rec.staff?.name || '-', rec => `${rec.staff?.name || '-'}（${roleDisplay(rec.staff?.role, true)}）`).map(row => ({ ...row, share: total ? Number((row.total * 100 / total).toFixed(1)) : 0 }))
  const versionRows = groupAnalysisRows(records, rec => rec.version || '——').map(row => ({ ...row, share: total ? Number((row.total * 100 / total).toFixed(1)) : 0 }))
  const requirementRows = groupAnalysisRows(records, requirementKey, rec => rec.requirement_title || '-').map(row => ({ ...row, share: total ? Number((row.total * 100 / total).toFixed(1)) : 0 }))
  const taskRows = groupAnalysisRows(records, rec => rec.task_id || '-', rec => {
    const task = (statsStore.tasks || []).find(t => t.id === rec.task_id)
    return task ? formatTaskPeriod(task) : rec.task_id || '-'
  }).map(row => {
    const task = (statsStore.tasks || []).find(t => t.id === row.key)
    return {
      ...row,
      sortTime: taskSortTime(task),
      share: total ? Number((row.total * 100 / total).toFixed(1)) : 0
    }
  }).sort((a, b) => b.sortTime - a.sortTime)
  const roleComboRows = groupAnalysisRows(records, requirementKey, rec => rec.requirement_title || '-')
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
      requirementCount: new Set(hitRecords.map(requirementKey)).size
    }
  }).filter(row => row.total > 0).sort((a, b) => b.total - a.total)
  const emptyPmRecords = records.filter(rec => parseJsonField(rec.product_managers).filter(isValidPMName).length === 0)
  const missingVersionRecords = records.filter(rec => !String(rec.version || '').trim() || rec.version === '-')
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
  return {
    total: Number(total.toFixed(1)),
    recordCount: records.length,
    requirementCount: new Set(records.map(requirementKey)).size,
    taskCount: new Set(records.map(r => r.task_id)).size,
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
    qualityRows
  }
})

const analysisDialogTitle = computed(() => `${statsScopeTitle.value}｜${analysisDimensionMeta.value.label} 数据分析`)

const analysisTopRows = computed(() => ({
  period: [...analysisData.value.taskRows].sort((a, b) => b.total - a.total)[0],
  pm: analysisData.value.pmRows[0],
  staff: analysisData.value.staffRows[0],
  requirement: analysisData.value.requirementRows[0],
  version: analysisData.value.versionRows[0],
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

function openAnalysisDialog(dimension = 'total') {
  analysisDimension.value = dimension
  analysisDialogVisible.value = true
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

/* ========== 明细表：按 PM 分组的扁平数据 + 合并单元格（REQ-13 + REQ-30 需求合并） ========== */
const flatTableData = computed(() => {
  const pmDist = statsStore.pmDistribution || []
  const rows = []
  for (const pm of pmDist) {
    const recs = pm.records || []
    if (recs.length === 0) {
      rows.push({
        pmName: pm.name,
        pmRowSpan: 1,
        pmTotalRowSpan: 0,
        reqRowSpan: 1,
        version: '-',
        requirement_title: '（汇总）',
        staffName: '-',
        role: '-',
        roleRaw: '-',
        hours: pm.total.toFixed(1),
        pmTotal: pm.total.toFixed(1),
        isTotalRow: false
      })
    } else {
      // REQ-30: 默认按 requirement_title + version 排序；pmSort 模式下保持后端工时排序
      let sortedRecs
      if (pmSortOrder.value) {
        // 后端已按工时排好序，直接使用
        sortedRecs = [...recs]
      } else {
        sortedRecs = [...recs].sort((a, b) => {
          const titleA = a.requirement_title || ''
          const titleB = b.requirement_title || ''
          const cmp = titleA.localeCompare(titleB, 'zh-CN')
          if (cmp !== 0) return cmp
          return (a.version || '').localeCompare(b.version || '')
        })
      }

      const totalRows = sortedRecs.length + 1  // +1 for total row

      // 构建行数据
      const recRows = []
      for (let i = 0; i < sortedRecs.length; i++) {
        const roleKey = normalizeRole(sortedRecs[i].role)
        recRows.push({
          pmName: pm.name,
          pmRowSpan: i === 0 ? totalRows : 0,
          pmTotalRowSpan: 0,
          reqRowSpan: 1,
          versionRowSpan: 1,
          version: sortedRecs[i].version || '-',
          requirement_title: sortedRecs[i].requirement_title || '-',
          staffName: sortedRecs[i].staffName || '-',
          role: roleDisplay(roleKey, true),
          roleRaw: roleKey,
          hours: parseFloat(sortedRecs[i].hours || 0).toFixed(1),
          pmTotal: '',
          isTotalRow: false
        })
      }

      // 从后往前计算 reqRowSpan（需求名称合并）
      for (let i = recRows.length - 1; i >= 0; i--) {
        if (i < recRows.length - 1 && recRows[i].requirement_title === recRows[i + 1].requirement_title) {
          recRows[i].reqRowSpan = recRows[i + 1].reqRowSpan + 1
          recRows[i + 1].reqRowSpan = 0
        }
      }

      // 从后往前计算 versionRowSpan（版本号合并）
      for (let i = recRows.length - 1; i >= 0; i--) {
        if (i < recRows.length - 1 && recRows[i].version === recRows[i + 1].version && recRows[i].version !== '-') {
          recRows[i].versionRowSpan = recRows[i + 1].versionRowSpan + 1
          recRows[i + 1].versionRowSpan = 0
        }
      }

      rows.push(...recRows)

      // PM 总计行
      rows.push({
        pmName: pm.name,
        pmRowSpan: 0,
        pmTotalRowSpan: 0,
        reqRowSpan: 0,
        version: '',
        requirement_title: '',
        staffName: '',
        role: '',
        roleRaw: '',
        hours: '',
        pmTotal: pm.total.toFixed(1),
        isTotalRow: true
      })
    }
  }
  return rows
})

/** 部门全观 — 每个 PM 分组内的工时排名（金银铜） */
function getDeptMedalRank(row) {
  if (row.isTotalRow) return -1
  const pmName = row.pmName
  const allRows = flatTableData.value.filter(r => r.pmName === pmName && !r.isTotalRow)
  const uniqueHours = [...new Set(allRows.map(r => parseFloat(r.hours || 0)))]
    .sort((a, b) => b - a)
    .slice(0, 3)
  const h = parseFloat(row.hours || 0)
  if (h <= 0) return -1
  const idx = uniqueHours.indexOf(h)
  return idx >= 0 && idx < 3 ? idx : -1
}

/** PM 点击选中高亮 */
const selectedPM = ref('')
function togglePM(pmName) {
  selectedPM.value = selectedPM.value === pmName ? '' : pmName
}
function rowClassName({ row }) {
  const isSelected = selectedPM.value && row.pmName === selectedPM.value
  if (row.isTotalRow && isSelected) return 'dt-total-row dt-row-selected'
  if (row.isTotalRow) return 'dt-total-row'
  if (isSelected) return 'dt-row-selected'
  return ''
}

/** PM列 + 版本号列 + 需求名称列 + 总计列 合并 */
function pmSpanMethod({ row, rowIndex, columnIndex }) {
  if (columnIndex === 1) {
    // 产品经理列
    if (row.pmRowSpan > 0) {
      return { rowspan: row.pmRowSpan, colspan: 1 }
    }
    return { rowspan: 0, colspan: 0 }
  }
  // 版本号列合并（columnIndex === 2）
  if (columnIndex === 2 && !row.isTotalRow) {
    if (row.versionRowSpan > 0) {
      return { rowspan: row.versionRowSpan, colspan: 1 }
    }
    if (row.versionRowSpan === 0) {
      return { rowspan: 0, colspan: 0 }
    }
  }
  // 需求名称列合并（columnIndex === 3）
  if (columnIndex === 3 && !row.isTotalRow) {
    if (row.reqRowSpan > 0) {
      return { rowspan: row.reqRowSpan, colspan: 1 }
    }
    if (row.reqRowSpan === 0) {
      return { rowspan: 0, colspan: 0 }
    }
  }
  // 总计行合并（v1.4.2：从版本号列合并到工时列，共5列覆盖全部剩余列）
  if (row.isTotalRow) {
    if (columnIndex === 2) {
      return { rowspan: 1, colspan: 5 }
    }
    if (columnIndex >= 3 && columnIndex <= 6) {
      return { rowspan: 0, colspan: 0 }
    }
  }
}

/* ========== Canvas 绘制（REQ-11 图表清晰度改善） ========== */
const chartRef = ref(null)
const pmLabelAreas = ref([])  // v3.2.1: 存储 PM 标签点击区域

function drawChart() {
  const canvas = chartRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const data = chartData.value
  if (data.length === 0) {
    canvas.width = canvas.parentElement?.clientWidth || 800
    canvas.height = CANVAS_HEIGHT
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#86909C'
    ctx.font = '14px "Inter", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('暂无数据', canvas.width / 2, CANVAS_HEIGHT / 2)
    return
  }

  const dpr = window.devicePixelRatio || 1
  const containerWidth = canvas.parentElement?.clientWidth || 800
  canvas.width = containerWidth * dpr
  canvas.height = CANVAS_HEIGHT * dpr
  canvas.style.width = containerWidth + 'px'
  canvas.style.height = CANVAS_HEIGHT + 'px'
  ctx.scale(dpr, dpr)

  const W = containerWidth
  const H = CANVAS_HEIGHT
  const padding = { top: 60, right: 30, bottom: 55, left: 55 }
  const chartW = W - padding.left - padding.right
  const chartH = H - padding.top - padding.bottom

  ctx.clearRect(0, 0, W, H)

  // 计算最大值
  const areas = []  // v3.2.1: PM 标签点击区域收集
  const maxVal = Math.max(...data.map(d => d.total), 1)
  const yScale = chartH / (maxVal * 1.2)

  const groupCount = data.length
  const bars = barMeta.value
  const groupWidth = chartW / groupCount

  // 绘制 Y 轴网格线
  const GRID_COUNT = 5
  ctx.strokeStyle = '#F2F3F5'
  ctx.lineWidth = 1
  ctx.textAlign = 'right'
  for (let i = 0; i <= GRID_COUNT; i++) {
    const val = Math.round(maxVal * 1.2 / GRID_COUNT * i)
    const y = padding.top + chartH - val * yScale
    ctx.beginPath()
    ctx.moveTo(padding.left, y)
    ctx.lineTo(W - padding.right, y)
    ctx.stroke()
    // Y 轴标签 — 字体不小于 13px（REQ-11 清晰度要求）
    ctx.fillStyle = '#86909C'
    ctx.font = '13px "Inter", "Microsoft YaHei", sans-serif'
    ctx.fillText(val.toString(), padding.left - 8, y + 5)
  }

  // 绘制柱形
  data.forEach((d, gi) => {
    const visibleBars = hideZeroValueBars.value
      ? bars.filter(bar => Number(d[bar.key] || 0) > 0)
      : bars
    const visibleBarCount = visibleBars.length || 1
    const barWidth = Math.max(Math.min(groupWidth / (visibleBarCount + 1.5), 40), 8)
    const groupGap = (groupWidth - barWidth * visibleBars.length) / 2
    const groupX = padding.left + gi * groupWidth + groupGap

    visibleBars.forEach((bar, bi) => {
      const key = bar.key
      const val = d[key] || 0
      const barH = val * yScale
      const x = groupX + bi * barWidth
      const y = padding.top + chartH - barH

      // 柱形（圆角顶部）
      ctx.fillStyle = bar.color
      ctx.beginPath()
      const r = 3
      if (barH > r) {
        ctx.moveTo(x, y + r)
        ctx.arcTo(x, y, x + barWidth, y, r)
        ctx.arcTo(x + barWidth, y, x + barWidth, y + barH, r)
        ctx.lineTo(x + barWidth, padding.top + chartH)
        ctx.lineTo(x, padding.top + chartH)
      } else if (barH > 0) {
        ctx.rect(x, y, barWidth, barH)
      }
      ctx.closePath()
      ctx.fill()

      // 柱顶标签 — 纵排：上方角色名 / 下方数值（v3.3.0 防遮挡）
      ctx.fillStyle = '#1D2129'
      ctx.font = 'bold 10px "Inter", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'left'
      const labelBottomY = val > 0 ? y - 4 : padding.top + chartH - 8
      const labelTopY = labelBottomY - 12
      ctx.fillText(bar.label, x, labelTopY)
      ctx.fillText(val.toFixed(0), x, labelBottomY)
    })

    // X 轴标签（PM 名称）— v3.2.1: 可点击样式
    ctx.fillStyle = '#1D2129'
    ctx.font = '13px "Inter", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    const labelX = padding.left + (gi + 0.5) * groupWidth
    const displayName = d.name.length > 5 ? d.name.substring(0, 5) + '...' : d.name
    const labelW = ctx.measureText(displayName).width
    const labelY = padding.top + chartH + 22
    ctx.fillText(displayName, labelX, labelY)
    // 存储标签点击区域
    areas.push({ name: d.name, x: labelX - labelW / 2, y: labelY - 13, width: labelW, height: 16 })
  })
  pmLabelAreas.value = areas

  // 图例
  const legendY = 18
  const legendMarkerSize = 10
  const legendMarkerGap = 5
  const legendItemGap = 18
  const legendControlReserve = 112
  ctx.font = '13px "Inter", "Microsoft YaHei", sans-serif'
  const legendItemWidths = bars.map(bar => legendMarkerSize + legendMarkerGap + ctx.measureText(bar.label).width)
  const legendWidth = legendItemWidths.reduce((sum, width) => sum + width, 0) + legendItemGap * Math.max(bars.length - 1, 0)
  const legendRight = W - padding.right - legendControlReserve
  let legendX = Math.max(padding.left, legendRight - legendWidth)
  bars.forEach((bar, i) => {
    ctx.fillStyle = bar.color
    ctx.fillRect(legendX, legendY - 7, legendMarkerSize, legendMarkerSize)
    ctx.fillStyle = '#4E5969'
    ctx.textAlign = 'left'
    ctx.fillText(bar.label, legendX + legendMarkerSize + legendMarkerGap, legendY + 2)
    legendX += legendItemWidths[i] + legendItemGap
  })
}

/* v3.2.1: Canvas 点击/悬停事件 — PM 标签跳转 */
function onChartClick(event) {
  const canvas = chartRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const x = (event.clientX - rect.left)
  const y = (event.clientY - rect.top)
  for (const area of pmLabelAreas.value) {
    if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
      const pm = pmStore.list.find(p => p.name === area.name)
      if (pm?.token) {
        const routeData = router.resolve({ path: `/pm/view/${pm.token}`, query: { year: selectedYear.value, quarter: 0, month: 0 } })
        window.open(routeData.href, '_blank')
      }
      return
    }
  }
}

function onChartMouseMove(event) {
  const canvas = chartRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = (event.clientX - rect.left)
  const y = (event.clientY - rect.top)
  let isOverLabel = false
  for (const area of pmLabelAreas.value) {
    if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
      isOverLabel = true
      break
    }
  }
  canvas.style.cursor = isOverLabel ? 'pointer' : 'default'
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
const pmFocusInfo = computed(() => statsStore.pmFocusData)

/** PM 列表：当前非离职 PM + 所选周期仍有历史数据的离职 PM */
const pmList = computed(() => {
  const map = new Map()
  for (const pm of pmStore.activePms) map.set(pm.id, pm)
  for (const item of statsStore.pmDistribution || []) {
    if (item.id && !map.has(item.id)) {
      map.set(item.id, { id: item.id, name: item.name })
    }
  }
  return [...map.values()]
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
const currentStaffList = computed(() => statsStore.currentStaff || statsStore.staff || [])

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
  const pmDist = statsStore.pmDistribution || []
  if (pmDist.length === 0) {
    ElMessage.warning('暂无数据可导出')
    return
  }

  const sheets = []

  // Sheet 1: 角色工时汇总
  const summaryHeader = ['角色', '总工时(小时)']
  const summaryData = [summaryHeader]
  const rt = roleTotals.value
  roleStore.list.forEach(role => summaryData.push([role.name, rt[role.key] || 0]))
  summaryData.push(['合计', roleStore.list.reduce((sum, role) => sum + Number(rt[role.key] || 0), 0)])
  sheets.push({ name: '角色工时汇总', data: summaryData, colWidths: [12, 14] })

  // Sheet 2: AI产品经理明细表（与页面表格一致）
  const detailHeader = ['序号', 'AI产品经理', '版本号', '需求名称', '人员', '角色', '工时(小时)', '合计']
  const detailData = [detailHeader]
  let idx = 1
  for (const pm of pmDist) {
    const recs = pm.records || []
    if (recs.length === 0) {
      detailData.push([idx++, pm.name, '-', '（汇总）', '-', '-', pm.total.toFixed(1), pm.total.toFixed(1)])
    } else {
      for (const rec of recs) {
        detailData.push([
          idx++,
          pm.name,
          rec.version || '-',
          rec.requirement_title || '-',
          rec.staffName || '-',
          roleDisplay(rec.role),
          parseFloat(rec.hours || 0).toFixed(1),
          ''
        ])
      }
      detailData.push(['', pm.name + ' 合计', '', '', '', '', '', pm.total.toFixed(1)])
    }
  }
  sheets.push({ name: 'AI产品经理工时明细', data: detailData, colWidths: [8, 16, 14, 30, 10, 12, 12, 10] })

  // Sheet 3: AI产品经理柱状图数据
  const chartHeader = ['AI产品经理', ...roleStore.list.map(role => `${role.name}(小时)`), '总计(小时)']
  const chartDataExport = [chartHeader]
  for (const d of chartData.value) {
    chartDataExport.push([d.name, ...roleStore.list.map(role => roleSummaryHours(d, role.key)), d.total || 0])
  }
  sheets.push({ name: 'AI产品经理柱状图数据', data: chartDataExport, colWidths: [16, ...roleStore.list.map(() => 18), 12] })

  const filename = `周期统计_${selectedYear.value}年${selectedQuarter.value}.xlsx`
  const blob = generateAndDownloadExcel({ filename, sheets })

  uploadExcelToServer(blob, {
    source_page: 'stats',
    upload_type: 'export',
    filename
  }).catch(() => {})

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
        <el-select v-model="selectedYear" style="width:120px;">
          <el-option v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="selectedQuarter" style="width:100px;">
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
    <el-tabs v-model="activeTab" type="border-card">

      <el-tab-pane label="部门全观" name="department">

        <!-- 概要卡片（v1.4.2：总工时→角色→通用，排序调整） -->
        <div
          class="dt-stat-cards dt-stat-cards-single-row"
          :style="{ '--dt-stat-card-count': departmentSummaryCardCount }"
        >
          <div class="dt-stat-card dt-stat-card-clickable" @click="openAnalysisDialog('total')">
            <div class="dt-stat-card-label">{{ filterLabel }} 总工时</div>
            <div class="dt-stat-card-value" style="color:#F53F3F;">
              {{ statsStore.summary.totalHours?.toFixed(1) || '0' }}
              <span class="dt-stat-card-unit">小时</span>
            </div>
          </div>
          <div v-for="role in roleStore.list" :key="role.key" class="dt-stat-card dt-stat-card-clickable" @click="openAnalysisDialog(role.key)">
            <div class="dt-stat-card-label">{{ filterLabel }} {{ role.name }}总工时</div>
            <div class="dt-stat-card-value" :style="{ color: role.color }">
              {{ Number(roleTotals[role.key] || 0).toFixed(1) }}
              <span class="dt-stat-card-unit">小时</span>
            </div>
          </div>
          <div class="dt-stat-card">
            <div class="dt-stat-card-label">{{ filterLabel }} 提交记录数</div>
            <div class="dt-stat-card-value">{{ statsStore.summary.recordCount || 0 }}</div>
          </div>
          <div class="dt-stat-card dt-stat-card-clickable" @click="reqStatsDialogVisible = true">
            <div class="dt-stat-card-label">{{ filterLabel }} 统计需求总数 <span style="font-size:11px; color:var(--color-primary);">ⓘ</span></div>
            <div class="dt-stat-card-value">{{ reqStats.total }}</div>
          </div>
          <div class="dt-stat-card">
            <div class="dt-stat-card-label">{{ filterLabel }} 收集任务数</div>
            <div class="dt-stat-card-value">{{ statsStore.summary.taskCount || 0 }}</div>
          </div>
          <div class="dt-stat-card dt-stat-card-clickable" @click="staffDialogVisible = true">
            <div class="dt-stat-card-label">{{ filterLabel }} 研发人员人数 <span style="font-size:11px; color:var(--color-primary);">ⓘ</span></div>
            <div class="dt-stat-card-value">{{ statsStore.summary.staffCount || 0 }}</div>
          </div>
        </div>

        <!-- 柱状图（REQ-13：按产品经理工时分布） -->
        <div class="dt-data-card" style="padding:24px; margin-bottom:24px;">
          <h3 style="font-size:15px; font-weight:600; color:var(--color-text-1); margin-bottom:16px;">
            按AI产品经理工时分布 — {{ filterLabel }}
          </h3>
          <div class="dt-pm-chart-stage" :data-hide-zero-bars="hideZeroValueBars ? 'true' : 'false'">
            <canvas ref="chartRef" :height="CANVAS_HEIGHT" @click="onChartClick" @mousemove="onChartMouseMove"></canvas>
            <div class="dt-pm-chart-zero-toggle" title="开启后隐藏数值为0的柱子">
              <span>隐藏零值</span>
              <el-switch v-model="hideZeroValueBars" size="small" aria-label="隐藏零值柱状图" />
            </div>
          </div>
        </div>

        <!-- 明细表（REQ-13：PM 合并单元格） -->
        <div class="dt-data-card">
          <!-- v3.2.0: PM 排序控件 -->
          <div v-if="flatTableData.length > 0" style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid var(--color-border-light, #F2F3F5);">
            <span style="font-size:13px; font-weight:500; color:var(--color-text-2);">AI产品经理内数据排序：</span>
            <el-radio-group v-model="pmSortOrder" size="small" @change="loadDeptStats">
              <el-radio-button value="">按新增顺序</el-radio-button>
              <el-radio-button value="desc">工时降序 ↓</el-radio-button>
              <el-radio-button value="asc">工时升序 ↑</el-radio-button>
            </el-radio-group>
          </div>
          <el-skeleton v-if="statsStore.loading" :rows="4" animated />
          <div v-else-if="flatTableData.length === 0" class="dt-empty" style="padding:40px;">
            <div class="dt-empty-icon">📈</div>
            <p class="dt-empty-text">所选周期暂无统计数据</p>
          </div>
          <el-table
            v-else
            :data="flatTableData"
            :span-method="pmSpanMethod"
            :row-class-name="rowClassName"
            border
          >
            <el-table-column type="index" label="序号" width="60" align="center" />
            <el-table-column label="AI产品经理" width="130" align="center">
              <template #default="{ row }">
                <span
                  style="font-weight:600; cursor:pointer; user-select:none;"
                  :style="{ color: selectedPM === row.pmName ? 'var(--color-primary)' : 'inherit' }"
                  @click="togglePM(row.pmName)"
                >{{ row.pmName }}</span>
              </template>
            </el-table-column>
            <el-table-column label="版本号" width="110">
              <template #default="{ row }">
                <template v-if="row.isTotalRow">
                  <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span style="font-weight:700; font-size:13px; color:var(--color-text-1);">合计</span>
                    <span style="font-weight:800; font-size:15px; color:var(--color-primary);">{{ row.pmTotal }}小时</span>
                  </div>
                </template>
                <span v-else style="font-family:var(--font-mono);">{{ row.version }}</span>
              </template>
            </el-table-column>
            <el-table-column label="需求名称" min-width="200" align="left" header-align="center">
              <template #default="{ row }">
                <span style="font-weight:500;">{{ row.requirement_title }}</span>
              </template>
            </el-table-column>
            <el-table-column label="人员" width="100" align="center">
              <template #default="{ row }">
                {{ row.staffName }}
              </template>
            </el-table-column>
            <el-table-column label="角色" width="80" align="center">
              <template #default="{ row }">
                <span v-if="row.role && row.role !== '-'"
                  :style="rolePillStyle(row.roleRaw)"
                >{{ row.role }}</span>
                <span v-else style="color:var(--color-text-4);">-</span>
              </template>
            </el-table-column>
            <el-table-column label="工时/小时" width="120" align="center">
              <template #default="{ row }">
                <template v-if="row.isTotalRow">
                  <span style="font-weight:700; color:var(--color-primary);">{{ row.hours }}</span>
                </template>
                <template v-else>
                  <div class="hours-cell" :class="MEDAL_CLASS[getDeptMedalRank(row)] || ''">
                    <span class="hours-val">{{ row.hours }}</span>
                    <span v-if="getDeptMedalRank(row) >= 0" class="medal-badge">
                      {{ MEDAL_EMOJI[getDeptMedalRank(row)] }}
                    </span>
                  </div>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ===== Tab 2: 研发聚焦 ===== -->
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
                <div class="dt-personal-meta">
                  <span class="dt-personal-meta-item">
                    <strong>{{ personalInfo.totalHours?.toFixed(1) || '0' }}</strong> 总工时/小时
                  </span>
                  <span class="dt-personal-meta-divider">|</span>
                  <span class="dt-personal-meta-item">
                    <strong>{{ personalInfo.recordCount || 0 }}</strong> 提交记录
                  </span>
                  <span class="dt-personal-meta-divider">|</span>
                  <span class="dt-personal-meta-item">
                    <strong>{{ personalInfo.taskCount || 0 }}</strong> 参与周期
                  </span>
                </div>
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
                    <el-table v-else :data="task.records" border size="small" style="width:100%;" table-layout="fixed"
                      :default-sort="{ prop: 'hours', order: 'descending' }"
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
                  <span style="margin-left:auto; font-weight:700; color:var(--color-primary); font-size:13px;">{{ person.totalHours?.toFixed(1) || 0 }}H</span>
                </div>
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
                      <div v-for="(rec, ri) in task.records" :key="ri" style="display:flex; justify-content:space-between; padding:2px 0;">
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
                  <span style="margin-left:auto; font-weight:700; color:#00B42A; font-size:13px;">{{ person.totalHours?.toFixed(1) || 0 }}H</span>
                </div>
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
                      <div v-for="(rec, ri) in task.records" :key="ri" style="display:flex; justify-content:space-between; padding:2px 0;">
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
                  <span style="margin-left:auto; font-weight:700; color:var(--color-primary); font-size:13px;">{{ person.totalHours?.toFixed(1) || 0 }}H</span>
                </div>
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
                      <div v-for="(rec, ri) in task.records" :key="ri" style="display:flex; justify-content:space-between; padding:2px 0;">
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
                  <span :style="{ marginLeft: 'auto', fontWeight: 700, color: role.color, fontSize: '13px' }">{{ person.totalHours?.toFixed(1) || 0 }}H</span>
                </div>
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
                      <div v-for="(record, recordIndex) in task.records" :key="recordIndex" style="display:flex; justify-content:space-between; padding:2px 0;">
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
      <el-tab-pane label="AI产品经理聚焦" name="product">
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
                <div class="dt-personal-meta">
                  <span class="dt-personal-meta-item">
                    <strong>{{ pmFocusInfo.totalHours?.toFixed(1) || '0' }}</strong> 总工时/小时
                  </span>
                  <span class="dt-personal-meta-divider">|</span>
                  <span class="dt-personal-meta-item">
                    <strong>{{ pmFocusInfo.recordCount || 0 }}</strong> 提交记录
                  </span>
                  <span class="dt-personal-meta-divider">|</span>
                  <span class="dt-personal-meta-item">
                    <strong>{{ pmFocusInfo.taskCount || 0 }}</strong> 参与周期
                  </span>
                </div>
                <!-- 角色工时分布 -->
                <div v-if="pmFocusInfo.roleSummary" style="margin-top:8px; display:flex; gap:16px; flex-wrap:wrap; font-size:12px;">
                  <span v-for="role in roleStore.list" :key="role.key" :style="{ color: role.color, whiteSpace: 'nowrap' }">{{ role.short_name }} <strong>{{ roleSummaryHours(pmFocusInfo.roleSummary, role.key).toFixed(1) }}</strong>H</span>
                </div>
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
                    <el-table v-else :data="task.records" border size="small" style="width:100%;" table-layout="fixed"
                      :default-sort="{ prop: 'hours', order: 'descending' }"
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
                    <span style="font-weight:700; color:#722ED1; font-size:14px;">{{ pmData.totalHours?.toFixed(1) || 0 }}H</span>
                    <span style="font-size:11px; color:var(--color-text-3);">{{ pmData.recordCount || 0 }}条</span>
                  </div>
                  <div v-if="pmData.roleSummary" style="display:flex; gap:10px; flex-wrap:wrap; font-size:11px; margin-top:2px;">
                    <span v-for="role in roleStore.list" :key="role.key" :style="{ color: role.color, whiteSpace: 'nowrap' }">{{ role.short_name }} <strong>{{ roleSummaryHours(pmData.roleSummary, role.key).toFixed(1) }}</strong>H</span>
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
                      :data="task.records"
                      border size="small"
                      style="width:100%;"
                      table-layout="fixed"
                      :default-sort="{ prop: 'hours', order: 'descending' }"
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

    <!-- 本地周期数据分析弹窗 -->
    <el-dialog v-model="analysisDialogVisible" :title="analysisDialogTitle" width="88%" class="dt-analysis-dialog">
      <div class="dt-analysis-scope">
        <span>统计周期：{{ selectedPeriodRangeText }}</span>
        <span>筛选范围：{{ statsScopeTitle }}</span>
        <span>口径：以工时填报记录和人员岗位为准</span>
        <el-button size="small" type="primary" plain @click="openWorkloadReportPage(analysisDimension)">打开完整报告页</el-button>
      </div>

      <div class="dt-analysis-kpis">
        <div class="dt-analysis-kpi">
          <span>当前维度工时</span>
          <strong :style="{ color: analysisDimensionMeta.color }">{{ analysisData.total.toFixed(1) }}</strong>
          <em>小时</em>
        </div>
        <div class="dt-analysis-kpi">
          <span>记录数</span>
          <strong>{{ analysisData.recordCount }}</strong>
          <em>条</em>
        </div>
        <div class="dt-analysis-kpi">
          <span>需求数</span>
          <strong>{{ analysisData.requirementCount }}</strong>
          <em>个</em>
        </div>
        <div class="dt-analysis-kpi">
          <span>周期数</span>
          <strong>{{ analysisData.taskCount }}</strong>
          <em>个</em>
        </div>
      </div>

      <div class="dt-analysis-role-strip">
        <div
          v-for="role in analysisRoleRows"
          :key="role.key"
          class="dt-analysis-role-item"
          :style="{ borderColor: `${role.color}55`, color: role.color, background: `${role.color}0D` }"
        >
          <span>{{ role.label }}</span>
          <strong>{{ role.hours.toFixed(1) }}H</strong>
        </div>
      </div>

      <el-tabs type="border-card" class="dt-analysis-tabs">
        <el-tab-pane label="总览">
          <div class="dt-analysis-overview">
            <div class="dt-analysis-findings">
              <h4>核心解读</h4>
              <ul>
                <li>当前维度共 {{ analysisData.recordCount }} 条记录、{{ analysisData.requirementCount }} 个需求粒度、{{ analysisData.taskCount }} 个周期。</li>
                <li>{{ analysisRoleSummaryText }}</li>
                <li>平均单条记录 {{ analysisData.avgRecordHours.toFixed(1) }}h，平均单需求 {{ analysisData.avgRequirementHours.toFixed(1) }}h。</li>
                <li v-if="analysisTopRows.period">峰值周期：{{ analysisTopRows.period.label }}，{{ analysisTopRows.period.total }}h。</li>
              </ul>
            </div>
            <div class="dt-analysis-findings">
              <h4>重点维度</h4>
              <ul>
                <li v-if="analysisTopRows.pm">AI产品经理最高：{{ analysisTopRows.pm.label }}，{{ analysisTopRows.pm.total }}h / {{ analysisTopRows.pm.share }}%。</li>
                <li v-if="analysisTopRows.staff">人员最高：{{ analysisTopRows.staff.label }}，{{ analysisTopRows.staff.total }}h / {{ analysisTopRows.staff.share }}%。</li>
                <li v-if="analysisTopRows.requirement">需求最高：{{ analysisTopRows.requirement.label }}，{{ analysisTopRows.requirement.total }}h / {{ analysisTopRows.requirement.share }}%。</li>
                <li v-if="analysisTopRows.combo">协作形态最高：{{ analysisTopRows.combo.combo }}，{{ analysisTopRows.combo.total }}h / {{ analysisTopRows.combo.share }}%。</li>
              </ul>
            </div>
          </div>
          <div class="dt-analysis-mini-bars">
            <div v-for="role in analysisRoleRows" :key="role.key" class="dt-analysis-mini-bar">
              <span>{{ role.label }}</span>
              <div><i :style="{ width: `${role.share}%`, background: role.color }"></i></div>
              <strong>{{ role.hours.toFixed(1) }}h</strong>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="AI产品经理">
          <el-table :data="analysisData.pmRows.slice(0, 20)" border size="small" class="dt-analysis-table" table-layout="auto" style="width:100%;" :default-sort="{ prop: 'total', order: 'descending' }">
            <el-table-column prop="label" label="AI产品经理" width="1" align="center" sortable class-name="dt-analysis-primary-cell" header-class-name="dt-analysis-primary-header" />
            <el-table-column prop="total" label="工时" align="center" sortable />
            <el-table-column prop="share" label="占比" align="center" sortable>
              <template #default="{ row }">{{ row.share }}%</template>
            </el-table-column>
            <el-table-column v-for="role in analysisRoleMeta.filter(item => showAnalysisRole(item.key))" :key="role.key" :prop="role.key" :label="role.label" align="center" sortable />
            <el-table-column prop="recordCount" label="记录数" align="center" sortable />
            <el-table-column prop="requirementCount" label="需求数" align="center" sortable />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="人员">
          <el-table :data="analysisData.staffRows.slice(0, 20)" border size="small" class="dt-analysis-table" table-layout="auto" style="width:100%;" :default-sort="{ prop: 'total', order: 'descending' }">
            <el-table-column prop="label" label="人员" width="1" align="center" sortable class-name="dt-analysis-primary-cell" header-class-name="dt-analysis-primary-header" />
            <el-table-column prop="total" label="工时" align="center" sortable />
            <el-table-column prop="share" label="占比" align="center" sortable>
              <template #default="{ row }">{{ row.share }}%</template>
            </el-table-column>
            <el-table-column prop="recordCount" label="记录数" align="center" sortable />
            <el-table-column prop="taskCount" label="周期数" align="center" sortable />
            <el-table-column prop="requirementCount" label="需求数" align="center" sortable />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="周期">
          <el-table :data="analysisData.taskRows" border size="small" class="dt-analysis-table" table-layout="auto" style="width:100%;" :default-sort="{ prop: 'sortTime', order: 'descending' }">
            <el-table-column prop="sortTime" label="周期" width="1" align="center" sortable :sort-method="(a, b) => a.sortTime - b.sortTime" class-name="dt-analysis-primary-cell" header-class-name="dt-analysis-primary-header">
              <template #default="{ row }">{{ row.label }}</template>
            </el-table-column>
            <el-table-column prop="total" label="工时" align="center" sortable />
            <el-table-column prop="share" label="占比" align="center" sortable>
              <template #default="{ row }">{{ row.share }}%</template>
            </el-table-column>
            <el-table-column v-for="role in analysisRoleMeta.filter(item => showAnalysisRole(item.key))" :key="role.key" :prop="role.key" :label="role.label" align="center" sortable />
            <el-table-column prop="recordCount" label="记录数" align="center" sortable />
            <el-table-column prop="requirementCount" label="需求数" align="center" sortable />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="版本">
          <el-table :data="analysisData.versionRows.slice(0, 30)" border size="small" class="dt-analysis-table" table-layout="auto" style="width:100%;" :default-sort="{ prop: 'total', order: 'descending' }">
            <el-table-column prop="label" label="版本" width="1" align="center" sortable class-name="dt-analysis-primary-cell" header-class-name="dt-analysis-primary-header" />
            <el-table-column prop="total" label="工时" align="center" sortable />
            <el-table-column prop="share" label="占比" align="center" sortable>
              <template #default="{ row }">{{ row.share }}%</template>
            </el-table-column>
            <el-table-column v-for="role in analysisRoleMeta.filter(item => showAnalysisRole(item.key))" :key="role.key" :prop="role.key" :label="role.label" align="center" sortable />
            <el-table-column prop="recordCount" label="记录数" align="center" sortable />
            <el-table-column prop="requirementCount" label="需求数" align="center" sortable />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="需求">
          <el-table :data="analysisData.requirementRows.slice(0, 50)" border size="small" class="dt-analysis-table dt-analysis-requirement-table" table-layout="auto" style="width:100%;" :default-sort="{ prop: 'total', order: 'descending' }">
            <el-table-column prop="label" label="需求" width="130" align="left" header-align="center" show-overflow-tooltip sortable class-name="dt-analysis-requirement-cell" />
            <el-table-column prop="total" label="工时" align="center" sortable />
            <el-table-column prop="share" label="占比" align="center" sortable>
              <template #default="{ row }">{{ row.share }}%</template>
            </el-table-column>
            <el-table-column v-for="role in analysisRoleMeta.filter(item => showAnalysisRole(item.key))" :key="role.key" :prop="role.key" :label="role.label" align="center" sortable />
            <el-table-column prop="recordCount" label="记录数" align="center" sortable />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="关键词">
          <el-table :data="analysisData.keywordRows.slice(0, 30)" border size="small" class="dt-analysis-table" table-layout="auto" style="width:100%;" :default-sort="{ prop: 'total', order: 'descending' }">
            <el-table-column prop="label" label="关键词" width="1" align="center" sortable class-name="dt-analysis-primary-cell" header-class-name="dt-analysis-primary-header" />
            <el-table-column prop="total" label="命中工时" align="center" sortable />
            <el-table-column prop="share" label="占比" align="center" sortable>
              <template #default="{ row }">{{ row.share }}%</template>
            </el-table-column>
            <el-table-column prop="recordCount" label="记录数" align="center" sortable />
            <el-table-column prop="requirementCount" label="需求数" align="center" sortable />
          </el-table>
          <p class="dt-analysis-note">关键词按固定正则命中需求名称和版本字段，同一记录可命中多个关键词，仅用于识别特征，不用于反推总工时。</p>
        </el-tab-pane>
        <el-tab-pane label="数据质量">
          <el-table :data="analysisData.qualityRows" border size="small" class="dt-analysis-table" table-layout="auto" style="width:100%;" :default-sort="{ prop: 'total', order: 'descending' }">
            <el-table-column prop="label" label="检查项" width="1" align="center" sortable class-name="dt-analysis-primary-cell" header-class-name="dt-analysis-primary-header" />
            <el-table-column prop="recordCount" label="记录数" align="center" sortable />
            <el-table-column prop="total" label="工时" align="center" sortable />
            <el-table-column prop="share" label="占比" align="center" sortable>
              <template #default="{ row }">{{ row.share }}%</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="公式步骤">
          <div class="dt-analysis-formula">
            <ol>
              <li>先按页面上选择的年份、季度或具体周期确定统计范围。</li>
              <li>如果点击总工时卡片，就统计全部岗位；如果点击任一研发角色卡片，就只统计对应岗位。</li>
              <li>工时合计：把当前范围内符合条件的每条填报工时相加。</li>
              <li>占比：用当前行的工时除以当前弹窗的总工时，再换算成百分比。</li>
              <li>需求数量：同一个周期内，需求名称和版本相同的内容视为同一个需求。</li>
              <li>AI产品经理归属：优先使用填报时选择的第一个AI产品经理；没有填写时归入“不在上述”。</li>
              <li>AI产品经理、人员、周期、版本、需求、关键词和数据质量页签都沿用同一套周期范围和卡片岗位范围。</li>
            </ol>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <!-- v3.2.1: 需求总数统计弹窗 -->
    <el-dialog v-model="reqStatsDialogVisible" title="需求总数统计明细" width="520px">
      <div style="margin-bottom:16px;">
        <div style="display:flex; gap:24px; margin-bottom:16px;">
          <div style="flex:1; padding:16px; background:#E8F3FF; border-radius:8px; text-align:center;">
            <div style="font-size:12px; color:#4E5969; margin-bottom:4px;">按版本号去重总数</div>
            <div style="font-size:24px; font-weight:700; color:#165DFF;">{{ reqStats.totalVersions }}</div>
          </div>
          <div style="flex:1; padding:16px; background:#FFF7E8; border-radius:8px; text-align:center;">
            <div style="font-size:12px; color:#4E5969; margin-bottom:4px;">无版本号需求总数</div>
            <div style="font-size:24px; font-weight:700; color:#FF7D00;">{{ reqStats.totalNoVersion }}</div>
          </div>
        </div>
        <div style="font-size:13px; font-weight:600; color:var(--color-text-1); margin-bottom:8px;">按AI产品经理分组：</div>
        <el-table :data="reqStats.perPm" border size="small" style="width:100%;" :default-sort="{ prop: 'versionCount', order: 'descending' }">
          <el-table-column prop="name" label="AI产品经理" width="130" align="center" sortable />
          <el-table-column prop="versionCount" label="去重版本数" width="120" align="center" sortable />
          <el-table-column prop="noVersionCount" label="无版本号数" width="120" align="center" sortable />
          <el-table-column label="小计" width="100" align="center" sortable :sort-method="(a, b) => (a.versionCount + a.noVersionCount) - (b.versionCount + b.noVersionCount)">
            <template #default="{ row }">
              <span style="font-weight:700; color:var(--color-primary);">{{ row.versionCount + row.noVersionCount }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>

    <!-- v3.2.1: 研发人员明细弹窗 -->
    <el-dialog v-model="staffDialogVisible" title="研发人员明细" width="420px">
      <el-table :data="currentStaffList" border size="small" style="width:100%;">
        <el-table-column type="index" label="#" width="45" align="center" />
        <el-table-column prop="name" label="姓名" width="100" align="center" sortable>
          <template #default="{ row }">
            <span style="font-weight:600;">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="role" label="岗位" width="100" align="center" sortable>
          <template #default="{ row }">
            <span
              :style="rolePillStyle(row.role)"
            >{{ roleDisplay(row.role, true) }}</span>
          </template>
        </el-table-column>
      </el-table>
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

.dt-focus-collective-toggle {
  color: var(--color-text-2, #4E5969);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}

.dt-stat-cards.dt-stat-cards-single-row {
  grid-template-columns: repeat(var(--dt-stat-card-count), minmax(180px, 1fr));
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 2px 8px;
}

.dt-stat-cards-single-row .dt-stat-card {
  min-width: 0;
  padding: 16px 12px;
}

.dt-stat-cards-single-row .dt-stat-card-label,
.dt-stat-cards-single-row .dt-stat-card-value {
  white-space: nowrap;
}

.dt-stat-cards-single-row .dt-stat-card-label {
  font-size: 12px;
}

.dt-pm-chart-stage {
  position: relative;
  width: 100%;
  min-width: 0;
}

.dt-pm-chart-stage canvas {
  display: block;
  width: 100%;
}

.dt-pm-chart-zero-toggle {
  position: absolute;
  top: 2px;
  right: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  color: var(--color-text-2, #4E5969);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.dt-pm-chart-zero-toggle :deep(.el-switch) {
  height: 22px;
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
  }

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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.dt-analysis-kpi {
  padding: 14px 16px;
  border: 1px solid var(--color-border-light, #F2F3F5);
  border-radius: 8px;
  background: #fff;
  text-align: center;
}

.dt-analysis-kpi span {
  display: block;
  color: var(--color-text-3, #86909C);
  font-size: 12px;
  margin-bottom: 6px;
}

.dt-analysis-kpi strong {
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-1, #1D2129);
}

.dt-analysis-kpi em {
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
</style>
