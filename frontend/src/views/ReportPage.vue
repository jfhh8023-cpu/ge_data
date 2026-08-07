<script setup>
/**
 * ReportPage.vue — 需求工时统计页（原汇总报表）
 * v1.4.3: 页面加载动画 + 2秒自动刷新解决权限页跳转白屏
 * v1.4.2: 本周/上周逻辑重写、默认选中修正、编辑模式“不可编辑”提示
 * v1.1.0: 改名 · 上下周期切换 · 默认上一周期 · 编辑模式 · 工时加粗 · 合计修正
 */
import { ref, computed, h, onMounted, onUnmounted, watch } from 'vue'
import { useReportStore } from '../stores/report'
import { useTaskStore } from '../stores/task'
import { useStaffStore } from '../stores/staff'
import { usePmStore } from '../stores/pm'
import { useRoleStore } from '../stores/roles'
import { ElMessage, ElMessageBox } from 'element-plus'
import { broadcastDataChange, onDataChange, SYNC_EVENTS } from '../utils/sync'
import api from '../api'
import { parseExcelFile, validateHeaders, generateAndDownloadExcel, uploadExcelToServer, downloadTemplate } from '../utils/excel'
import { useAuthStore } from '../stores/auth'

const reportStore = useReportStore()
const taskStore = useTaskStore()
const staffStore = useStaffStore()
const pmStore = usePmStore()
const roleStore = useRoleStore()
const authStore = useAuthStore()

/* ========== 常量 ========== */
const PAGE_SIZE = 20
const SORT_OPTIONS = computed(() => [
  { key: 'pm', label: 'AI产品' },
  ...roleStore.list.map(role => ({ key: role.key, label: role.short_name }))
])
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
const pageSyncId = `report-${Date.now()}-${Math.random().toString(16).slice(2)}`
const autoSaveTimers = new Map()

onMounted(async () => {
  pageLoading.value = true
  await Promise.all([
    taskStore.fetchAll(),
    staffStore.fetchAll(),
    pmStore.fetchAll(),
    roleStore.fetchAll({ force: true })
  ])
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
  cleanupSync = onDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, (payload = {}) => {
    if (payload.source === pageSyncId) return
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
  for (const timer of autoSaveTimers.values()) clearTimeout(timer)
  autoSaveTimers.clear()
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
  return people.map(p => String(p.staffName || '').trim()).filter(Boolean)
}

/** 拆分：仅获取工时列表 */
function formatHoursList(people) {
  if (!Array.isArray(people) || people.length === 0) return []
  return people
    .filter(p => String(p.staffName || '').trim() || Number(p.hours || 0) > 0)
    .map(p => p.hours)
}

function isManualRow(row) {
  return row?.status === 'manual_merged'
}

function canEditRow(row) {
  return editMode.value && isManualRow(row)
}

function roleOptions(role) {
  return staffStore.byRole(role)
}

function roleHeaderLabel(role) {
  const fullName = String(role?.name || '')
  const visualUnits = [...fullName].reduce((sum, char) => sum + (/^[\x00-\x7F]$/.test(char) ? 0.6 : 1), 0)
  return visualUnits <= 13 ? fullName : String(role?.short_name || fullName)
}

function editableRoleRows(row, roleKey) {
  if (!row.role_buckets || typeof row.role_buckets !== 'object') row.role_buckets = {}
  if (!Array.isArray(row.role_buckets[roleKey])) row.role_buckets[roleKey] = []
  if (row.role_buckets[roleKey].length === 0) row.role_buckets[roleKey].push({ staffName: '', hours: null })
  return row.role_buckets[roleKey]
}

function normalizeNameArray(value) {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []
}

function normalizeRoleRows(value) {
  return Array.isArray(value)
    ? value
      .map(item => ({
        staffName: String(item?.staffName || '').trim(),
        hours: Number(item?.hours || 0)
      }))
      .filter(item => item.staffName || item.hours > 0)
    : []
}

function buildRowPayload(row) {
  return {
    merged_title: row.merged_title || '',
    version: row.version || '',
    product_managers: normalizeNameArray(row.product_managers),
    role_buckets: Object.fromEntries(roleStore.list.map(role => [role.key, normalizeRoleRows(row.role_buckets?.[role.key])])),
    remark: row.remark || ''
  }
}

function broadcastReportChange(reason) {
  broadcastDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, {
    taskId: selectedTaskId.value,
    source: pageSyncId,
    sourcePage: 'report',
    reason
  })
}

function scheduleRowAutoSave(row) {
  if (!isManualRow(row)) return
  if (autoSaveTimers.has(row.id)) clearTimeout(autoSaveTimers.get(row.id))
  autoSaveTimers.set(row.id, setTimeout(() => {
    autoSaveTimers.delete(row.id)
    saveRowEdit(row, { silent: true })
  }, 500))
}

async function flushRowAutoSave(row) {
  if (!isManualRow(row)) return
  if (autoSaveTimers.has(row.id)) {
    clearTimeout(autoSaveTimers.get(row.id))
    autoSaveTimers.delete(row.id)
  }
  await saveRowEdit(row, { silent: true })
}

function removeRolePerson(row, roleKey, index) {
  if (!Array.isArray(row.role_buckets?.[roleKey])) return
  row.role_buckets[roleKey].splice(index, 1)
  if (row.role_buckets[roleKey].length === 0) row.role_buckets[roleKey].push({ staffName: '', hours: null })
  scheduleRowAutoSave(row)
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
    default:
      return groups.sort((a, b) => (a.role_buckets?.[sortMode.value]?.[0]?.staffName || '').localeCompare(b.role_buckets?.[sortMode.value]?.[0]?.staffName || '', 'zh-Hans'))
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
    const row = await reportStore.addManualRow(selectedTaskId.value)
    roleStore.list.forEach(role => editableRoleRows(row, role.key))
    editMode.value = true
    currentPage.value = 1
    broadcastReportChange('report_manual_row_added')
    ElMessage.success('已添加空白行')
  } catch {
    ElMessage.error('添加失败')
  }
}

async function deleteRow(row) {
  try {
    await ElMessageBox.confirm(`确认删除此行？`, '删除', { type: 'warning' })
    await reportStore.deleteRow(row.id)
    broadcastReportChange('report_manual_row_deleted')
    ElMessage.success('已删除')
  } catch {
    // 用户取消
  }
}

async function saveRemark(group) {
  try {
    if (isManualRow(group)) {
      await flushRowAutoSave(group)
      return
    }
    await reportStore.updateRemark(group.id, group.remark)
    broadcastReportChange('report_remark_saved')
  } catch {
    // 静默
  }
}

async function saveRowEdit(row, options = {}) {
  if (!isManualRow(row)) return
  try {
    await reportStore.updateRow(row.id, buildRowPayload(row))
    broadcastReportChange('report_manual_row_saved')
    if (!options.silent) ElMessage.success('已保存')
  } catch {
    if (!options.silent) ElMessage.error('保存失败')
  }
}

function toggleEditMode() {
  editMode.value = !editMode.value
}

/* ========== v2.0.0: 导出功能 ========== */
function exportReportData() {
  const groups = sortedGroups.value
  if (groups.length === 0) {
    ElMessage.warning('暂无数据可导出')
    return
  }

  const roleHeaders = roleStore.list.flatMap(role => [`${role.name}姓名`, `${role.name}工时`])
  const headers = ['序号', '版本号', '需求名称', 'AI产品经理', ...roleHeaders, '总计/小时', '备注']
  const rows = groups.map((g, idx) => {
    const roleCells = roleStore.list.flatMap(role => [
      formatNames(g.role_buckets?.[role.key]).join(', '),
      Number(g._roleTotals?.[role.key] || 0).toFixed(1)
    ])
    return [
      idx + 1,
      g.version || '',
      g.merged_title || '',
      Array.isArray(g.product_managers) ? g.product_managers.join(', ') : '',
      ...roleCells,
      g._rowTotal ? g._rowTotal.toFixed(1) : '0',
      g.remark || ''
    ]
  })

  // 合计行
  const totals = reportStore.columnTotals
  const totalRoleCells = roleStore.list.flatMap(role => ['', Number(totals[role.key] || 0).toFixed(1)])
  rows.push(['', '', '', '合计', ...totalRoleCells, totals.total.toFixed(1), ''])

  const taskTitle = selectedTask.value?.title || '需求工时统计'
  const filename = `${taskTitle}_需求工时统计.xlsx`

  const blob = generateAndDownloadExcel({
    filename,
    sheets: [{
      name: '需求工时统计',
      data: [headers, ...rows],
      colWidths: [6, 12, 30, 14, ...roleStore.list.flatMap(() => [18, 14]), 10, 18]
    }]
  })

  // 存档到服务端
  uploadExcelToServer(blob, {
    source_page: 'report',
    upload_type: 'export',
    task_id: selectedTaskId.value,
    filename
  }).catch(() => {})

  ElMessage.success('导出成功')
}

/* ========== v2.0.0: 导入功能 ========== */
const importFileInput = ref(null)

function importRoleRows(row, nameHeader, hoursHeader) {
  const names = String(row[nameHeader] || '').split(/[,，、\s]+/).map(name => name.trim()).filter(Boolean)
  const total = parseFloat(row[hoursHeader]) || 0
  const each = names.length ? total / names.length : 0
  return names.map(staffName => ({ staffName, hours: each }))
}

function buildImportedRoleBuckets(row, headers) {
  return Object.fromEntries(roleStore.list.map(role => {
    const currentNameHeader = `${role.name}姓名`
    const currentHoursHeader = `${role.name}工时`
    if (headers.includes(currentNameHeader)) {
      return [role.key, importRoleRows(row, currentNameHeader, currentHoursHeader)]
    }
    if (role.key === 'ai_dev') {
      if (headers.includes('AI开发工程师姓名')) {
        return [role.key, importRoleRows(row, 'AI开发工程师姓名', 'AI开发工程师工时')]
      }
      return [role.key, [
        ...importRoleRows(row, '前端姓名', '前端工时'),
        ...importRoleRows(row, '后端姓名', '后端工时')
      ]]
    }
    if (role.key === 'voip' && headers.includes('VOIP工程师姓名')) {
      return [role.key, importRoleRows(row, 'VOIP工程师姓名', 'VOIP工程师工时')]
    }
    if (role.key === 'ai_quality') {
      if (headers.includes('AI质量工程师姓名')) {
        return [role.key, importRoleRows(row, 'AI质量工程师姓名', 'AI质量工程师工时')]
      }
      return [role.key, importRoleRows(row, '测试姓名', '测试工时')]
    }
    return [role.key, []]
  }))
}

function triggerImport() {
  importFileInput.value?.click()
}

async function handleImportFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  // 重置 input，允许重复选同一文件
  event.target.value = ''

  try {
    const { headers, rows } = await parseExcelFile(file)
    const expectedHeaders = ['版本号', '需求名称', 'AI产品经理', ...roleStore.list.flatMap(role => [`${role.name}姓名`, `${role.name}工时`]), '备注']
    const previousHeaders = ['版本号', '需求名称', 'AI产品经理', 'AI开发工程师姓名', 'AI开发工程师工时', 'AI质量工程师姓名', 'AI质量工程师工时', '备注']
    const legacyHeaders = ['版本号', '需求名称', '产品经理', '前端姓名', '前端工时', '后端姓名', '后端工时', '测试姓名', '测试工时', '备注']
    if (!validateHeaders(headers, expectedHeaders) && !validateHeaders(headers, previousHeaders) && !validateHeaders(headers, legacyHeaders)) {
      ElMessage.error('页面数据格式不匹配，请重新导入')
      return
    }

    if (rows.length === 0) {
      ElMessage.warning('Excel 中无有效数据行')
      return
    }

    if (!selectedTaskId.value) {
      ElMessage.error('请先选择一个任务周期')
      return
    }

    // 发送到后端导入
    const res = await api.post('/report/import', {
      task_id: selectedTaskId.value,
      rows: rows.map(r => {
        const roleBuckets = buildImportedRoleBuckets(r, headers)
        return {
        version: String(r['版本号'] || '').trim(),
        merged_title: String(r['需求名称'] || '').trim(),
        product_managers: String((r['AI产品经理'] ?? r['产品经理']) || '').trim(),
        role_buckets: roleBuckets,
        ai_dev_name: String(r['AI开发工程师姓名'] || '').trim(),
        ai_dev_hours: parseFloat(r['AI开发工程师工时']) || 0,
        voip_name: String(r['VOIP工程师姓名'] || '').trim(),
        voip_hours: parseFloat(r['VOIP工程师工时']) || 0,
        frontend_name: String(r['前端姓名'] || '').trim(),
        frontend_hours: parseFloat(r['前端工时']) || 0,
        backend_name: String(r['后端姓名'] || '').trim(),
        backend_hours: parseFloat(r['后端工时']) || 0,
        ai_quality_name: String(r['AI质量工程师姓名'] || '').trim(),
        ai_quality_hours: parseFloat(r['AI质量工程师工时']) || 0,
        test_name: String(r['测试姓名'] || '').trim(),
        test_hours: parseFloat(r['测试工时']) || 0,
        remark: String(r['备注'] || '').trim()
      }})
    })

    // 上传原始文件存档
    uploadExcelToServer(file, {
      source_page: 'report',
      upload_type: 'import',
      task_id: selectedTaskId.value,
      filename: file.name
    }).catch(() => {})

    // 刷新页面数据
    await reportStore.fetchByTask(selectedTaskId.value)
    broadcastReportChange('report_imported')
    ElMessage.success(res.message || `导入成功，共 ${rows.length} 条`)
  } catch (err) {
    ElMessage.error(err.response?.data?.message || err.message || '导入失败')
  }
}

function handleDownloadTemplate() {
  downloadTemplate('report')
}

function getSummary({ columns, data }) {
  return columns.map((column, index) => {
    if (index === 0) return h('span', { style: 'font-weight:800; font-size:16px; color:#1D2129;' }, '合计')
    if (column.property?.startsWith('role_') && column.property.endsWith('_hours')) {
      const roleKey = column.property.slice(5, -6)
      const role = roleStore.byKey(roleKey)
      const total = data.reduce((sum, row) => sum + Number(row._roleTotals?.[roleKey] || 0), 0).toFixed(1)
      return h('span', { style: `font-weight:700; font-size:14px; color:${role?.color || '#165DFF'};` }, total)
    }
    if (column.label?.startsWith('总计')) {
      const total = data.reduce((sum, row) => sum + Number(row._rowTotal || 0), 0).toFixed(1)
      return h('span', { style: 'font-weight:800; font-size:15px; color:var(--color-primary);' }, total)
    }
    return ''
  })
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
        <el-button v-if="authStore.hasPermission('btn:report:add_row', 'view')" @click="addManualRow">+ 新增行</el-button>
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
        <button v-if="authStore.hasPermission('btn:report:import', 'view')" class="dt-btn dt-btn-sm dt-btn-outline" @click="triggerImport" title="导入Excel">📥 导入</button>
        <button v-if="authStore.hasPermission('btn:report:template', 'view')" class="dt-btn dt-btn-sm dt-btn-outline" @click="handleDownloadTemplate" title="下载导入模板">📋 模板</button>
        <button v-if="authStore.hasPermission('btn:report:export', 'view')" class="dt-btn dt-btn-sm dt-btn-outline" @click="exportReportData" title="导出当前周期数据">📤 导出</button>
        <span style="width:1px; height:20px; background:var(--color-border-light); margin:0 8px;"></span>
        <button
          v-if="authStore.hasPermission('btn:report:edit_mode', 'view')"
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
            <el-input v-if="canEditRow(row)" v-model="row.version" size="small" @input="scheduleRowAutoSave(row)" @blur="flushRowAutoSave(row)" />
            <span v-else style="font-family:var(--font-mono);">{{ row.version || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="merged_title" label="需求名称" min-width="260">
          <template #default="{ row }">
            <el-input v-if="canEditRow(row)" v-model="row.merged_title" size="small" @input="scheduleRowAutoSave(row)" @blur="flushRowAutoSave(row)" />
            <span v-else style="font-weight:500;">{{ row.merged_title || '(空)' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="AI产品经理" width="150">
          <template #default="{ row }">
            <el-select
              v-if="canEditRow(row)"
              v-model="row.product_managers"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              size="small"
              placeholder="AI产品"
              class="manual-cell-select"
              @change="scheduleRowAutoSave(row)"
            >
              <el-option v-for="pm in pmStore.nameList" :key="pm" :label="pm" :value="pm" />
            </el-select>
            <div v-else-if="Array.isArray(row.product_managers) && row.product_managers.length">
              <div v-for="(pm, i) in row.product_managers" :key="i" style="line-height:1.6;">{{ pm }}</div>
            </div>
            <span v-else style="color:var(--color-text-4);">-</span>
          </template>
        </el-table-column>
        <el-table-column v-for="role in roleStore.list" :key="role.key" align="center">
          <template #header>
            <span class="dt-report-role-header" :title="role.name">{{ roleHeaderLabel(role) }}</span>
          </template>
          <el-table-column :prop="`role_${role.key}_names`" label="姓名" width="130">
            <template #default="{ row }">
              <div v-if="canEditRow(row)" class="role-editor">
                <div v-for="(person, i) in editableRoleRows(row, role.key)" :key="i" class="role-editor-row">
                  <el-select v-model="person.staffName" filterable clearable size="small" :placeholder="role.short_name" class="role-staff-select" @change="scheduleRowAutoSave(row)">
                    <el-option v-for="staff in roleOptions(role.key)" :key="staff.id" :label="staff.name" :value="staff.name" />
                  </el-select>
                  <el-button link type="danger" size="small" class="role-remove-btn" @click="removeRolePerson(row, role.key, i)">×</el-button>
                </div>
              </div>
              <div v-else-if="formatNames(row.role_buckets?.[role.key]).length">
                <div v-for="(name, i) in formatNames(row.role_buckets?.[role.key])" :key="i" style="line-height:1.6;">{{ name }}</div>
              </div>
              <span v-else style="color:var(--color-text-4);">-</span>
            </template>
          </el-table-column>
          <el-table-column :prop="`role_${role.key}_hours`" label="工时/H" width="88" align="center" header-class-name="dt-nowrap-header">
            <template #default="{ row }">
              <div v-if="canEditRow(row)" class="hours-editor">
                <el-input-number
                  v-for="(person, i) in editableRoleRows(row, role.key)"
                  :key="i"
                  v-model="person.hours"
                  :controls="false"
                  :min="0"
                  :precision="1"
                  size="small"
                  class="manual-hours-input"
                  @change="scheduleRowAutoSave(row)"
                  @blur="flushRowAutoSave(row)"
                />
              </div>
              <div v-else-if="formatHoursList(row.role_buckets?.[role.key]).length">
                <div v-for="(hours, i) in formatHoursList(row.role_buckets?.[role.key])" :key="i" :style="{ lineHeight: 1.6, fontWeight: 700, color: role.color }">{{ hours }}</div>
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
            <el-input v-model="row.remark" size="small" placeholder="备注" @input="isManualRow(row) && scheduleRowAutoSave(row)" @blur="saveRemark(row)" />
          </template>
        </el-table-column>
        <!-- 编辑模式操作列 -->
        <el-table-column v-if="editMode" label="操作" width="100" align="center" fixed="right">
          <template #default="{ row }">
            <div v-if="row.status === 'manual_merged'" class="manual-action-cell">
              <span class="dt-tag dt-tag-blue" style="font-size:11px;">自动保存</span>
              <el-button v-if="authStore.hasPermission('btn:report:delete_row', 'view')" type="danger" link size="small" @click="deleteRow(row)">删除</el-button>
            </div>
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
    <!-- v2.0.0: 隐藏文件输入框 -->
    <input ref="importFileInput" type="file" accept=".xlsx,.xls" style="display:none;" @change="handleImportFile" />
    </template>
  </div>
</template>

<style scoped>
/* REQ-29: 工时/H列头不换行 */
:deep(.dt-nowrap-header .cell) {
  white-space: nowrap;
}

.dt-report-role-header {
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

.manual-cell-select {
  width: 100%;
}

.role-editor,
.hours-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
}

.role-editor-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  gap: 4px;
  align-items: center;
}

.role-staff-select,
.manual-hours-input {
  width: 100%;
}

.role-remove-btn {
  padding: 0;
  min-height: 24px;
}

.manual-action-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}
</style>
