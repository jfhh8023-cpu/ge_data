<script setup>
/**
 * FillPage.vue — 填写页（独立布局）
 * v1.6.0: 系统级专属链接支持（无首选任务空态、历史编辑、返回按钮）
 * v1.4.2: 填写页留白再减半、按钮进一步加大、收集状态标签增强
 * v1.4.0: 双栏布局 — 左侧填写表单 + 右侧历史记录面板
 * v1.3.0: 草稿暂存
 * v1.1.0: 编辑状态通知, 任务停止校验
 */
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'
import { broadcastDataChange, SYNC_EVENTS } from '../utils/sync'
import { parseExcelFile, validateHeaders, generateAndDownloadExcel, uploadExcelToServer, downloadTemplate } from '../utils/excel'
import { roleLabel } from '../utils/roles'
import { useDemandSourceStore } from '../stores/demandSources'
import HoursCompletion from '../components/HoursCompletion.vue'
import { summarizeWorkHours, WORK_HOURS_TIP, WORK_HOURS_SCOPE_TIP } from '../utils/workHours'
import { sortRecordsByCreatedAt } from '../utils/recordOrder'
import { FULL_CREDIT_NOTE, POSITIVE_PROGRESS_OPTIONS, isValidSubmittedProgress, isFullCreditRecord, initializeSpecialRow, syncSpecialRow, normalizeProgress, summarizeDraftWeightedHours } from '../utils/effectiveHours'

const route = useRoute()
const demandSourceStore = useDemandSourceStore()
const loading = ref(true)
const submitting = ref(false)
const savingDraft = ref(false)
const fillData = ref(null)
const error = ref('')
const isBlocked = computed(() => fillData.value?.blocked === true)
const blockMessage = computed(() => fillData.value?.message || '用户已离职，无法填写页面数据')

/** 产品经理选项列表（从 API 动态获取） */
const pmOptions = ref([])

/** 表格行数据 */
const rows = ref([])

/** v1.6.0: 当前正在编辑的历史任务（null 表示编辑首选任务） */
const editingHistoryTask = ref(null)

/** 当前表单对应的任务 */
const currentTask = computed(() => editingHistoryTask.value ?? fillData.value?.task ?? null)
const isProductManager = computed(() => fillData.value?.staff?.role === 'ai_pm')
const PROGRESS_OPTIONS = POSITIVE_PROGRESS_OPTIONS
const DEMAND_SOURCE_OPTIONS = computed(() => demandSourceStore.activeNames)

/** 是否有首选任务（用于显示"返回首选"按钮） */
const hasPreferredTask = computed(() => !!fillData.value?.task)

/** 左侧面板是否可填写（有首选任务或正在编辑历史任务） */
const canFill = computed(() => !!currentTask.value)

/**
 * v1.6.2: 当前任务是否可编辑保存
 * - 编辑首选任务：始终可编辑（active）
 * - 编辑历史任务：仅 active 时可编辑，closed 时只读
 */
const isEditable = computed(() => {
  if (isBlocked.value) return false
  if (!currentTask.value) return false
  return currentTask.value.status === 'active'
})

/** 创建空行 */
function createEmptyRow() {
  return { draft_row_id: crypto.randomUUID(), requirement_title: '', version: '', product_managers: [], demand_sources: [], demand_source_weights: {}, hours: null, delivery_progress: null }
}

function handleRequirementTitle(row, title) {
  row.requirement_title = title
  syncSpecialRow(row)
}

function defaultDemandSourceWeights(sources = []) {
  const list = [...new Set((Array.isArray(sources) ? sources : []).filter(source => DEMAND_SOURCE_OPTIONS.value.includes(source)))]
  if (!list.length) return {}
  const equal = Number((100 / list.length).toFixed(2))
  const weights = Object.fromEntries(list.map(source => [source, equal]))
  weights[list[list.length - 1]] = Number((equal + 100 - equal * list.length).toFixed(2))
  return weights
}

function normalizedDemandSourceWeights(row) {
  const sources = Array.isArray(row.demand_sources) ? row.demand_sources : []
  const raw = row.demand_source_weights && typeof row.demand_source_weights === 'object' ? row.demand_source_weights : {}
  const values = sources.map(source => Number(raw[source])).map(value => Number.isFinite(value) && value >= 0 ? value : 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return defaultDemandSourceWeights(sources)
  const weights = {}
  sources.forEach((source, index) => { weights[source] = Number((values[index] * 100 / total).toFixed(2)) })
  const roundedTotal = Object.values(weights).reduce((sum, value) => sum + value, 0)
  if (sources.length) weights[sources[sources.length - 1]] = Number((weights[sources[sources.length - 1]] + 100 - roundedTotal).toFixed(2))
  return weights
}

function handleDemandSourcesChange(row) {
  row.demand_source_weights = defaultDemandSourceWeights(row.demand_sources)
}

function resetDemandSourceWeights(row) {
  row.demand_source_weights = defaultDemandSourceWeights(row.demand_sources)
}

function demandSourceWeightTotal(row) {
  return Number(Object.values(row.demand_source_weights || {}).reduce((sum, value) => sum + Number(value || 0), 0).toFixed(2))
}

function pickPmValue(row) {
  return row['AI产品经理'] ?? row['产品经理'] ?? ''
}

onMounted(async () => {
  try {
    // 并行加载填写数据和 PM 列表
    const [fillRes, pmRes] = await Promise.all([
      api.get(`/fill/${route.params.token}`),
      api.get('/pm').catch(() => ({ data: [] }))
    ])
    fillData.value = fillRes.data
    if (Array.isArray(fillData.value?.demandSources)) demandSourceStore.apply(fillData.value.demandSources)
    else await demandSourceStore.fetchAll()
    // 初始化 PM 选项（仅活跃的 PM）
    const pmList = Array.isArray(pmRes.data) ? pmRes.data : []
    pmOptions.value = pmList
      .filter(p => (p.employment_status || (p.is_active === false ? 'resigned' : 'active')) !== 'resigned')
      .map(p => p.name)
    if (fillData.value?.blocked) return
    if (fillData.value?.task) {
      // 有首选任务时，尝试恢复草稿或已提交记录
      if (Array.isArray(fillRes.data.draft_records) && fillRes.data.draft_records.length > 0) {
        rows.value = normalizeRows(fillRes.data.draft_records)
        ElMessage.success('已恢复上次暂存的草稿')
      } else if (fillRes.data.records?.length > 0) {
        rows.value = normalizeRows(fillRes.data.records)
      } else if (fillRes.data.carry_over_records?.length > 0) {
        rows.value = normalizeRows(fillRes.data.carry_over_records, { newRows: true })
        ElMessage.info(`已带出 ${rows.value.length} 条上周未完成需求，请填写本周工时并更新进度`)
      } else {
        rows.value = [createEmptyRow()]
      }
      // v1.6.2: 页面打开后立即发送 editing 通知，并维持 keep-alive
      startEditingKeepAlive()
    }
    loadHistory()
  } catch {
    error.value = '链接无效或已过期'
  } finally {
    loading.value = false
  }
})

function normalizeRows(list, { newRows = false } = {}) {
  return list.map(r => {
    const existingId = newRows ? '' : r.id || r.existing_record_id || ''
    const original = r.id ? r : (fillData.value?.records || []).find(saved => saved.id === existingId)
    const originalProgressMissing = !newRows && Boolean(existingId) && (original
      ? !isFullCreditRecord(original) && normalizeProgress(original.delivery_progress) === null
      : r._original_progress_missing === true)
    // product_managers 可能是数组，也可能是 JSON 字符串（来自数据库原始返回）
    let pm = r.product_managers
    if (!Array.isArray(pm)) {
      try { pm = JSON.parse(pm) } catch { pm = [] }
      if (!Array.isArray(pm)) pm = []
    }
    const carryOver = r._carry_over && typeof r._carry_over === 'object'
      ? { ...r._carry_over, original_title: r._carry_over.original_title ?? String(r.requirement_title || '').trim(), original_version: r._carry_over.original_version ?? String(r.version || '').trim() }
      : undefined
    return initializeSpecialRow({
      existing_record_id: existingId,
      _original_progress_missing: originalProgressMissing,
      ...(carryOver ? { _carry_over: carryOver } : {}),
      draft_row_id: r.draft_row_id || crypto.randomUUID(),
      created_at: r.created_at,
      automatic_version_date: r.automatic_version_date,
      _ordinary_fields: r._ordinary_fields,
      requirement_title: r.requirement_title || '',
      version: r.version || '',
      product_managers: pm,
      demand_sources: Array.isArray(r.demand_sources) ? r.demand_sources : (() => { try { const x = JSON.parse(r.demand_sources || '[]'); return Array.isArray(x) ? x : [] } catch { return [] } })(),
      demand_source_weights: r.demand_source_weights && typeof r.demand_source_weights === 'object'
        ? { ...r.demand_source_weights }
        : (() => { try { return JSON.parse(r.demand_source_weights || '{}') } catch { return {} } })(),
      delivery_progress: normalizeProgress(r.delivery_progress),
      hours: (r.hours === null || r.hours === undefined || r.hours === '') ? null : parseFloat(r.hours)
    }, new Date(), { newRow: newRows })
  })
}

/** REQ-070: 带出行标签 */
function carryOverSourceLabel(row) {
  const info = row?._carry_over
  if (!info) return ''
  return info.source_week_number ? `第${info.source_week_number}周未完成` : `${info.source_task_title || '上周'}未完成`
}
function isCarryOverModified(row) {
  const info = row?._carry_over
  if (!info) return false
  return String(row.requirement_title || '').trim() !== info.original_title || String(row.version || '').trim() !== info.original_version
}

/** 新增行 */
function addRow() { rows.value.push(createEmptyRow()) }

/** 删除行 */
function removeRow(index) {
  if (rows.value.length <= 1) { ElMessage.warning('至少保留一行'); return }
  rows.value.splice(index, 1)
}

/** 工时总计 */
const totalHours = computed(() =>
  rows.value.reduce((sum, r) => sum + (parseFloat(r.hours) || 0), 0).toFixed(2)
)
const draftWorkHours = computed(() => {
  const baseline = currentTask.value?.workHours
  if (!baseline || !Array.isArray(baseline.units)) return null
  return {
    ...baseline,
    ...summarizeWorkHours(rows.value, baseline.units),
    scopeNote: typeof baseline.scopeNote === 'string' ? baseline.scopeNote : ''
  }
})
const draftWeightedHours = computed(() => summarizeDraftWeightedHours(rows.value, draftWorkHours.value?.standardHours))

function hasSelectedProductManager(row) {
  return Array.isArray(row.product_managers)
    && row.product_managers.some(pm => typeof pm === 'string' && pm.trim())
}

/* ========== REQ-17 / v1.6.2: 编辑状态通知 ========== */
let editingTimer = null
let keepAliveTimer = null  // 定时保持 editing 状态（避免 30s 超时）

async function notifyEditing() {
  try {
    if (isBlocked.value) return
    const taskId = currentTask.value?.id
    if (!taskId) return
    await api.put(`/fill/${route.params.token}/editing`, { task_id: taskId })
  } catch { /* 静默失败 */ }
}

/** 输入框获焦时触发（节流 10 秒） */
function handleInputFocus() {
  if (editingTimer) return
  notifyEditing()
  editingTimer = setTimeout(() => { editingTimer = null }, 10000)
}

/** 启动 keep-alive：每 20s 重新通知，维持 30s editing 窗口 */
function startEditingKeepAlive() {
  stopEditingKeepAlive()
  notifyEditing()  // 立即通知一次
  keepAliveTimer = setInterval(notifyEditing, 20000)
}

function stopEditingKeepAlive() {
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null }
}

onUnmounted(() => {
  if (editingTimer) clearTimeout(editingTimer)
  stopEditingKeepAlive()
})

/** 提交工时 */
async function handleSubmit() {
  if (isBlocked.value) return ElMessage.error(blockMessage.value)
  if (!currentTask.value) return
  const validRows = rows.value
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.requirement_title && row.hours > 0)
  if (validRows.length === 0) {
    ElMessage.warning('请至少填写一条完整的工时记录')
    return
  }
  const missingPm = !isProductManager.value && validRows.find(({ row }) => !isFullCreditRecord(row) && !hasSelectedProductManager(row))
  if (missingPm) {
    ElMessage.warning(`第 ${missingPm.index + 1} 行请选择AI产品经理`)
    return
  }
  const missingDemandSource = isProductManager.value && validRows.find(({ row }) => !isFullCreditRecord(row) && (!Array.isArray(row.demand_sources) || row.demand_sources.length === 0))
  if (missingDemandSource) {
    ElMessage.warning(`第 ${missingDemandSource.index + 1} 行请选择需求方`)
    return
  }
  const invalidDemandWeights = isProductManager.value && validRows.find(({ row }) => {
    if (isFullCreditRecord(row) || !row.demand_sources?.length) return false
    const total = demandSourceWeightTotal(row)
    return Math.abs(total - 100) > 0.01
  })
  if (invalidDemandWeights) {
    ElMessage.warning(`第 ${invalidDemandWeights.index + 1} 行需求方分配比例合计必须为100%`)
    return
  }
  const invalidProgress = validRows.find(({ row }) => !isValidSubmittedProgress(row))
  if (invalidProgress) {
    ElMessage.warning(`第 ${invalidProgress.index + 1} 行交付进度请选择1%或10%至100%（每10%一档），普通需求提交时不能为0%`)
    return
  }
  const records = validRows.map(({ row }) => ({
    existing_record_id: row.existing_record_id || undefined,
    draft_row_id: row.draft_row_id,
    automatic_version_date: row.automatic_version_date,
    requirement_title: String(row.requirement_title || '').trim(),
    version: row.version || '',
    product_managers: row.product_managers,
    demand_sources: row.demand_sources,
    demand_source_weights: isProductManager.value ? normalizedDemandSourceWeights(row) : undefined,
    delivery_progress: normalizeProgress(row.delivery_progress),
    hours: row.hours
  }))

  submitting.value = true
  try {
    const payload = { records }
    // 新体系必须传 task_id
    if (fillData.value?.linkType === 'system') {
      payload.task_id = currentTask.value.id
    }
    await api.post(`/fill/${route.params.token}/submit`, payload)
    // A formerly empty historical progress loses its exception once a real value is saved.
    rows.value.forEach(row => {
      if (isFullCreditRecord(row) || normalizeProgress(row.delivery_progress) !== null) row._original_progress_missing = false
    })

    const isEdit = !!editingHistoryTask.value
    ElMessage.success(isEdit
      ? `历史数据编辑完成！共 ${records.length} 条记录`
      : `提交成功！共 ${records.length} 条记录，总工时 ${totalHours.value} 小时`
    )
    broadcastDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, { token: route.params.token })

    if (isEdit) {
      // 编辑完成后退出编辑模式，回到首选任务
      returnToPreferred()
    }
    loadHistory()
  } catch (err) {
    const msg = err.response?.data?.message || '提交失败'
    ElMessage.error(msg)
  } finally {
    submitting.value = false
  }
}

/** 暂存草稿 */
async function handleSaveDraft() {
  if (isBlocked.value) return ElMessage.error(blockMessage.value)
  if (savingDraft.value) return
  savingDraft.value = true
  try {
    const draftSnapshot = rows.value.map(row => ({ ...row }))
    const payload = { draft_records: draftSnapshot }
    if (fillData.value?.linkType === 'system' && currentTask.value) {
      payload.task_id = currentTask.value.id
    }
    const response = await api.put(`/fill/${route.params.token}/draft`, payload)
    // Reconcile the server's fixed date without replacing hours typed during the request.
    for (const saved of response.data?.draft_records || []) {
      const row = rows.value.find(item => item.draft_row_id === saved.draft_row_id)
      const sent = draftSnapshot.find(item => item.draft_row_id === saved.draft_row_id)
      if (row && sent && row.requirement_title === sent.requirement_title && isFullCreditRecord(row)) {
        row.version = saved.version
        row.automatic_version_date = saved.automatic_version_date
      }
    }
    ElMessage.success('草稿已暂存')
    broadcastDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, { token: route.params.token })
  } catch (err) {
    const msg = err.response?.data?.message || '草稿暂存失败'
    ElMessage.error(msg)
  } finally {
    savingDraft.value = false
  }
}

/* ========== v1.6.0: 历史任务编辑 ========== */

/** 点击历史任务"编辑"按钮 — 加载该任务记录到左侧表单 */
async function loadHistoryForEdit(task) {
  try {
    // 拦截器已解包: res = { code, data: { task, records } }
    const res = await api.get(`/fill/${route.params.token}/task/${task.id}/records`)
    const records = res.data?.records || []
    rows.value = records.length > 0 ? normalizeRows(records) : [createEmptyRow()]
    editingHistoryTask.value = { ...task, ...(res.data?.task || {}) }
    // v1.6.2: 进入编辑模式后立即通知后台，keep-alive 重新绑定新任务 id
    startEditingKeepAlive()
  } catch {
    ElMessage.error('加载历史数据失败')
  }
}

/** 返回首选任务 */
function returnToPreferred() {
  editingHistoryTask.value = null
  const preferred = fillData.value?.task
  if (preferred && Array.isArray(fillData.value?.draft_records) && fillData.value.draft_records.length > 0) {
    rows.value = normalizeRows(fillData.value.draft_records)
  } else if (preferred && fillData.value?.records?.length > 0) {
    rows.value = normalizeRows(fillData.value.records)
  } else if (preferred && fillData.value.carry_over_records?.length > 0) {
    rows.value = normalizeRows(fillData.value.carry_over_records, { newRows: true })
  } else {
    rows.value = [createEmptyRow()]
  }
  // v1.6.2: 切回首选任务后重新绑定 keep-alive（通知后台）
  if (preferred) startEditingKeepAlive()
}

/* ========== 一键识别 ========== */
const recognizeText = ref('')
const HOURS_PER_DAY = 8
const HOURS_MIN = 1
const HOURS_MAX = 60

function matchPM(text) {
  let remaining = text; const matched = []
  const availablePms = Array.isArray(pmOptions.value) ? pmOptions.value.filter(Boolean) : []
  for (const pmName of availablePms) {
    if (remaining.includes(pmName)) { matched.push(pmName); remaining = remaining.replace(pmName, '').trim() }
  }
  if (matched.length === 0) {
    const candidates = []
    for (const pmName of availablePms) {
      let mc = 0
      for (const char of pmName) { if (remaining.includes(char)) mc++ }
      if (mc > 0) candidates.push({ name: pmName, matchCount: mc, ratio: mc / pmName.length })
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.ratio - a.ratio || b.matchCount - a.matchCount)
      matched.push(candidates[0].name)
      for (const char of candidates[0].name) { remaining = remaining.replace(char, '') }
      remaining = remaining.trim()
    }
  }
  return { matched, remaining }
}

function parseHoursFromText(text) {
  let remaining = text
  const dayMatch = remaining.match(/(\d+(?:\.\d+)?)\s*(?:天|d|D|日)/)
  if (dayMatch) { remaining = remaining.replace(dayMatch[0], '').trim(); return { hours: parseFloat(dayMatch[1]) * HOURS_PER_DAY, remaining } }
  const hourMatch = remaining.match(/(\d+(?:\.\d+)?)\s*(?:h|H|小时|时)/)
  if (hourMatch) { remaining = remaining.replace(hourMatch[0], '').trim(); return { hours: parseFloat(hourMatch[1]), remaining } }
  const tailMatch = remaining.match(/(\d+(?:\.\d+)?)\s*$/)
  if (tailMatch) { const val = parseFloat(tailMatch[1]); if (val >= HOURS_MIN && val <= HOURS_MAX) { remaining = remaining.slice(0, -tailMatch[0].length).trim(); return { hours: val, remaining } } }
  return { hours: null, remaining }
}

function parseRecognizeText() {
  const text = recognizeText.value.trim()
  if (!text) { ElMessage.warning('请粘贴待识别文本'); return }
  const lines = text.split('\n').filter(l => l.trim())
  const parsed = []
  const VERSION_RE = /V?\d+\.\d+(?:\.\d+)?/i
  for (const rawLine of lines) {
    if (isProductManager.value) {
      let remaining = rawLine.trim()
      const demand_sources = DEMAND_SOURCE_OPTIONS.value.filter(source => remaining.includes(source))
      demand_sources.forEach(source => { remaining = remaining.replaceAll(source, ' ') })
      const progressMatch = remaining.match(/(?:进度\s*)?(100|[0-9]0)\s*%/)
      const delivery_progress = progressMatch ? Number(progressMatch[1]) : null
      if (progressMatch) remaining = remaining.replace(progressMatch[0], ' ')
      const { hours, remaining: afterHours } = parseHoursFromText(remaining)
      remaining = afterHours
      const versionMatch = remaining.match(VERSION_RE)
      const version = versionMatch ? versionMatch[0] : ''
      if (versionMatch) remaining = remaining.replace(versionMatch[0], ' ')
      const requirement_title = remaining.replace(/[|\t]/g, ' ').replace(/\s{2,}/g, ' ').trim()
      if (requirement_title || hours) parsed.push({ requirement_title, version, product_managers: [], demand_sources, demand_source_weights: defaultDemandSourceWeights(demand_sources), delivery_progress, hours })
      continue
    }
    let remaining = rawLine.trim()
    let version = ''; let hours = null; let pm = []
    let tokens = null
    if (remaining.includes('|')) { tokens = remaining.split('|').map(t => t.trim()).filter(Boolean) }
    else if (remaining.includes('\t')) { tokens = remaining.split('\t').map(t => t.trim()).filter(Boolean) }
    if (tokens && tokens.length >= 2) {
      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i]
        if (hours === null) { const { hours: h } = parseHoursFromText(t); if (h !== null) { hours = h; tokens.splice(i, 1); continue } }
        if (!version) { const vm = t.match(/^(V?\d+\.\d+(?:\.\d+)?)$/i); if (vm) { version = vm[1]; tokens.splice(i, 1); continue } }
        if (pmOptions.value.includes(t)) { pm.push(t); tokens.splice(i, 1); continue }
      }
      const leftover = tokens.join(' ').trim()
      if (pm.length === 0 && leftover) { const { matched, remaining: cleanTitle } = matchPM(leftover); pm = matched; const title = cleanTitle.replace(/^[\s|,，、]+/, '').replace(/[\s|,，、]+$/, '').trim(); if (title || hours) parsed.push({ requirement_title: title, version, product_managers: pm, hours }) }
      else { if (leftover || hours) parsed.push({ requirement_title: leftover, version, product_managers: pm, hours }) }
    } else {
      const vMatch = remaining.match(VERSION_RE); if (vMatch) { version = vMatch[0]; remaining = remaining.replace(vMatch[0], '').trim() }
      const { hours: parsedH, remaining: afterH } = parseHoursFromText(remaining); hours = parsedH; remaining = afterH
      const { matched, remaining: afterPM } = matchPM(remaining); pm = matched; remaining = afterPM
      const title = remaining.replace(/^[\s|,，、]+/, '').replace(/[\s|,，、]+$/, '').replace(/\s{2,}/g, ' ').trim()
      if (title || hours) parsed.push({ requirement_title: title, version, product_managers: pm, hours })
    }
  }
  if (parsed.length === 0) { ElMessage.warning('未识别到有效数据'); return }
  const recognizedRows = normalizeRows(parsed, { newRows: true })
  if (rows.value.length === 1 && !rows.value[0].requirement_title && !rows.value[0].hours) { rows.value = recognizedRows } else { rows.value.push(...recognizedRows) }
  recognizeText.value = ''
  ElMessage.success(`成功识别 ${parsed.length} 条记录`)
}

/* ========== v1.4.0: 右侧历史记录面板 ========== */
const CURRENT_YEAR = new Date().getFullYear()
const QUARTER_OPTIONS = ['Q1', 'Q2', 'Q3', 'Q4']

const historyLoading = ref(false)
const historyTasks = ref([])
const historyYear = ref(CURRENT_YEAR)
const historyQuarter = ref(getCurrentQuarter())
const historyExpanded = ref({})

function getCurrentQuarter() {
  const m = new Date().getMonth() + 1
  return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'
}

const historyYearOptions = computed(() => {
  const years = new Set([CURRENT_YEAR, CURRENT_YEAR + 1])
  for (const t of historyTasks.value) { if (t.year) years.add(t.year) }
  return [...years].sort((a, b) => b - a)
})

function getTaskQuarter(task) {
  const refDate = task.end_date ? new Date(task.end_date) : (task.start_date ? new Date(task.start_date) : null)
  if (!refDate) return 'Q1'
  const m = refDate.getMonth() + 1
  return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'
}

const filteredHistory = computed(() =>
  historyTasks.value.filter(t => {
    const y = t.year || CURRENT_YEAR
    return y === historyYear.value && getTaskQuarter(t) === historyQuarter.value
  })
)

async function loadHistory() {
  historyLoading.value = true
  try {
    const res = await api.get(`/fill/${route.params.token}/history`)
    const data = res.data?.data || res.data || {}
    historyTasks.value = (data.tasks || []).map(task => ({
      ...task,
      records: sortRecordsByCreatedAt(task.records)
    }))
    const current = filteredHistory.value
    if (current.length > 0) historyExpanded.value[current[0].id] = true
  } catch { /* 静默 */ } finally {
    historyLoading.value = false
  }
}

function toggleHistoryTask(taskId) {
  historyExpanded.value[taskId] = !historyExpanded.value[taskId]
}

const historyQuarterCounts = computed(() => {
  const counts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
  for (const t of historyTasks.value) {
    const y = t.year || CURRENT_YEAR
    if (y !== historyYear.value) continue
    const q = getTaskQuarter(t)
    if (counts[q] !== undefined) counts[q]++
  }
  return counts
})

/* ========== v2.0.0: 左栏导入功能 ========== */
const fillImportInput = ref(null)

function triggerFillImport() {
  fillImportInput.value?.click()
}

async function handleFillImport(event) {
  const file = event.target.files?.[0]
  if (!file) return
  event.target.value = ''

  try {
    const { headers, rows: excelRows } = await parseExcelFile(file)
    const expectedHeaders = isProductManager.value
      ? ['需求标题', '版本号', '需求方', '工时(小时)', '交付进度']
      : ['需求标题', '版本号', 'AI产品经理', '工时(小时)', '交付进度']
    const legacyHeaders = ['需求标题', '版本号', '产品经理', '工时(小时)']
    if (!validateHeaders(headers, expectedHeaders) && !validateHeaders(headers, legacyHeaders)) {
      ElMessage.error('页面数据格式不匹配，请重新导入')
      return
    }
    if (excelRows.length === 0) {
      ElMessage.warning('Excel 中无有效数据行')
      return
    }

    const parsed = normalizeRows(excelRows.map(r => ({
      requirement_title: String(r['需求标题'] || '').trim(),
      version: String(r['版本号'] || '').trim(),
      product_managers: String(pickPmValue(r) || '').trim()
        ? String(pickPmValue(r)).split(/[,，、\s]+/).filter(Boolean)
        : [],
      demand_sources: isProductManager.value
        ? String(r['需求方'] || '').split(/[,，、\s]+/).filter(source => DEMAND_SOURCE_OPTIONS.value.includes(source))
        : [],
      demand_source_weights: isProductManager.value
        ? defaultDemandSourceWeights(String(r['需求方'] || '').split(/[,，、\s]+/).filter(source => DEMAND_SOURCE_OPTIONS.value.includes(source)))
        : {},
      delivery_progress: r['交付进度'] === '' || r['交付进度'] === undefined ? null : Number(String(r['交付进度']).replace('%', '')),
      hours: parseFloat(r['工时(小时)']) || 0
    })), { newRows: true })

    // 追加到当前行（若当前仅一空行则替换）
    const missingPmIndex = !isProductManager.value && parsed.findIndex(r => r.requirement_title && r.hours > 0 && !isFullCreditRecord(r) && !hasSelectedProductManager(r))
    if (missingPmIndex !== false && missingPmIndex >= 0) {
      ElMessage.warning(`Excel 第 ${missingPmIndex + 2} 行未填写AI产品经理`)
      return
    }
    const missingSourceIndex = isProductManager.value && parsed.findIndex(r => r.requirement_title && r.hours > 0 && !isFullCreditRecord(r) && !r.demand_sources?.length)
    if (missingSourceIndex !== false && missingSourceIndex >= 0) {
      ElMessage.warning(`Excel 第 ${missingSourceIndex + 2} 行未填写需求方`)
      return
    }
    const invalidProgressIndex = parsed.findIndex(r => r.requirement_title && r.hours > 0 && !isValidSubmittedProgress(r))
    if (invalidProgressIndex >= 0 && headers.includes('交付进度')) {
      ElMessage.warning(`Excel 第 ${invalidProgressIndex + 2} 行交付进度请选择1%或10%至100%（每10%一档），不能为0%`)
      return
    }

    if (rows.value.length === 1 && !rows.value[0].requirement_title && !rows.value[0].hours) {
      rows.value = parsed
    } else {
      rows.value.push(...parsed)
    }

    // 存档
    uploadExcelToServer(file, {
      source_page: 'fill',
      upload_type: 'import',
      task_id: currentTask.value?.id,
      staff_id: fillData.value?.staff?.id,
      filename: file.name
    }).catch(() => {})

    ElMessage.success(`成功导入 ${parsed.length} 条记录`)
  } catch (err) {
    ElMessage.error(err.message || '导入失败')
  }
}

function handleFillDownloadTemplate() {
  downloadTemplate('fill')
}

/* ========== v2.0.0: 右栏历史导出 ========== */
function exportHistory() {
  if (historyTasks.value.length === 0) {
    ElMessage.warning('暂无历史数据可导出')
    return
  }

  const sheets = []
  const quarterGroups = {}

  for (const task of historyTasks.value) {
    const y = task.year || CURRENT_YEAR
    const q = getTaskQuarter(task)
    const key = `${y}年${q}`
    if (!quarterGroups[key]) quarterGroups[key] = []
    quarterGroups[key].push(task)
  }

  for (const [sheetName, tasks] of Object.entries(quarterGroups)) {
    const header = ['任务周期', '需求标题', '版本号', 'AI产品经理', '工时(小时)', '日期范围']
    const data = [header]
    for (const task of tasks) {
      const dateRange = `${task.start_date || ''} ~ ${task.end_date || ''}`
      if (task.records && task.records.length > 0) {
        for (const rec of task.records) {
          data.push([
            task.title,
            rec.requirement_title || '',
            rec.version || '',
            Array.isArray(rec.product_managers) ? rec.product_managers.join(', ') : (rec.product_managers || ''),
            parseFloat(rec.hours || 0),
            dateRange
          ])
        }
      } else {
        data.push([task.title, '', '', '', 0, dateRange])
      }
    }
    sheets.push({ name: sheetName.slice(0, 31), data, colWidths: [30, 30, 14, 14, 10, 22] })
  }

  const metricValue = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value)
  sheets.push({
    name: '周期工时完成度',
    data: [
      ['任务周期', '日期范围', '已填工时/h', '标准工时/h', '人工作日', '工时完成度/%', '超额/%', '日历状态', '统计范围'],
      ...historyTasks.value.map(task => {
        const metric = task.workHours
        return [task.title, `${task.start_date || ''} ~ ${task.end_date || ''}`, metricValue(metric?.actualHours), metricValue(metric?.standardHours), metricValue(metric?.workingDays), metricValue(metric?.completionRate), metricValue(metric?.excessRate), metric?.calendarStatus || '未提供', metric?.scopeNote || '']
      })
    ],
    colWidths: [30, 24, 14, 14, 12, 18, 14, 20, 70]
  })
  sheets.push({
    name: '指标说明',
    data: [
      ['指标', '计算与展示说明'],
      ['工时完成度', WORK_HOURS_TIP],
      ['工作日与人员范围', WORK_HOURS_SCOPE_TIP],
      ['预估加权工时完成度', '填写页仅按当前表单预估：[Σ(普通含版本工时×人工需求进度)＋五类有效工时]÷所属周应填工时×100%；统计加权交付率按所选完整周期应交付工时计算，缺填周计0工时但保留应交付工时。普通无版本不计分子；已有历史空进度只在计算时按100%，明确0仍按0，新行未填进度显示待补进度，正式提交须1%或10%至100%（每10%一档）。'],
      ['五类有效工时', FULL_CREDIT_NOTE],
      ['需求进度展示', '历史列表显示实际保存的需求进度；缺失显示未填写，五类有效工时显示不适用，不覆盖为100%。工时完成度见周期工时完成度表。'],
      ['缺失值', '未取得标准工时、日历或指标时保留空缺，不按0%或100%替代。']
    ],
    colWidths: [20, 120]
  })

  const staffName = fillData.value?.staff?.name || '用户'
  const filename = `${staffName}_${historyYear.value}年历史工时.xlsx`

  const blob = generateAndDownloadExcel({ filename, sheets })

  uploadExcelToServer(blob, {
    source_page: 'fill-history',
    upload_type: 'export',
    staff_id: fillData.value?.staff?.id,
    filename
  }).catch(() => {})

  ElMessage.success('导出成功')
}
</script>

<template>
  <div class="fill-page-root">
    <!-- 加载状态 -->
    <div v-if="loading" style="background:var(--color-bg-white); border-radius:12px; padding:60px; max-width:900px; margin:0 auto;">
      <el-skeleton :rows="6" animated />
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" style="background:var(--color-bg-white); border-radius:12px; box-shadow:var(--shadow-1); padding:80px; text-align:center; max-width:600px; margin:0 auto;">
      <div style="font-size:40px; margin-bottom:12px; opacity:0.4;">⚠️</div>
      <p style="font-size:14px; color:var(--color-text-3);">{{ error }}</p>
    </div>

    <!-- 离职阻断：链接可访问，但页面不可操作 -->
    <template v-else-if="isBlocked">
      <div class="fill-blocked-shell"></div>
      <el-dialog
        :model-value="true"
        width="380px"
        align-center
        append-to-body
        :show-close="false"
        :close-on-click-modal="false"
        :close-on-press-escape="false"
        class="fill-blocked-dialog"
      >
        <div class="fill-blocked-content">
          <div class="fill-blocked-title">{{ blockMessage }}</div>
        </div>
      </el-dialog>
    </template>

    <!-- 双栏布局 — 左侧表单 + 右侧历史 -->
    <div v-else class="fill-dual-layout">
      <!-- ====== 左栏：填写表单 ====== -->
      <div class="fill-left-panel">
        <!-- v1.6.1: 编辑历史提示横条（卡片外部，顶部） -->
        <div v-if="editingHistoryTask" class="fill-edit-banner">
          <span class="fill-edit-banner-title">【编辑历史数据】{{ editingHistoryTask.title }}</span>
          <el-button
            v-if="hasPreferredTask"
            type="primary" link size="small"
            class="fill-edit-banner-back"
            @click="returnToPreferred"
          >← 返回最新工时收集</el-button>
        </div>

        <div style="background:var(--color-bg-white); border-radius:12px; box-shadow:var(--shadow-1); overflow:hidden;">

          <!-- v1.6.0: 无首选任务空态 -->
          <div v-if="!canFill" class="fill-no-task">
            <div class="fill-no-task-icon">📭</div>
            <p class="fill-no-task-text">暂无开放中的收集任务</p>
            <p class="fill-no-task-sub">管理员尚未设置首选收集任务，请稍后再试</p>
          </div>

          <!-- 有任务时的表单 -->
          <template v-else>
            <!-- 标题区 -->
            <div style="padding:10px 18px 8px; border-bottom:1px solid var(--color-border-light);">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
                <div style="min-width:0; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
                  <h1 style="font-size:18px; line-height:1.25; font-weight:700; color:var(--color-text-1); margin-bottom:0;">
                    {{ currentTask?.title || '工作统计' }}
                  </h1>
                  <p style="font-size:13px; line-height:1.35; color:var(--color-text-3);">
                    【{{ roleLabel(fillData?.staff?.role) }}】{{ fillData?.staff?.name }} 工作内容填写
                  </p>
                </div>
                <span
                  class="fill-collect-status"
                  :class="currentTask?.status === 'active' ? 'fill-collect-active' : 'fill-collect-closed'"
                >
                  <span class="fill-collect-dot"></span>
                  {{ currentTask?.status === 'active' ? '正在收集中' : '收集已停止' }}
                </span>
              </div>
            </div>

            <!-- v1.6.2: 任务已停止时显示只读提示条 -->
            <div v-if="!isEditable" class="fill-readonly-bar">
              🔒 该任务已停止收集，数据仅供查看，无法提交或修改
            </div>

            <div class="fill-hours-summary">
              <HoursCompletion v-if="draftWorkHours" :metric="draftWorkHours" :weighted-metric="draftWeightedHours" preview />
            </div>

            <!-- 表格区 -->
            <div style="padding:20px 32px;">
              <!-- v2.0.0: Excel导入（仅可编辑时显示） -->
              <div v-if="isEditable" style="display:flex; gap:8px; margin-bottom:10px;">
                <el-button size="small" @click="triggerFillImport">📥 导入Excel</el-button>
                <el-button size="small" @click="handleFillDownloadTemplate">📋 下载模板</el-button>
              </div>
              <!-- 一键识别（仅可编辑时显示） -->
              <div v-if="isEditable" style="background:var(--color-bg-2); border-radius:8px; padding:14px; margin-bottom:14px; border:1px solid var(--color-border-light);">
                <p style="font-size:12px; color:var(--color-text-3); margin-bottom:6px;">
                  <span v-if="isProductManager">粘贴文本，每行一条。格式：<code style="background:var(--color-bg-white); padding:2px 6px; border-radius:4px;">V4.633.0 | 用户中心改版 | 客户需求,内部需求 | 5h | 80%</code>；对外服务包含售前、运营、业务培训等服务事项。</span>
                  <span v-else>粘贴文本，每行一条。格式：<code style="background:var(--color-bg-white); padding:2px 6px; border-radius:4px;">V4.633.0 用户中心改版 杨瑞 5h 80%</code></span>
                </p>
                <el-input v-model="recognizeText" type="textarea" :rows="2" placeholder="在此粘贴文本内容..." />
                <div style="display:flex; justify-content:flex-end; margin-top:6px;">
                  <el-button type="primary" size="small" @click="parseRecognizeText" :disabled="!recognizeText.trim()">🔍 识别并填入</el-button>
                </div>
              </div>

              <el-table :data="rows" border size="small" style="width:100%;">
                <el-table-column type="index" label="#" width="45" align="center" />
                <el-table-column label="需求标题" min-width="260">
                  <template #default="{ row }">
                    <el-input :model-value="row.requirement_title" @update:model-value="value => handleRequirementTitle(row, value)" placeholder="输入需求名称" size="small"
                      :disabled="!isEditable" @focus="handleInputFocus" />
                    <div v-if="row._carry_over" class="fill-carry-over-tag" :title="row._carry_over.source_task_title">
                      {{ carryOverSourceLabel(row) }} · 上次进度 {{ row._carry_over.previous_progress }}%<span v-if="isCarryOverModified(row)">（已修改，将作为新需求统计）</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="版本号" width="120">
                  <template #default="{ row }">
                    <el-tooltip :disabled="!isFullCreditRecord(row)" content="五类有效工时（标题为或以请假、培训、公司会议、出差、团建结尾）的版本号按首次填报日期自动生成并锁定（vYYMMDD），工时仍由本人填写。" placement="top">
                      <el-input v-model="row.version" :placeholder="isFullCreditRecord(row) ? '自动版本' : 'V4.633.0'" size="small"
                        :readonly="isFullCreditRecord(row)" :class="{ 'fill-fixed-version': isFullCreditRecord(row) }" :disabled="!isEditable" @focus="handleInputFocus" />
                    </el-tooltip>
                  </template>
                </el-table-column>
                <el-table-column v-if="!isProductManager" label="AI产品经理" width="160">
                  <template #header>
                    <span>AI产品经理 <span style="color:#F53F3F;">*</span></span>
                  </template>
                  <template #default="{ row }">
                    <span v-if="isFullCreditRecord(row)" class="fill-not-applicable">不适用</span>
                    <el-select v-else v-model="row.product_managers" multiple collapse-tags collapse-tags-tooltip
                      placeholder="必选PM" size="small" style="width:100%;" :disabled="!isEditable">
                      <el-option v-for="pm in pmOptions" :key="pm" :label="pm" :value="pm" />
                    </el-select>
                  </template>
                </el-table-column>
                  <el-table-column v-else label="需求方" width="245">
                  <template #header>
                    <span>需求方 <span style="color:#F53F3F;">*</span></span>
                  </template>
                  <template #default="{ row }">
                    <span v-if="isFullCreditRecord(row)" class="fill-not-applicable">不适用</span>
                    <div v-else style="display:flex; align-items:center; gap:4px;">
                    <el-select v-model="row.demand_sources" multiple collapse-tags collapse-tags-tooltip
                      placeholder="可多选" size="small" style="flex:1; min-width:0;" :disabled="!isEditable" @change="handleDemandSourcesChange(row)">
                      <el-option v-for="source in DEMAND_SOURCE_OPTIONS" :key="source" :label="source" :value="source" />
                    </el-select>
                    <el-popover v-if="row.demand_sources?.length" placement="bottom" :width="260" trigger="click">
                      <template #reference><el-button size="small" type="primary" class="fill-demand-allocation-button" title="需求方工时分配，默认均分" :disabled="!isEditable">分配</el-button></template>
                      <div style="font-size:12px; color:var(--color-text-2); margin-bottom:8px;">需求方工时分配（合计100%）</div>
                      <div v-for="source in row.demand_sources" :key="source" style="display:flex; align-items:center; gap:8px; margin:6px 0;">
                        <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{{ source }}</span>
                        <el-input-number v-model="row.demand_source_weights[source]" :min="0" :max="100" :precision="2" :step="5" size="small" controls-position="right" style="width:105px;" />
                        <span>%</span>
                      </div>
                      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; border-top:1px solid var(--color-border-light); padding-top:8px;">
                        <span :style="{ color: Math.abs(demandSourceWeightTotal(row) - 100) < 0.01 ? 'var(--color-success)' : 'var(--color-danger)' }">合计 {{ demandSourceWeightTotal(row) }}%</span>
                        <el-button size="small" text type="primary" @click="resetDemandSourceWeights(row)">均分</el-button>
                      </div>
                    </el-popover>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="工时/h" width="100">
                  <template #default="{ row }">
                    <el-input-number v-model="row.hours" :min="0.01" :max="200" :precision="2" :step="0.5"
                      controls-position="right" size="small" style="width:100%;" :disabled="!isEditable" />
                  </template>
                </el-table-column>
                <el-table-column label="交付进度" width="120">
                  <template #header>
                    <el-tooltip content="普通需求提交时进度须选择1%或10%至100%（每10%一档），选项按100%、90%…10%、1%排列，不能为0%；已有历史空进度可原样保留，计算按100%。五类有效工时进度默认100%，可按实际修改，不到100%时与其他未完成需求同样处理。" placement="top">
                      <span tabindex="0">交付进度 ⓘ <span style="color:#F53F3F;">*</span></span>
                    </el-tooltip>
                  </template>
                  <template #default="{ row }">
                    <el-select v-model="row.delivery_progress" placeholder="请选择" size="small" style="width:100%;" :disabled="!isEditable"
                      :title="isFullCreditRecord(row) ? '五类工时进度默认100%，可按实际修改' : undefined">
                      <el-option v-for="progress in PROGRESS_OPTIONS" :key="progress" :label="`${progress}%`" :value="progress" />
                      <el-option v-if="row.existing_record_id && normalizeProgress(row.delivery_progress) === 0" label="0%（历史，提交前修改）" :value="0" disabled />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column v-if="isEditable" label="" width="45" align="center">
                  <template #default="{ $index }">
                    <el-button type="danger" link size="small" @click="removeRow($index)">✕</el-button>
                  </template>
                </el-table-column>
              </el-table>

              <div v-if="isEditable" style="margin-top:10px;">
                <el-button type="primary" link size="small" @click="addRow">+ 新增需求行</el-button>
              </div>
            </div>

            <!-- 底部操作栏 -->
            <div class="fill-submit-bar" style="padding:14px 32px; border-top:1px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between; background:var(--color-bg-2);">
              <span style="font-size:13px; color:var(--color-text-2);">
                共 <strong>{{ rows.length }}</strong> 条，总工时
                <strong style="color:var(--color-primary);">{{ totalHours }}</strong> 小时
              </span>
              <div class="fill-submit-actions" style="display:flex; gap:12px;">
                <el-button
                  v-if="!editingHistoryTask && isEditable"
                  size="default"
                  @click="handleSaveDraft"
                  :loading="savingDraft"
                  style="min-width:140px; font-size:16px; height:44px; font-weight:600;"
                >📝 暂存草稿</el-button>
                <!-- 编辑历史且已停止：只显示关闭按钮 -->
                <el-button
                  v-if="editingHistoryTask && !isEditable"
                  size="default"
                  @click="returnToPreferred"
                  style="min-width:140px; font-size:16px; height:44px; font-weight:600;"
                >✖ 关闭查看</el-button>
                <!-- 可编辑时才显示提交/保存按钮 -->
                <el-button
                  v-if="isEditable"
                  type="primary" size="default"
                  @click="handleSubmit"
                  :loading="submitting"
                  style="min-width:140px; font-size:16px; height:44px; font-weight:600;"
                >{{ editingHistoryTask ? '✏️ 编辑完成' : '🚀 提交' }}</el-button>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- ====== 右栏：历史记录面板 ====== -->
      <div class="fill-right-panel">
        <div class="fill-history-card">
          <div class="fill-history-header">
            <h3 style="font-size:15px; font-weight:600; color:var(--color-text-1); margin:0;">📋 我的历史</h3>
            <div style="display:flex; align-items:center; gap:6px;">
              <el-button size="small" @click="exportHistory" title="导出全年历史">📤 导出</el-button>
              <el-select v-model="historyYear" size="small" style="width:90px;">
                <el-option v-for="y in historyYearOptions" :key="y" :label="`${y}年`" :value="y" />
              </el-select>
            </div>
          </div>

          <!-- 季度切换 -->
          <div class="fill-history-quarters">
            <button
              v-for="q in QUARTER_OPTIONS" :key="q"
              class="fill-q-btn"
              :class="{ 'fill-q-btn-active': historyQuarter === q }"
              @click="historyQuarter = q"
            >
              {{ q }}<span class="fill-q-count">{{ historyQuarterCounts[q] }}</span>
            </button>
          </div>

          <!-- 历史任务列表 -->
          <div class="fill-history-body">
            <el-skeleton v-if="historyLoading" :rows="4" animated />

            <div v-else-if="filteredHistory.length === 0" style="text-align:center; padding:30px 0; color:var(--color-text-4); font-size:13px;">
              {{ historyYear }}年 {{ historyQuarter }} 暂无记录
            </div>

            <div v-else class="fill-history-list">
              <p class="fill-metric-note">需求进度显示原始填报值；五类有效工时不适用需求进度。工时完成度另按工作日计算。</p>
              <div v-for="task in filteredHistory" :key="task.id" class="fill-history-item">
                <!-- 任务头（点击折叠） -->
                <div class="fill-history-task-header" @click="toggleHistoryTask(task.id)">
                  <span class="fill-history-arrow" :class="{ 'fill-history-arrow-open': historyExpanded[task.id] }">▶</span>
                  <div style="flex:1; min-width:0;">
                    <div style="font-size:13px; font-weight:500; color:var(--color-text-1); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                      {{ task.title }}
                    </div>
                    <div style="font-size:11px; color:var(--color-text-4); margin-top:2px;">
                      {{ task.start_date }} ~ {{ task.end_date }}
                    </div>
                  </div>
                </div>

                <!-- 展开的记录详情 -->
                <transition name="accordion">
                  <div v-if="historyExpanded[task.id]" class="fill-history-records">
                    <div v-if="!task.records || task.records.length === 0" style="font-size:12px; color:var(--color-text-4); padding:8px 0;">
                      暂无提交记录
                    </div>
                    <div v-for="(rec, ri) in task.records" :key="rec.id || ri" class="fill-history-rec">
                      <span class="fill-rec-title">{{ rec.requirement_title || '-' }}</span>
                      <span class="fill-rec-progress" :class="{ 'fill-rec-progress-complete': !isFullCreditRecord(rec) && normalizeProgress(rec.delivery_progress) === 100 }">{{ isFullCreditRecord(rec) ? '不适用' : normalizeProgress(rec.delivery_progress) === null ? '未填写' : `进度 ${normalizeProgress(rec.delivery_progress)}%` }}</span>
                      <span class="fill-rec-hours">{{ parseFloat(rec.hours || 0).toFixed(1) }}H</span>
                    </div>
                  </div>
                </transition>

                <div v-if="task.workHours" class="fill-history-hours">
                  <HoursCompletion :metric="task.workHours" compact />
                </div>

                <!-- v1.6.1: 任务底部固定横行 — 工时 | 状态 | 编辑 -->
                <div class="fill-history-task-footer">
                  <span class="fill-footer-hours">{{ task.totalHours?.toFixed(1) || 0 }}H</span>
                  <span class="fill-status-tag" :class="task.status === 'active' ? 'fill-status-active' : 'fill-status-closed'">
                    {{ task.status === 'active' ? '收集中' : '已停止' }}
                  </span>
                  <el-button
                    type="warning" link size="small"
                    class="fill-footer-edit-btn"
                    @click.stop="loadHistoryForEdit(task)"
                  >编辑</el-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- v2.0.0: 隐藏文件输入框 -->
    <input ref="fillImportInput" type="file" accept=".xlsx,.xls" style="display:none;" @change="handleFillImport" />
  </div>
</template>

<style scoped>
.fill-page-root { padding: 8px 10px 30px; }
.fill-blocked-shell {
  min-height: 70vh;
  background: var(--color-bg-white);
  border-radius: 12px;
  box-shadow: var(--shadow-1);
}
.fill-blocked-content {
  padding: 18px 8px 22px;
  text-align: center;
}
.fill-blocked-title {
  font-size: 18px;
  font-weight: 700;
  color: #1D2129;
  line-height: 1.6;
}

/* 双栏布局 */
.fill-dual-layout {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 24px;
  align-items: start;
}
.fill-left-panel { min-width: 0; }
.fill-right-panel { position: sticky; top: 30px; }
.fill-hours-summary { padding: 8px 18px 0; }
.fill-fixed-version :deep(.el-input__wrapper) { background: var(--color-bg-2); }
.fill-fixed-version :deep(input) { color: var(--color-text-3); cursor: default; }
.fill-not-applicable { color: var(--color-text-3); font-size: 12px; }
.fill-carry-over-tag { margin-top: 4px; font-size: 11px; line-height: 1.4; color: var(--color-warning, #FF7D00); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fill-history-hours { padding: 8px 12px; border-top: 1px solid var(--color-border-light); }
.fill-metric-note { margin: 6px 0; font-size: 12px; line-height: 1.6; color: var(--color-text-3); }

/* v1.6.2: 任务已停止只读提示条 */
.fill-readonly-bar {
  background: #FFF7E8;
  border-bottom: 1px solid #FFCA76;
  padding: 8px 32px;
  font-size: 13px;
  font-weight: 600;
  color: #FF7D00;
}

/* v1.6.1: 编辑历史提示横条（卡片外） */
.fill-edit-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  margin-bottom: 8px;
  background: rgba(22, 93, 255, 0.06);
  border: 1px solid var(--color-primary-light, #BEDAFF);
  border-radius: 8px;
}
.fill-edit-banner-title {
  font-size: 13px;
  font-weight: 600;
  color: #FF7D00;
}
.fill-edit-banner-back {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

/* v1.6.1: 历史任务底部固定横行 */
.fill-history-task-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 8px 12px;
  border-top: 1px solid var(--color-border-light);
  background: var(--color-bg-2);
}
.fill-footer-hours {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-primary);
  flex-shrink: 0;
}
.fill-footer-edit-btn {
  margin-left: auto;
  font-size: 12px;
  padding: 0;
  height: auto;
}

/* v1.6.0: 无首选任务空态 */
.fill-no-task {
  padding: 80px 40px;
  text-align: center;
}
.fill-no-task-icon { font-size: 40px; margin-bottom: 16px; opacity: 0.5; }
.fill-no-task-text { font-size: 16px; font-weight: 600; color: var(--color-text-2); margin-bottom: 8px; }
.fill-no-task-sub { font-size: 13px; color: var(--color-text-4); }


/* 历史记录卡片 */
.fill-history-card { background: var(--color-bg-white); border-radius: 12px; box-shadow: var(--shadow-1); overflow: hidden; }
.fill-history-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 12px; border-bottom: 1px solid var(--color-border-light); }

/* 季度切换 */
.fill-history-quarters { display: flex; padding: 10px 18px; gap: 6px; border-bottom: 1px solid var(--color-border-light); }
.fill-q-btn { flex: 1; padding: 6px 0; font-size: 12px; font-weight: 500; color: var(--color-text-3); background: var(--color-bg-2); border: 1px solid transparent; border-radius: 6px; cursor: pointer; transition: all 0.2s; font-family: var(--font-base); display: flex; align-items: center; justify-content: center; gap: 4px; }
.fill-q-btn:hover { color: var(--color-primary); background: var(--color-primary-light); }
.fill-q-btn-active { color: #fff; background: var(--color-primary); border-color: var(--color-primary); box-shadow: 0 2px 6px rgba(22,93,255,0.2); }
.fill-q-count { font-size: 10px; opacity: 0.7; }
.fill-history-body { padding: 12px 18px; max-height: 65vh; overflow-y: auto; }
.fill-history-list { display: flex; flex-direction: column; gap: 6px; }
.fill-history-item { border: 1px solid var(--color-border-light); border-radius: 8px; overflow: hidden; }
.fill-history-task-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; transition: background 0.2s; }
.fill-history-task-header:hover { background: var(--color-primary-light); }
.fill-history-arrow { font-size: 9px; color: var(--color-text-4); transition: transform 0.2s; flex-shrink: 0; }
.fill-history-arrow-open { transform: rotate(90deg); color: var(--color-primary); }
.fill-history-records { padding: 4px 12px 10px 28px; border-top: 1px solid var(--color-border-light); background: var(--color-bg-2); }
.fill-history-rec { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px; }
.fill-rec-title { color: var(--color-text-2); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; }
.fill-rec-hours { font-weight: 600; color: var(--color-primary); flex-shrink: 0; margin-left: 10px; white-space: nowrap; }
.fill-rec-progress { color: var(--color-text-2); min-width: 48px; text-align: right; flex-shrink: 0; margin-left: 10px; white-space: nowrap; }
.fill-rec-progress-complete { color: #16883B; background: #E8F7EE; padding: 3px 6px; border-radius: 4px; font-weight: 600; }

.fill-demand-allocation-button {
  min-width: 48px;
  height: 26px;
  padding: 0 10px;
  border-radius: 4px;
  background: #C41D7F !important;
  border-color: #C41D7F !important;
  color: #fff !important;
  font-weight: 600;
}
.fill-demand-allocation-button:hover,
.fill-demand-allocation-button:focus {
  background: #A61D68 !important;
  border-color: #A61D68 !important;
  color: #fff !important;
}

/* 状态标签 */
.fill-status-tag { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 10px; font-weight: 500; }
.fill-status-active { background: #E8FFEA; color: #00B42A; }
.fill-status-closed { background: var(--color-bg-1); color: var(--color-text-4); }

/* 收集状态标签 */
.fill-collect-status { display: inline-flex; align-items: center; gap: 6px; padding: 5px 16px; border-radius: 9999px; font-size: 14px; font-weight: 600; white-space: nowrap; flex-shrink: 0; margin-top: 2px; }
.fill-collect-dot { width: 8px; height: 8px; border-radius: 50%; }
.fill-collect-active { background: #D4FFDA; color: #006B1A; }
.fill-collect-active .fill-collect-dot { background: #00B42A; animation: collectPulse 1.5s ease-in-out infinite; }
.fill-collect-closed { background: #FFE8E8; color: #CB2634; }
.fill-collect-closed .fill-collect-dot { background: #CB2634; }

@keyframes collectPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

/* 手风琴过渡 */
.accordion-enter-active, .accordion-leave-active { transition: all 0.2s ease; overflow: hidden; }
.accordion-enter-from, .accordion-leave-to { opacity: 0; max-height: 0; }
.accordion-enter-to, .accordion-leave-from { opacity: 1; max-height: 500px; }

/* 响应式 */
@media (max-width: 1024px) {
  .fill-dual-layout { grid-template-columns: 1fr; }
  .fill-right-panel { position: static; }
}
@media (max-width: 600px) {
  .fill-submit-bar { padding: 14px 16px !important; flex-wrap: wrap; gap: 12px; }
  .fill-submit-bar > span { flex: 1 1 100%; }
  .fill-submit-actions { flex: 1 1 100%; min-width: 0; flex-wrap: wrap; }
  .fill-submit-actions > .el-button { flex: 1 1 140px; max-width: 100%; margin-left: 0; }
}
</style>
