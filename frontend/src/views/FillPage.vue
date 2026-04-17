<script setup>
/**
 * FillPage.vue — 填写页（独立布局）
 * v1.4.2: 填写页留白再减半、按钮进一步加大、收集状态标签增强
 * v1.4.1: 填写页UI优化 — 收集状态显示、按钮加大、留白减半
 * v1.4.0: 双栏布局 — 左侧填写表单 + 右侧历史记录面板
 * v1.3.0: 草稿暂存
 * v1.1.0: 编辑状态通知, 任务停止校验
 */
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
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

/** 创建空行 */
function createEmptyRow() {
  return {
    requirement_title: '',
    version: '',
    product_managers: [],
    hours: null
  }
}

onMounted(async () => {
  try {
    const res = await api.get(`/fill/${route.params.token}`)
    fillData.value = res.data
    // 只要存在草稿，优先恢复草稿（提交成功后后端会清空草稿）
    if (Array.isArray(res.data.draft_records) && res.data.draft_records.length > 0) {
      rows.value = res.data.draft_records.map(r => ({
        requirement_title: r.requirement_title || '',
        version: r.version || '',
        product_managers: Array.isArray(r.product_managers) ? r.product_managers : [],
        hours: r.hours === null || r.hours === undefined || r.hours === '' ? null : parseFloat(r.hours)
      }))
      ElMessage.success('已恢复上次暂存的草稿')
    } else if (res.data.records && res.data.records.length > 0) {
      // 如果有历史记录，加载到表格中
      rows.value = res.data.records.map(r => ({
        requirement_title: r.requirement_title,
        version: r.version || '',
        product_managers: Array.isArray(r.product_managers) ? r.product_managers : [],
        hours: parseFloat(r.hours)
      }))
    } else {
      rows.value = [createEmptyRow()]
    }
    // v1.4.0: 加载历史数据
    loadHistory()
  } catch {
    error.value = '链接无效或已过期'
  } finally {
    loading.value = false
  }
})

/** 新增行 */
function addRow() {
  rows.value.push(createEmptyRow())
}

/** 删除行 */
function removeRow(index) {
  if (rows.value.length <= 1) {
    ElMessage.warning('至少保留一行')
    return
  }
  rows.value.splice(index, 1)
}

/** 工时总计 */
const totalHours = computed(() => {
  return rows.value.reduce((sum, r) => sum + (parseFloat(r.hours) || 0), 0).toFixed(2)
})

/* ========== REQ-17: 编辑状态通知 ========== */
let editingTimer = null

/** 通知后端正在编辑 */
async function notifyEditing() {
  try {
    await api.put(`/fill/${route.params.token}/editing`)
  } catch {
    // 静默失败
  }
}

/** 输入框获焦时触发（节流 10 秒） */
function handleInputFocus() {
  if (editingTimer) return
  notifyEditing()
  editingTimer = setTimeout(() => { editingTimer = null }, 10000)
}

onUnmounted(() => {
  if (editingTimer) clearTimeout(editingTimer)
})

/** 提交工时 */
async function handleSubmit() {
  // 校验：至少一行有效数据
  const validRows = rows.value.filter(r => r.requirement_title && r.hours > 0)
  if (validRows.length === 0) {
    ElMessage.warning('请至少填写一条完整的工时记录')
    return
  }

  submitting.value = true
  try {
    await api.post(`/fill/${route.params.token}/submit`, { records: validRows })
    ElMessage.success(`提交成功！共 ${validRows.length} 条记录，总工时 ${totalHours.value} 小时`)
    // 广播数据变更，通知其他标签页刷新
    broadcastDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, { token: route.params.token })
    // v1.4.0: 提交后刷新右侧历史
    loadHistory()
  } catch (err) {
    // REQ-16: 任务已停止收集
    const msg = err.response?.data?.message || '提交失败'
    ElMessage.error(msg)
  } finally {
    submitting.value = false
  }
}

/** 暂存草稿（持久化到后端） */
async function handleSaveDraft() {
  if (savingDraft.value) return
  savingDraft.value = true
  try {
    await api.put(`/fill/${route.params.token}/draft`, { draft_records: rows.value })
    ElMessage.success('草稿已暂存')
    broadcastDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, { token: route.params.token })
  } catch (err) {
    const msg = err.response?.data?.message || '草稿暂存失败'
    ElMessage.error(msg)
  } finally {
    savingDraft.value = false
  }
}

/* ========== 一键识别 ========== */
const recognizeText = ref('')

/* 工时单位常量 */
const HOURS_PER_DAY = 8
const HOURS_MIN = 1
const HOURS_MAX = 60

function matchPM(text) {
  let remaining = text
  const matched = []
  for (const pmName of PM_OPTIONS) {
    if (remaining.includes(pmName)) {
      matched.push(pmName)
      remaining = remaining.replace(pmName, '').trim()
    }
  }
  if (matched.length === 0) {
    const candidates = []
    for (const pmName of PM_OPTIONS) {
      let matchCount = 0
      for (const char of pmName) { if (remaining.includes(char)) matchCount++ }
      if (matchCount > 0) candidates.push({ name: pmName, matchCount, ratio: matchCount / pmName.length })
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
const historyTasks = ref([])  // 全部历史任务
const historyYear = ref(CURRENT_YEAR)
const historyQuarter = ref(getCurrentQuarter())
const historyExpanded = ref({})  // { taskId: true/false }

function getCurrentQuarter() {
  const m = new Date().getMonth() + 1
  return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'
}

/** 历史年份选项 */
const historyYearOptions = computed(() => {
  const years = new Set([CURRENT_YEAR])
  for (const t of historyTasks.value) {
    if (t.year) years.add(t.year)
  }
  return [...years].sort((a, b) => b - a)
})

/** 获取任务归属季度（用end_date判定） */
function getTaskQuarter(task) {
  const endDate = task.end_date ? new Date(task.end_date) : null
  const startDate = task.start_date ? new Date(task.start_date) : null
  const refDate = endDate || startDate

  if (!refDate) return 'Q1'
  const m = refDate.getMonth() + 1
  return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'
}

/** 筛选后的历史任务（按年份+季度） */
const filteredHistory = computed(() => {
  return historyTasks.value.filter(t => {
    const y = t.year || CURRENT_YEAR
    if (y !== historyYear.value) return false
    return getTaskQuarter(t) === historyQuarter.value
  })
})

/** 加载历史数据 */
async function loadHistory() {
  historyLoading.value = true
  try {
    const res = await api.get(`/fill/${route.params.token}/history`)
    const data = res.data?.data || res.data || {}
    historyTasks.value = data.tasks || []
    // 自动展开最近季度的第一个任务
    const current = filteredHistory.value
    if (current.length > 0) {
      historyExpanded.value[current[0].id] = true
    }
  } catch {
    // 静默
  } finally {
    historyLoading.value = false
  }
}

function toggleHistoryTask(taskId) {
  historyExpanded.value[taskId] = !historyExpanded.value[taskId]
}

/** 各季度任务数 */
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

    <!-- v1.4.0: 双栏布局 — 左侧表单 + 右侧历史 -->
    <div v-else class="fill-dual-layout">
      <!-- ====== 左栏：填写表单 ====== -->
      <div class="fill-left-panel">
        <div style="background:var(--color-bg-white); border-radius:12px; box-shadow:var(--shadow-1); overflow:hidden;">
          <!-- 标题区 -->
          <div style="padding:28px 32px 20px; border-bottom:1px solid var(--color-border-light); display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <h1 style="font-size:20px; font-weight:700; color:var(--color-text-1); margin-bottom:6px;">
                {{ fillData?.task?.title || '工作统计' }}
              </h1>
              <p style="font-size:14px; color:var(--color-text-3);">
                【{{ ROLE_LABEL[fillData?.staff?.role] }}】{{ fillData?.staff?.name }} 工作内容填写
              </p>
            </div>
            <span
              class="fill-collect-status"
              :class="fillData?.task?.status === 'active' ? 'fill-collect-active' : 'fill-collect-closed'"
            >
              <span class="fill-collect-dot"></span>
              {{ fillData?.task?.status === 'active' ? '正在收集中' : '收集已停止' }}
            </span>
          </div>

          <!-- 表格区 -->
          <div style="padding:20px 32px;">
            <!-- 一键识别 -->
            <div style="background:var(--color-bg-2); border-radius:8px; padding:14px; margin-bottom:14px; border:1px solid var(--color-border-light);">
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
                  <el-input v-model="row.requirement_title" placeholder="输入需求名称" size="small" @focus="handleInputFocus" />
                </template>
              </el-table-column>
              <el-table-column label="版本号" width="120">
                <template #default="{ row }">
                  <el-input v-model="row.version" placeholder="V4.633.0" size="small" @focus="handleInputFocus" />
                </template>
              </el-table-column>
              <el-table-column label="产品经理" width="160">
                <template #default="{ row }">
                  <el-select v-model="row.product_managers" multiple collapse-tags collapse-tags-tooltip placeholder="选PM" size="small" style="width:100%;">
                    <el-option v-for="pm in PM_OPTIONS" :key="pm" :label="pm" :value="pm" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="工时/h" width="100">
                <template #default="{ row }">
                  <el-input-number v-model="row.hours" :min="0.01" :max="200" :precision="2" :step="0.5" controls-position="right" size="small" style="width:100%;" />
                </template>
              </el-table-column>
              <el-table-column label="" width="45" align="center">
                <template #default="{ $index }">
                  <el-button type="danger" link size="small" @click="removeRow($index)">✕</el-button>
                </template>
              </el-table-column>
            </el-table>

            <div style="margin-top:10px;">
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
              <el-button size="default" @click="handleSaveDraft" :loading="savingDraft" style="min-width:140px; font-size:16px; height:44px; font-weight:600;">📝 暂存草稿</el-button>
              <el-button type="primary" size="default" @click="handleSubmit" :loading="submitting" style="min-width:140px; font-size:16px; height:44px; font-weight:600;">🚀 提交</el-button>
            </div>
          </div>
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
              {{ q }}
              <span class="fill-q-count">{{ historyQuarterCounts[q] }}</span>
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
                <!-- 任务头 -->
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
                  <div style="text-align:right; flex-shrink:0;">
                    <span style="font-weight:700; color:var(--color-primary); font-size:13px;">{{ task.totalHours?.toFixed(1) || 0 }}H</span>
                    <div style="margin-top:2px;">
                      <span class="fill-status-tag" :class="task.status === 'active' ? 'fill-status-active' : 'fill-status-closed'">
                        {{ task.status === 'active' ? '收集中' : '已停止' }}
                      </span>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fill-page-root {
  padding: 30px 10px;
}

/* v1.4.0: 双栏布局 */
.fill-dual-layout {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 24px;
  align-items: start;
}

.fill-left-panel {
  min-width: 0;
}

.fill-right-panel {
  position: sticky;
  top: 30px;
}

/* 历史记录卡片 */
.fill-history-card {
  background: var(--color-bg-white);
  border-radius: 12px;
  box-shadow: var(--shadow-1);
  overflow: hidden;
}

.fill-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--color-border-light);
}

/* 季度切换按钮 */
.fill-history-quarters {
  display: flex;
  padding: 10px 18px;
  gap: 6px;
  border-bottom: 1px solid var(--color-border-light);
}

.fill-q-btn {
  flex: 1;
  padding: 6px 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-3);
  background: var(--color-bg-2);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: var(--font-base);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.fill-q-btn:hover {
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.fill-q-btn-active {
  color: #fff;
  background: var(--color-primary);
  border-color: var(--color-primary);
  box-shadow: 0 2px 6px rgba(22,93,255,0.2);
}

.fill-q-count {
  font-size: 10px;
  opacity: 0.7;
}

.fill-history-body {
  padding: 12px 18px;
  max-height: 65vh;
  overflow-y: auto;
}

.fill-history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fill-history-item {
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  overflow: hidden;
}

.fill-history-task-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.fill-history-task-header:hover {
  background: var(--color-primary-light);
}

.fill-history-arrow {
  font-size: 9px;
  color: var(--color-text-4);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.fill-history-arrow-open {
  transform: rotate(90deg);
  color: var(--color-primary);
}

.fill-history-records {
  padding: 4px 12px 10px 28px;
  border-top: 1px solid var(--color-border-light);
  background: var(--color-bg-2);
}

.fill-history-rec {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 12px;
}

.fill-rec-title {
  color: var(--color-text-2);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px;
}

.fill-rec-hours {
  font-weight: 600;
  color: var(--color-primary);
  flex-shrink: 0;
}

/* 状态标签 */
.fill-status-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 500;
}

.fill-status-active {
  background: #E8FFEA;
  color: #00B42A;
}

.fill-status-closed {
  background: var(--color-bg-1);
  color: var(--color-text-4);
}

/* v1.4.1: 收集状态标签 */
.fill-collect-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 16px;
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  margin-top: 2px;
}

.fill-collect-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.fill-collect-active {
  background: #D4FFDA;
  color: #006B1A;
}

.fill-collect-active .fill-collect-dot {
  background: #00B42A;
  animation: collectPulse 1.5s ease-in-out infinite;
}

.fill-collect-closed {
  background: #FFE8E8;
  color: #CB2634;
}

.fill-collect-closed .fill-collect-dot {
  background: #CB2634;
}

@keyframes collectPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* 手风琴过渡 */
.accordion-enter-active, .accordion-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.accordion-enter-from, .accordion-leave-to {
  opacity: 0;
  max-height: 0;
}
.accordion-enter-to, .accordion-leave-from {
  opacity: 1;
  max-height: 500px;
}

/* 响应式：小屏时堆叠 */
@media (max-width: 1024px) {
  .fill-dual-layout {
    grid-template-columns: 1fr;
  }
  .fill-right-panel {
    position: static;
  }
}
</style>
