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

const route = useRoute()
const loading = ref(true)
const submitting = ref(false)
const savingDraft = ref(false)
const fillData = ref(null)
const error = ref('')

/** 产品经理选项列表 */
const PM_OPTIONS = ['钟冠', '吴浩鑫', '杨瑞', '罗晓璇', '其他-昆仑', '其他-短信', '其他-架构', '不在上述']

/** 角色标签 */
const ROLE_LABEL = { frontend: '前端', backend: '后端', test: '测试' }

/** 表格行数据 */
const rows = ref([])

/** v1.6.0: 当前正在编辑的历史任务（null 表示编辑首选任务） */
const editingHistoryTask = ref(null)

/** 当前表单对应的任务 */
const currentTask = computed(() => editingHistoryTask.value ?? fillData.value?.task ?? null)

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
  if (!currentTask.value) return false
  return currentTask.value.status === 'active'
})

/** 创建空行 */
function createEmptyRow() {
  return { requirement_title: '', version: '', product_managers: [], hours: null }
}

onMounted(async () => {
  try {
    const res = await api.get(`/fill/${route.params.token}`)
    fillData.value = res.data
    if (fillData.value?.task) {
      // 有首选任务时，尝试恢复草稿或已提交记录
      if (Array.isArray(res.data.draft_records) && res.data.draft_records.length > 0) {
        rows.value = normalizeRows(res.data.draft_records)
        ElMessage.success('已恢复上次暂存的草稿')
      } else if (res.data.records?.length > 0) {
        rows.value = normalizeRows(res.data.records)
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

function normalizeRows(list) {
  return list.map(r => {
    // product_managers 可能是数组，也可能是 JSON 字符串（来自数据库原始返回）
    let pm = r.product_managers
    if (!Array.isArray(pm)) {
      try { pm = JSON.parse(pm) } catch { pm = [] }
      if (!Array.isArray(pm)) pm = []
    }
    return {
      requirement_title: r.requirement_title || '',
      version: r.version || '',
      product_managers: pm,
      hours: (r.hours === null || r.hours === undefined || r.hours === '') ? null : parseFloat(r.hours)
    }
  })
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

/* ========== REQ-17 / v1.6.2: 编辑状态通知 ========== */
let editingTimer = null
let keepAliveTimer = null  // 定时保持 editing 状态（避免 30s 超时）

async function notifyEditing() {
  try {
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
  if (!currentTask.value) return
  const validRows = rows.value.filter(r => r.requirement_title && r.hours > 0)
  if (validRows.length === 0) {
    ElMessage.warning('请至少填写一条完整的工时记录')
    return
  }

  submitting.value = true
  try {
    const payload = { records: validRows }
    // 新体系必须传 task_id
    if (fillData.value?.linkType === 'system') {
      payload.task_id = currentTask.value.id
    }
    await api.post(`/fill/${route.params.token}/submit`, payload)

    const isEdit = !!editingHistoryTask.value
    ElMessage.success(isEdit
      ? `历史数据编辑完成！共 ${validRows.length} 条记录`
      : `提交成功！共 ${validRows.length} 条记录，总工时 ${totalHours.value} 小时`
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
  if (savingDraft.value) return
  savingDraft.value = true
  try {
    const payload = { draft_records: rows.value }
    if (fillData.value?.linkType === 'system' && currentTask.value) {
      payload.task_id = currentTask.value.id
    }
    await api.put(`/fill/${route.params.token}/draft`, payload)
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
    editingHistoryTask.value = task
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
  if (preferred && fillData.value?.records?.length > 0) {
    rows.value = normalizeRows(fillData.value.records)
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
  for (const pmName of PM_OPTIONS) {
    if (remaining.includes(pmName)) { matched.push(pmName); remaining = remaining.replace(pmName, '').trim() }
  }
  if (matched.length === 0) {
    const candidates = []
    for (const pmName of PM_OPTIONS) {
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
        if (PM_OPTIONS.includes(t)) { pm.push(t); tokens.splice(i, 1); continue }
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
  if (rows.value.length === 1 && !rows.value[0].requirement_title && !rows.value[0].hours) { rows.value = parsed } else { rows.value.push(...parsed) }
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
  const years = new Set([CURRENT_YEAR])
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
    historyTasks.value = data.tasks || []
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
            <div style="padding:28px 32px 20px; border-bottom:1px solid var(--color-border-light);">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                  <h1 style="font-size:20px; font-weight:700; color:var(--color-text-1); margin-bottom:6px;">
                    {{ currentTask?.title || '工作统计' }}
                  </h1>
                  <p style="font-size:14px; color:var(--color-text-3);">
                    【{{ ROLE_LABEL[fillData?.staff?.role] }}】{{ fillData?.staff?.name }} 工作内容填写
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

            <!-- 表格区 -->
            <div style="padding:20px 32px;">
              <!-- 一键识别（仅可编辑时显示） -->
              <div v-if="isEditable" style="background:var(--color-bg-2); border-radius:8px; padding:14px; margin-bottom:14px; border:1px solid var(--color-border-light);">
                <p style="font-size:12px; color:var(--color-text-3); margin-bottom:6px;">
                  粘贴文本，每行一条。格式：<code style="background:var(--color-bg-white); padding:2px 6px; border-radius:4px;">V4.633.0 用户中心改版 杨瑞 5h</code>
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
                    <el-input v-model="row.requirement_title" placeholder="输入需求名称" size="small"
                      :disabled="!isEditable" @focus="handleInputFocus" />
                  </template>
                </el-table-column>
                <el-table-column label="版本号" width="120">
                  <template #default="{ row }">
                    <el-input v-model="row.version" placeholder="V4.633.0" size="small"
                      :disabled="!isEditable" @focus="handleInputFocus" />
                  </template>
                </el-table-column>
                <el-table-column label="产品经理" width="160">
                  <template #default="{ row }">
                    <el-select v-model="row.product_managers" multiple collapse-tags collapse-tags-tooltip
                      placeholder="选PM" size="small" style="width:100%;" :disabled="!isEditable">
                      <el-option v-for="pm in PM_OPTIONS" :key="pm" :label="pm" :value="pm" />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="工时/h" width="100">
                  <template #default="{ row }">
                    <el-input-number v-model="row.hours" :min="0.01" :max="200" :precision="2" :step="0.5"
                      controls-position="right" size="small" style="width:100%;" :disabled="!isEditable" />
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
            <div style="padding:14px 32px; border-top:1px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between; background:var(--color-bg-2);">
              <span style="font-size:13px; color:var(--color-text-2);">
                共 <strong>{{ rows.length }}</strong> 条，总工时
                <strong style="color:var(--color-primary);">{{ totalHours }}</strong> 小时
              </span>
              <div style="display:flex; gap:12px;">
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
            <el-select v-model="historyYear" size="small" style="width:90px;">
              <el-option v-for="y in historyYearOptions" :key="y" :label="`${y}年`" :value="y" />
            </el-select>
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
                    <div v-for="(rec, ri) in task.records" :key="ri" class="fill-history-rec">
                      <span class="fill-rec-title">{{ rec.requirement_title || '-' }}</span>
                      <span class="fill-rec-hours">{{ parseFloat(rec.hours || 0).toFixed(1) }}H</span>
                    </div>
                  </div>
                </transition>

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
  </div>
</template>

<style scoped>
.fill-page-root { padding: 8px 10px 30px; }

/* 双栏布局 */
.fill-dual-layout {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 24px;
  align-items: start;
}
.fill-left-panel { min-width: 0; }
.fill-right-panel { position: sticky; top: 30px; }

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
.fill-rec-hours { font-weight: 600; color: var(--color-primary); flex-shrink: 0; }

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
</style>
