<script setup>
/**
 * TaskDetail.vue — 任务详情页
 * v1.6.0: 移除链接管理Tab（系统级链接迁移至团队人员页）
 * v1.4.3: 页面加载动画 + PM解析过滤数字字符串
 * v1.4.2: 修复产品经理列数据错位，加固列绑定
 * Tab 1: 提交数据 — 内联编辑 + 删除 + API 联动
 */
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTaskStore } from '../stores/task'
import { useRecordStore } from '../stores/record'

import { ElMessage, ElMessageBox } from 'element-plus'
import BackButton from '../components/BackButton.vue'
import api from '../api'
import { onDataChange, SYNC_EVENTS } from '../utils/sync'
import { parseExcelFile, validateHeaders, uploadExcelToServer, downloadTemplate } from '../utils/excel'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const taskStore = useTaskStore()
const recordStore = useRecordStore()
const authStore = useAuthStore()


const activeTab = ref('records')
const taskId = computed(() => route.params.id)

/* ========== 数据加载 ========== */
const taskDetail = ref(null)
const loading = ref(true)
const pageLoading = ref(true)  // v1.4.3: 页面初始加载状态

async function loadTaskData() {
  loading.value = true
  try {
    const res = await taskStore.fetchDetail(taskId.value)
    taskDetail.value = res
    await recordStore.fetchByTask(taskId.value)
  } finally {
    loading.value = false
  }
}

/* ========== REQ-17: 实时活动状态轮询 ========== */
const POLL_INTERVAL_MS = 5000
let pollTimer = null
const activityData = ref({ editing: [], submitted: [] })

async function pollActivity() {
  try {
    const res = await api.get(`/tasks/${taskId.value}/activity`)
    activityData.value = res.data || { editing: [], submitted: [] }
  } catch {
    // 静默失败
  }
}

/* 跨页面数据同步监听 */
let cleanupSync = null

onMounted(async () => {
  pageLoading.value = true
  await loadTaskData()
  pollActivity()
  pollTimer = setInterval(pollActivity, POLL_INTERVAL_MS)
  // 监听工时变更广播，自动刷新
  cleanupSync = onDataChange(SYNC_EVENTS.WORK_RECORD_CHANGED, () => {
    loadTaskData()
  })
  pageLoading.value = false
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (cleanupSync) cleanupSync()
})

/* ========== Tab 1: 提交数据 — 内联编辑 ========== */
const editingRowId = ref('')

/** 角色映射常量 */
const ROLE_LABEL = { frontend: '前端', backend: '后端', test: '测试' }
const ROLE_TAG_CLASS = { frontend: 'dt-tag-blue', backend: 'dt-tag-green', test: 'dt-tag-orange' }

/* REQ-26a: 角色排序常量（后端→前端→测试） */
const ROLE_SORT_ORDER = { backend: 0, frontend: 1, test: 2 }

const sortedRecords = computed(() => {
  return [...recordStore.list].sort((a, b) => {
    const ra = ROLE_SORT_ORDER[a.staff?.role] ?? 99
    const rb = ROLE_SORT_ORDER[b.staff?.role] ?? 99
    return ra - rb
  })
})

/** REQ-26b: 安全解析 product_managers JSON 字符串（v1.4.3: 过滤数字字符串） */
function isValidPMName(v) {
  if (typeof v !== 'string') return false
  if (!isNaN(v) && v.trim() !== '') return false
  if (v.trim() === '') return false
  return true
}

function parsePM(val) {
  if (Array.isArray(val)) return val.filter(isValidPMName)
  if (typeof val === 'string') {
    try {
      let parsed = JSON.parse(val)
      if (typeof parsed === 'string') parsed = JSON.parse(parsed)
      if (Array.isArray(parsed)) return parsed.filter(isValidPMName)
      return []
    } catch { return [] }
  }
  return []
}

/** 编辑缓存 */
const editForm = ref({
  requirement_title: '',
  version: '',
  product_managers: '',
  hours: 0
})

function startEdit(row) {
  editingRowId.value = row.id
  editForm.value = {
    requirement_title: row.requirement_title,
    version: row.version || '',
    product_managers: Array.isArray(row.product_managers) ? row.product_managers.join(', ') : '',
    hours: parseFloat(row.hours)
  }
}

function cancelEdit() {
  editingRowId.value = ''
}

async function saveEdit(row) {
  try {
    const pmArray = editForm.value.product_managers
      ? editForm.value.product_managers.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : []
    await recordStore.update(row.id, {
      requirement_title: editForm.value.requirement_title,
      version: editForm.value.version,
      product_managers: pmArray,
      hours: editForm.value.hours
    })
    editingRowId.value = ''
    ElMessage.success('记录已更新')
    // 重新加载以获取最新的 staff 关联数据
    await recordStore.fetchByTask(taskId.value)
  } catch {
    ElMessage.error('更新失败')
  }
}

async function deleteRecord(row) {
  try {
    await ElMessageBox.confirm(
      `确认删除「${row.requirement_title}」？`,
      '删除记录',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
    )
    await recordStore.remove(row.id)
    ElMessage.success('记录已删除')
  } catch {
    // 用户取消
  }
}

/* ========== v2.0.0: 导入功能 ========== */
const importFileInput = ref(null)

function triggerImport() {
  importFileInput.value?.click()
}

async function handleImportFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  event.target.value = ''

  try {
    const { headers, rows } = await parseExcelFile(file)
    const expectedHeaders = ['人员姓名', '需求标题', '版本号', '产品经理', '工时(小时)']
    if (!validateHeaders(headers, expectedHeaders)) {
      ElMessage.error('页面数据格式不匹配，请重新导入')
      return
    }

    if (rows.length === 0) {
      ElMessage.warning('Excel 中无有效数据行')
      return
    }

    const res = await api.post('/records/import', {
      task_id: taskId.value,
      rows: rows.map(r => ({
        staff_name: String(r['人员姓名'] || '').trim(),
        requirement_title: String(r['需求标题'] || '').trim(),
        version: String(r['版本号'] || '').trim(),
        product_managers: String(r['产品经理'] || '').trim(),
        hours: parseFloat(r['工时(小时)']) || 0
      }))
    })

    uploadExcelToServer(file, {
      source_page: 'task-detail',
      upload_type: 'import',
      task_id: taskId.value,
      filename: file.name
    }).catch(() => {})

    await recordStore.fetchByTask(taskId.value)
    ElMessage.success(res.message || `导入成功，共 ${rows.length} 条`)
  } catch (err) {
    ElMessage.error(err.response?.data?.message || err.message || '导入失败')
  }
}

function handleDownloadTemplate() {
  downloadTemplate('task-detail')
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
    <BackButton to="/tasks" label="← 返回任务收集" />

    <!-- 页面标题 -->
    <div class="dt-page-header flex-between">
      <div>
        <h1 class="dt-page-title">{{ taskDetail?.task?.title || '加载中...' }}</h1>
        <p class="dt-page-description">
          <span class="dt-badge" :class="{
            'dt-badge-active': taskDetail?.task?.status === 'active',
            'dt-badge-draft': taskDetail?.task?.status === 'draft',
            'dt-badge-closed': taskDetail?.task?.status === 'closed'
          }" v-if="taskDetail?.task">
            {{ taskDetail.task.status === 'active' ? '收集中' : taskDetail.task.status === 'draft' ? '草稿' : '已归档' }}
          </span>
          <span style="margin-left:12px; color:var(--color-text-3);" v-if="taskDetail?.task">
            {{ taskDetail.task.start_date }} — {{ taskDetail.task.end_date }}
          </span>
        </p>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <el-button v-if="authStore.hasPermission('btn:task_detail:import', 'view')" size="small" @click="triggerImport">📥 导入</el-button>
        <el-button v-if="authStore.hasPermission('btn:task_detail:template', 'view')" size="small" @click="handleDownloadTemplate">📋 模板</el-button>
        <el-button circle @click="loadTaskData" title="刷新数据" style="font-size:16px;">🔄</el-button>
      </div>
    </div>

    <el-skeleton v-if="loading" :rows="8" animated />

    <!-- 提交数据 Tab -->
    <el-tabs v-else v-model="activeTab" type="border-card">
      <!-- ===== Tab 1: 提交数据 ===== -->
      <el-tab-pane :label="`提交数据 (${recordStore.list.length})`" name="records">
        <!-- REQ-17: 实时活动状态标签 -->
        <div v-if="activityData.editing.length > 0 || activityData.submitted.length > 0" style="margin-bottom:12px; display:flex; gap:8px; flex-wrap:wrap;">
          <span v-if="activityData.editing.length > 0" class="dt-activity-tag" style="background:rgba(0,180,42,0.1);color:#00B42A;border:1px solid rgba(0,180,42,0.25);">
            <span class="dt-activity-dot" style="background:#00B42A;"></span>
            {{ activityData.editing.join('、') }} 正在编辑任务
          </span>
          <span v-if="activityData.submitted.length > 0" class="dt-activity-tag" style="background:rgba(22,93,255,0.1);color:#165DFF;border:1px solid rgba(22,93,255,0.25);">
            <span class="dt-activity-dot" style="background:#165DFF;"></span>
            {{ activityData.submitted.join('、') }} 提交任务
          </span>
        </div>
        <div class="dt-data-card">
          <!-- 空状态 -->
          <div v-if="!recordStore.list.length" class="dt-empty">
            <div class="dt-empty-icon">📝</div>
            <p class="dt-empty-text">暂无提交数据，请先生成链接并分发给开发人员</p>
          </div>

          <!-- 数据表格 -->
          <el-table v-else :data="sortedRecords" border table-layout="fixed">
            <el-table-column type="index" label="序号" width="60" align="center" />

            <el-table-column label="人员" width="90">
              <template #default="{ row }">
                <span style="font-weight:600;">{{ row.staff?.name || '-' }}</span>
              </template>
            </el-table-column>

            <el-table-column label="角色" width="80">
              <template #default="{ row }">
                <span class="dt-tag" :class="ROLE_TAG_CLASS[row.staff?.role]">
                  {{ ROLE_LABEL[row.staff?.role] || '-' }}
                </span>
              </template>
            </el-table-column>

            <el-table-column prop="version" label="版本号" width="130">
              <template #default="{ row }">
                <template v-if="editingRowId === row.id">
                  <el-input v-model="editForm.version" size="small" placeholder="V4.633.0" />
                </template>
                <span v-else style="font-family:var(--font-mono);">{{ row.version || '-' }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="requirement_title" label="需求标题" min-width="200">
              <template #default="{ row }">
                <template v-if="editingRowId === row.id">
                  <el-input v-model="editForm.requirement_title" size="small" />
                </template>
                <span v-else>{{ row.requirement_title }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="product_managers" label="产品经理" width="120">
              <template #default="{ row }">
                <template v-if="editingRowId === row.id">
                  <el-input v-model="editForm.product_managers" size="small" placeholder="逗号分隔" />
                </template>
                <span v-else>
                  {{ parsePM(row.product_managers).join(', ') || '-' }}
                </span>
              </template>
            </el-table-column>

            <el-table-column prop="hours" label="工时/小时" width="100" align="center">
              <template #default="{ row }">
                <template v-if="editingRowId === row.id">
                  <el-input-number v-model="editForm.hours" :min="0.01" :max="200" :precision="2" :step="0.5" size="small" controls-position="right" />
                </template>
                <span v-else style="font-weight:700; color:var(--color-primary);">{{ row.hours }}</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="140" align="center" fixed="right">
              <template #default="{ row }">
                <template v-if="editingRowId === row.id">
                  <el-button type="success" link size="small" @click="saveEdit(row)">保存</el-button>
                  <el-button type="info" link size="small" @click="cancelEdit">取消</el-button>
                </template>
                <template v-else>
                  <el-button v-if="authStore.hasPermission('btn:task_detail:edit_record', 'view')" type="primary" link size="small" @click="startEdit(row)">编辑</el-button>
                  <el-button v-if="authStore.hasPermission('btn:task_detail:delete_record', 'view')" type="danger" link size="small" @click="deleteRecord(row)">删除</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

    </el-tabs>
    <!-- v2.0.0: 隐藏文件输入框 -->
    <input ref="importFileInput" type="file" accept=".xlsx,.xls" style="display:none;" @change="handleImportFile" />
    </template>
  </div>
</template>

<style scoped>
.dt-qr-fade-enter-active,
.dt-qr-fade-leave-active {
  transition: opacity .2s ease, transform .2s ease;
}
.dt-qr-fade-enter-from,
.dt-qr-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@keyframes dtBlink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
</style>
