<script setup>
/**
 * StatsPage.vue — 周期统计（季度）页
 * Tab 1: 部门全观 — 三级筛选器 + 概要卡片 + 明细表 + Canvas 柱状图
 * Tab 2: 个人聚焦 — 人员选择 + 概要卡片 + 手风琴任务列表
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
import { useStatsStore } from '../stores/stats'
import { useTaskStore } from '../stores/task'
import api from '../api'
import { onDataChange, SYNC_EVENTS } from '../utils/sync'

const statsStore = useStatsStore()
const taskStore = useTaskStore()

/* ========== 常量 ========== */
const CURRENT_YEAR = new Date().getFullYear()
const BAR_COLORS = {
  frontend: '#165DFF',
  backend: '#00B42A',
  test: '#FF7D00',
  total: '#F53F3F'
}
const CANVAS_HEIGHT = 360
const BAR_LABELS = ['前端', '后端', '测试', '总计']
const BAR_KEYS = ['frontend', 'backend', 'test', 'total']

const ROLE_LABEL = { frontend: '前端', backend: '后端', test: '测试' }
const ROLE_DOT_COLOR = { frontend: '#165DFF', backend: '#00B42A', test: '#FF7D00' }
const ROLE_TAG_CLASS = { frontend: 'dt-tag-blue', backend: 'dt-tag-green', test: 'dt-tag-orange' }

/* ========== Tab 切换 ========== */
const activeTab = ref('department')
const pageLoading = ref(true)  // v1.4.3: 页面初始加载状态

/* ========== 筛选状态（共享） ========== */
const selectedYear = ref(CURRENT_YEAR)
const selectedQuarter = ref(getCurrentQuarter())
const selectedTaskId = ref('all')

function getCurrentQuarter() {
  const m = new Date().getMonth() + 1
  return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'
}

const yearOptions = computed(() => {
  const years = []
  for (let y = CURRENT_YEAR; y >= CURRENT_YEAR - 2; y--) years.push(y)
  return years
})

const quarterOptions = ['Q1', 'Q2', 'Q3', 'Q4']

const taskOptions = computed(() => {
  const sorted = [...(statsStore.tasks || [])].sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
  return [{ id: 'all', title: '全部周期' }, ...sorted]
})

/** 当前筛选的标签文字（用于柱状图标题） */
const filterLabel = computed(() => {
  if (selectedTaskId.value !== 'all') {
    const task = (statsStore.tasks || []).find(t => t.id === selectedTaskId.value)
    return task ? task.title : selectedQuarter.value
  }
  return selectedQuarter.value
})

/* ========== 数据加载 ========== */
/* 跨页面数据同步监听 */
let cleanupSync = null

onMounted(async () => {
  pageLoading.value = true
  await taskStore.fetchAll()
  await loadDeptStats()
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
})

async function loadDeptStats() {
  await statsStore.fetch({
    year: selectedYear.value,
    quarter: selectedQuarter.value,
    taskId: selectedTaskId.value
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

watch([selectedYear, selectedQuarter, selectedTaskId], async () => {
  if (activeTab.value === 'department') {
    loadDeptStats()
  } else if (activeTab.value === 'personal') {
    // 刷新部门统计（保持 taskOptions 下拉和 staff 列表同步）
    await statsStore.fetch({
      year: selectedYear.value,
      quarter: selectedQuarter.value,
      taskId: selectedTaskId.value
    })
    // 根据当前 viewMode 刷新个人数据
    if (viewMode.value === 'individual' && selectedStaffId.value) {
      await statsStore.fetchPersonal(selectedStaffId.value, {
        year: selectedYear.value,
        quarter: selectedQuarter.value,
        taskId: selectedTaskId.value
      })
    } else if (viewMode.value === 'all') {
      await loadAllPersonalData()
    }
  }
})

/* ========== 角色工时（基于后端 roleSummary，REQ-11/REQ-19） ========== */
const roleTotals = computed(() => {
  return statsStore.roleSummary || { frontend: 0, backend: 0, test: 0 }
})

/* ========== 柱状图数据（基于后端 pmDistribution，REQ-13） ========== */
const chartData = computed(() => {
  return statsStore.pmDistribution || []
})

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
      // REQ-30: 先按 requirement_title + version 排序，使相同内容相邻
      const sortedRecs = [...recs].sort((a, b) => {
        const titleA = a.requirement_title || ''
        const titleB = b.requirement_title || ''
        const cmp = titleA.localeCompare(titleB, 'zh-CN')
        if (cmp !== 0) return cmp
        return (a.version || '').localeCompare(b.version || '')
      })

      const totalRows = sortedRecs.length + 1  // +1 for total row

      // 构建行数据
      const recRows = []
      for (let i = 0; i < sortedRecs.length; i++) {
        recRows.push({
          pmName: pm.name,
          pmRowSpan: i === 0 ? totalRows : 0,
          pmTotalRowSpan: 0,
          reqRowSpan: 1,
          versionRowSpan: 1,
          version: sortedRecs[i].version || '-',
          requirement_title: sortedRecs[i].requirement_title || '-',
          staffName: sortedRecs[i].staffName || '-',
          role: ROLE_LABEL[sortedRecs[i].role] || sortedRecs[i].role || '-',
          roleRaw: sortedRecs[i].role || '-',
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
  const padding = { top: 45, right: 30, bottom: 55, left: 55 }
  const chartW = W - padding.left - padding.right
  const chartH = H - padding.top - padding.bottom

  ctx.clearRect(0, 0, W, H)

  // 计算最大值
  const maxVal = Math.max(...data.map(d => d.total), 1)
  const yScale = chartH / (maxVal * 1.2)

  const groupCount = data.length
  const barTypes = 4
  const groupWidth = chartW / groupCount
  const barWidth = Math.max(Math.min(groupWidth / (barTypes + 1.5), 40), 20)
  const groupGap = (groupWidth - barWidth * barTypes) / 2

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
  const colors = [BAR_COLORS.frontend, BAR_COLORS.backend, BAR_COLORS.test, BAR_COLORS.total]

  data.forEach((d, gi) => {
    const groupX = padding.left + gi * groupWidth + groupGap

    BAR_KEYS.forEach((key, bi) => {
      const val = d[key] || 0
      const barH = val * yScale
      const x = groupX + bi * barWidth
      const y = padding.top + chartH - barH

      // 柱形（圆角顶部）
      ctx.fillStyle = colors[bi]
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

      // 柱顶标签 — 角色名 + 数值（REQ-23）
      ctx.fillStyle = '#1D2129'
      ctx.font = 'bold 10px "Inter", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      const labelText = `${BAR_LABELS[bi]} ${val.toFixed(0)}`
      ctx.fillText(labelText, x + barWidth / 2, val > 0 ? y - 4 : padding.top + chartH - 8)
    })

    // X 轴标签（PM 名称）
    ctx.fillStyle = '#4E5969'
    ctx.font = '13px "Inter", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    const labelX = groupX + barWidth * 2
    const displayName = d.name.length > 5 ? d.name.substring(0, 5) + '...' : d.name
    ctx.fillText(displayName, labelX, padding.top + chartH + 22)
  })

  // 图例
  const legendY = 18
  let legendX = W - padding.right - 300
  BAR_KEYS.forEach((_, i) => {
    ctx.fillStyle = colors[i]
    ctx.fillRect(legendX, legendY - 8, 12, 12)
    ctx.fillStyle = '#4E5969'
    ctx.font = '13px "Inter", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(BAR_LABELS[i], legendX + 16, legendY + 3)
    legendX += 70
  })
}

/* ========== Tab 2: 个人聚焦 ========== */
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
    taskId: selectedTaskId.value
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
      taskId: selectedTaskId.value
    })
    // 刷新个人数据
    if (viewMode.value === 'individual' && selectedStaffId.value) {
      await statsStore.fetchPersonal(selectedStaffId.value, {
        year: selectedYear.value,
        quarter: selectedQuarter.value,
        taskId: selectedTaskId.value
      })
    } else if (viewMode.value === 'all') {
      await loadAllPersonalData()
    }
  }
})

/* ========== 个人聚焦双模式 ========== */
const viewMode = ref('individual')  // 'individual' | 'all'
const allPersonalData = ref({ backend: [], frontend: [], test: [] })

async function loadAllPersonalData() {
  const grouped = { backend: [], frontend: [], test: [] }
  for (const staff of statsStore.staff) {
    try {
      const res = await api.get(`/stats/personal/${staff.id}`, {
        params: { year: selectedYear.value, quarter: selectedQuarter.value, taskId: selectedTaskId.value }
      })
      const data = res.data || res || {}
      data.staff = staff
      // REQ-25c: 周期倒序（最新在前）
      if (data.tasks?.length) {
        data.tasks.sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
      }
      if (grouped[staff.role]) {
        grouped[staff.role].push(data)
      }
    } catch { /* skip */ }
  }
  allPersonalData.value = grouped
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
const allExpandedMap = ref({})
function toggleAllTask(staffId, taskId) {
  const key = `${staffId}_${taskId}`
  allExpandedMap.value[key] = !allExpandedMap.value[key]
}
function isAllExpanded(staffId, taskId) {
  return !!allExpandedMap.value[`${staffId}_${taskId}`]
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
        <h1 class="dt-page-title">周期统计（季度）</h1>
        <p class="dt-page-description">部门工时趋势与个人贡献分析</p>
      </div>
      <el-button circle @click="loadDeptStats" title="刷新数据" style="font-size:16px;">🔄</el-button>
    </div>

    <!-- 年度 / 季度 / 任务周期 三联筛选器（两个 Tab 共享，REQ-12） -->
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:24px;">
      <el-select v-model="selectedYear" style="width:120px;">
        <el-option v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
      </el-select>
      <el-select v-model="selectedQuarter" style="width:100px;">
        <el-option v-for="q in quarterOptions" :key="q" :label="q" :value="q" />
      </el-select>
      <el-select v-model="selectedTaskId" style="width:400px;" placeholder="选择任务周期">
        <el-option v-for="t in taskOptions" :key="t.id" :label="t.title" :value="t.id" />
      </el-select>
    </div>

    <!-- 双 Tab 切换 -->
    <el-tabs v-model="activeTab" type="border-card">

      <el-tab-pane label="部门全观" name="department">

        <!-- 概要卡片（v1.4.2：总工时→角色→通用，排序调整） -->
        <div class="dt-stat-cards">
          <div class="dt-stat-card">
            <div class="dt-stat-card-label">{{ filterLabel }} 总工时</div>
            <div class="dt-stat-card-value" style="color:#F53F3F;">
              {{ statsStore.summary.totalHours?.toFixed(1) || '0' }}
              <span class="dt-stat-card-unit">小时</span>
            </div>
          </div>
          <div class="dt-stat-card">
            <div class="dt-stat-card-label">{{ filterLabel }} 前端总工时</div>
            <div class="dt-stat-card-value" style="color:#165DFF;">
              {{ roleTotals.frontend?.toFixed(1) || '0' }}
              <span class="dt-stat-card-unit">小时</span>
            </div>
          </div>
          <div class="dt-stat-card">
            <div class="dt-stat-card-label">{{ filterLabel }} 后端总工时</div>
            <div class="dt-stat-card-value" style="color:#00B42A;">
              {{ roleTotals.backend?.toFixed(1) || '0' }}
              <span class="dt-stat-card-unit">小时</span>
            </div>
          </div>
          <div class="dt-stat-card">
            <div class="dt-stat-card-label">{{ filterLabel }} 测试总工时</div>
            <div class="dt-stat-card-value" style="color:#FF7D00;">
              {{ roleTotals.test?.toFixed(1) || '0' }}
              <span class="dt-stat-card-unit">小时</span>
            </div>
          </div>
          <div class="dt-stat-card">
            <div class="dt-stat-card-label">{{ filterLabel }} 提交记录数</div>
            <div class="dt-stat-card-value">{{ statsStore.summary.recordCount || 0 }}</div>
          </div>
          <div class="dt-stat-card">
            <div class="dt-stat-card-label">{{ filterLabel }} 收集任务数</div>
            <div class="dt-stat-card-value">{{ statsStore.summary.taskCount || 0 }}</div>
          </div>
          <div class="dt-stat-card">
            <div class="dt-stat-card-label">{{ filterLabel }} 研发人员人数</div>
            <div class="dt-stat-card-value">{{ statsStore.summary.staffCount || 0 }}</div>
          </div>
        </div>

        <!-- 柱状图（REQ-13：按产品经理工时分布） -->
        <div class="dt-data-card" style="padding:24px; margin-bottom:24px;">
          <h3 style="font-size:15px; font-weight:600; color:var(--color-text-1); margin-bottom:16px;">
            按产品经理工时分布 — {{ filterLabel }}
          </h3>
          <canvas ref="chartRef" :height="CANVAS_HEIGHT"></canvas>
        </div>

        <!-- 明细表（REQ-13：PM 合并单元格） -->
        <div class="dt-data-card">
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
            <el-table-column label="产品经理" width="130" align="center">
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
            <el-table-column label="需求名称" min-width="200">
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
                  :style="{
                    display: 'inline-block',
                    padding: '2px 10px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: '500',
                    background: row.roleRaw === 'frontend' ? '#E8F3FF' : row.roleRaw === 'backend' ? '#E8FFEA' : row.roleRaw === 'test' ? '#FFF7E8' : '#F2F3F5',
                    color: row.roleRaw === 'frontend' ? '#165DFF' : row.roleRaw === 'backend' ? '#00B42A' : row.roleRaw === 'test' ? '#FF7D00' : '#86909C'
                  }"
                >{{ row.role }}</span>
                <span v-else style="color:var(--color-text-4);">-</span>
              </template>
            </el-table-column>
            <el-table-column label="工时/小时" width="100" align="center">
              <template #default="{ row }">
                <span style="font-weight:700; color:var(--color-primary);">{{ row.hours }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ===== Tab 2: 个人聚焦 ===== -->
      <el-tab-pane label="个人聚焦" name="personal">
        <!-- 模式切换按钮 -->
        <div style="display:flex; gap:8px; margin-bottom:16px;">
          <button
            :class="['dt-btn', 'dt-btn-sm', viewMode === 'individual' ? 'dt-btn-primary' : 'dt-btn-outline']"
            @click="switchViewMode('individual')"
          >单独查看</button>
          <button
            :class="['dt-btn', 'dt-btn-sm', viewMode === 'all' ? 'dt-btn-primary' : 'dt-btn-outline']"
            @click="switchViewMode('all')"
          >一起查看</button>
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
              <span class="dt-staff-dot" :style="{ backgroundColor: ROLE_DOT_COLOR[s.role] }"></span>
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
              <div class="dt-personal-avatar" :style="{ background: ROLE_DOT_COLOR[personalInfo.staff?.role] || '#165DFF' }">
                {{ getInitial(personalInfo.staff?.name) }}
              </div>
              <div class="dt-personal-info">
                <div class="dt-personal-name">
                  {{ personalInfo.staff?.name }}
                  <span class="dt-tag" :class="ROLE_TAG_CLASS[personalInfo.staff?.role]">
                    {{ ROLE_LABEL[personalInfo.staff?.role] || '-' }}
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
                    {{ task.start_date }} — {{ task.end_date }}
                  </span>
                  <span class="dt-tag dt-tag-gray" style="font-size:11px;">
                    {{ task.records.length > 0 ? task.records.length + ' 条记录' : '暂无记录' }}
                  </span>
                </div>
                <transition name="accordion">
                  <div v-if="expandedTaskIds.includes(task.id)" class="dt-accordion-body">
                    <div v-if="task.records.length === 0" style="padding:16px; text-align:center; color:var(--color-text-3); font-size:13px;">该周期暂无提交记录</div>
                    <el-table v-else :data="task.records" border size="small" style="width:100%;" table-layout="fixed">
                      <el-table-column type="index" label="#" width="45" align="center" />
                      <el-table-column prop="version" label="版本号" width="100">
                        <template #default="{ row }">
                          <span style="font-family:var(--font-mono);">{{ row.version || '-' }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="requirement_title" label="需求标题" min-width="180" show-overflow-tooltip />
                      <el-table-column prop="product_managers" label="产品经理" min-width="130">
                        <template #default="{ row }">
                          <span style="word-break:break-all;">{{ formatPM(row.product_managers) }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="hours" label="工时(小时)" width="100" align="center">
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
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px;">
            <!-- 后端列 -->
            <div>
              <h3 style="font-size:14px; font-weight:600; color:#00B42A; margin-bottom:12px; padding:8px 12px; background:#E8FFEA; border-radius:8px; text-align:center;">后端</h3>
              <div v-for="(person, pIdx) in allPersonalData.backend" :key="person.staff?.id" :style="{ marginBottom:'16px', background: pIdx % 2 === 1 ? '#F0FAF0' : 'transparent', borderRadius:'10px', padding: pIdx % 2 === 1 ? '10px' : '0' }">
                <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--color-bg-2); border-radius:8px; margin-bottom:4px;">
                  <div style="width:28px; height:28px; border-radius:50%; background:#00B42A; color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600;">{{ getInitial(person.staff?.name) }}</div>
                  <span style="font-weight:600; font-size:13px;">{{ person.staff?.name }}</span>
                  <span style="margin-left:auto; font-weight:700; color:var(--color-primary); font-size:13px;">{{ person.totalHours?.toFixed(1) || 0 }}H</span>
                </div>
                <div v-if="person.tasks?.length" style="padding-left:8px;">
                  <div v-for="task in person.tasks" :key="task.id" style="border-bottom:1px solid var(--color-border-light);">
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
                    <div v-if="isAllExpanded(person.staff?.id, task.id)" style="padding:4px 8px 8px 20px; font-size:12px; color:var(--color-text-3);">
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
            <!-- 前端列 -->
            <div>
              <h3 style="font-size:14px; font-weight:600; color:#165DFF; margin-bottom:12px; padding:8px 12px; background:#E8F3FF; border-radius:8px; text-align:center;">前端</h3>
              <div v-for="(person, pIdx) in allPersonalData.frontend" :key="person.staff?.id" :style="{ marginBottom:'16px', background: pIdx % 2 === 1 ? '#EDF4FF' : 'transparent', borderRadius:'10px', padding: pIdx % 2 === 1 ? '10px' : '0' }">
                <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--color-bg-2); border-radius:8px; margin-bottom:4px;">
                  <div style="width:28px; height:28px; border-radius:50%; background:#165DFF; color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600;">{{ getInitial(person.staff?.name) }}</div>
                  <span style="font-weight:600; font-size:13px;">{{ person.staff?.name }}</span>
                  <span style="margin-left:auto; font-weight:700; color:var(--color-primary); font-size:13px;">{{ person.totalHours?.toFixed(1) || 0 }}H</span>
                </div>
                <div v-if="person.tasks?.length" style="padding-left:8px;">
                  <div v-for="task in person.tasks" :key="task.id" style="border-bottom:1px solid var(--color-border-light);">
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
                    <div v-if="isAllExpanded(person.staff?.id, task.id)" style="padding:4px 8px 8px 20px; font-size:12px; color:var(--color-text-3);">
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
            <!-- 测试列 -->
            <div>
              <h3 style="font-size:14px; font-weight:600; color:#FF7D00; margin-bottom:12px; padding:8px 12px; background:#FFF7E8; border-radius:8px; text-align:center;">测试</h3>
              <div v-for="(person, pIdx) in allPersonalData.test" :key="person.staff?.id" :style="{ marginBottom:'16px', background: pIdx % 2 === 1 ? '#FFF7E8' : 'transparent', borderRadius:'10px', padding: pIdx % 2 === 1 ? '10px' : '0' }">
                <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--color-bg-2); border-radius:8px; margin-bottom:4px;">
                  <div style="width:28px; height:28px; border-radius:50%; background:#FF7D00; color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600;">{{ getInitial(person.staff?.name) }}</div>
                  <span style="font-weight:600; font-size:13px;">{{ person.staff?.name }}</span>
                  <span style="margin-left:auto; font-weight:700; color:var(--color-primary); font-size:13px;">{{ person.totalHours?.toFixed(1) || 0 }}H</span>
                </div>
                <div v-if="person.tasks?.length" style="padding-left:8px;">
                  <div v-for="task in person.tasks" :key="task.id" style="border-bottom:1px solid var(--color-border-light);">
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
                    <div v-if="isAllExpanded(person.staff?.id, task.id)" style="padding:4px 8px 8px 20px; font-size:12px; color:var(--color-text-3);">
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
          </div>
        </template>
      </el-tab-pane>
    </el-tabs>
    </template>
  </div>
</template>

<style scoped>
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
  gap: 8px;
}

.dt-accordion-item {
  background: var(--color-bg-white, #fff);
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
  overflow: hidden;
  border: 1px solid var(--color-border-light, #F2F3F5);
}

.dt-accordion-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 0.69, 0.1, 1);
  font-size: 14px;
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
  padding: 0 20px 16px;
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
</style>
