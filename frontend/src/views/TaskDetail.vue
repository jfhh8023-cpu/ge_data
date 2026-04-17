<script setup>
/**
 * TaskDetail.vue — 任务详情页（三Tab切换）
 * v1.4.3: 页面加载动画 + PM解析过滤数字字符串
 * v1.4.2: 修复产品经理列数据错位，加固列绑定
 * Tab 1: 提交数据 — 内联编辑 + 删除 + API 联动
 * Tab 2: 链接管理 — 复制 + 发送 + 生成链接
 * Tab 3: 汇总报表 — 快捷入口（M3 实现）
 */
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTaskStore } from '../stores/task'
import { useRecordStore } from '../stores/record'

import { ElMessage, ElMessageBox } from 'element-plus'
import BackButton from '../components/BackButton.vue'
import api from '../api'
import { onDataChange, SYNC_EVENTS } from '../utils/sync'

const route = useRoute()
const taskStore = useTaskStore()
const recordStore = useRecordStore()


const activeTab = ref('records')
const taskId = computed(() => route.params.id)

/* ========== 数据加载 ========== */
const taskDetail = ref(null)
const links = ref([])
const loading = ref(true)
const pageLoading = ref(true)  // v1.4.3: 页面初始加载状态

async function loadTaskData() {
  loading.value = true
  try {
    const res = await taskStore.fetchDetail(taskId.value)
    taskDetail.value = res
    links.value = res.links || []
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
  stopDtPoll()
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

const sortedLinks = computed(() => {
  return [...links.value].sort((a, b) => {
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

/* ========== Tab 2: 链接管理 ========== */
/* REQ-28a: 预设通知文本改文案 */
const notifyText = ref('请填写上周工作内容，您的专属链接如下：')
const generatingLinks = ref(false)

/** 生成填写链接 */
async function generateLinks() {
  generatingLinks.value = true
  try {
    const res = await taskStore.generateLinks(taskId.value)
    ElMessage.success(res.message || '链接生成成功')
    // 重新加载详情以获取最新链接
    const detail = await taskStore.fetchDetail(taskId.value)
    links.value = detail.links || []
  } catch {
    ElMessage.error('生成链接失败')
  } finally {
    generatingLinks.value = false
  }
}

/** 构造完整链接 URL（适配生产子路径 /devtracker/） */
function buildFillUrl(token) {
  const base = import.meta.env.BASE_URL || '/'
  const normalizedBase = base.endsWith('/') ? base : base + '/'
  return `${window.location.origin}${normalizedBase}fill/${token}`
}

/** REQ-28b: 复制链接（仅URL） */
async function copyLinkOnly(link) {
  try {
    await navigator.clipboard.writeText(buildFillUrl(link.token))
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

/** REQ-28b: 复制全部（通知文本+链接） */
async function copyAll(link) {
  const fullText = `${notifyText.value}\n${buildFillUrl(link.token)}`
  try {
    await navigator.clipboard.writeText(fullText)
    ElMessage.success('通知文本+链接已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

/* ========== 钉钉登录状态 + 二维码 Popover ========== */
const dtLoggedIn = ref(false)
const dtSessionAge = ref('')
const dtQrcodeVisible = ref(false)
const dtQrcodeImg = ref('')
const dtQrcodeLoading = ref(false)
const dtQrcodeMsg = ref('')
let dtPollTimer = null

/** 拉取钉钉登录状态 */
async function fetchDtStatus() {
  try {
    const res = await api.get('/dingtalk/status')
    dtLoggedIn.value = res.data?.data?.loggedIn ?? false
    dtSessionAge.value = res.data?.data?.sessionAge ?? ''
  } catch {
    dtLoggedIn.value = false
  }
}

/** 点击「展开二维码」或点击状态标识 */
async function toggleDtQrcode() {
  if (dtQrcodeVisible.value) {
    dtQrcodeVisible.value = false
    stopDtPoll()
    return
  }
  dtQrcodeVisible.value = true
  dtQrcodeImg.value = ''
  dtQrcodeMsg.value = ''
  dtQrcodeLoading.value = true

  try {
    const res = await api.post('/dingtalk/login/qrcode')
    if (res.data.code === 4) {
      // 已登录
      dtQrcodeMsg.value = '当前已登录，无需扫码。如需切换账号，请先手动退出登录再扫码。'
      dtQrcodeLoading.value = false
      return
    }
    dtQrcodeImg.value = res.data.data.qrcode
    dtQrcodeLoading.value = false
    startDtPoll()
  } catch (err) {
    dtQrcodeMsg.value = '获取二维码失败：' + (err.response?.data?.message || err.message)
    dtQrcodeLoading.value = false
  }
}

function startDtPoll() {
  stopDtPoll()
  dtPollTimer = setInterval(async () => {
    try {
      const res = await api.get('/dingtalk/login/poll')
      if (res.data.code === 1) {
        // 出错（如超时）
        dtQrcodeMsg.value = res.data.message || '扫码失败，请重试'
        dtQrcodeImg.value = ''
        stopDtPoll()
        return
      }
      if (res.data.data?.done) {
        stopDtPoll()
        dtQrcodeVisible.value = false
        dtQrcodeImg.value = ''
        dtLoggedIn.value = true
        dtSessionAge.value = '今天登录'
        ElMessage.success('钉钉登录成功！')
      }
    } catch {
      // 静默
    }
  }, 2000)
}

function stopDtPoll() {
  if (dtPollTimer) {
    clearInterval(dtPollTimer)
    dtPollTimer = null
  }
}

/* ===== 发送钉钉私聊消息 ===== */
const sendingLinkId = ref('')

async function sendLink(link) {
  const staffName = link.staff?.name
  if (!staffName) return ElMessage.warning('该链接无关联人员')

  if (!dtLoggedIn.value) {
    ElMessage.warning('钉钉未登录，请先点击「未登录」按钮扫码登录')
    return
  }

  sendingLinkId.value = link.id
  const taskTitle = taskDetail.value?.title || '工时统计'
  const fillUrl = buildFillUrl(link.token)
  const message = `【工时填写提醒】\n${taskTitle}\n请点击链接填写：${fillUrl}`

  try {
    const res = await api.post('/dingtalk/send', { staffName, message })
    if (res.data.code === 0) {
      ElMessage.success(`已发送给 ${staffName}`)
    } else {
      ElMessage.error(res.data.message || '发送失败')
    }
  } catch (err) {
    const msg = err.response?.data?.message || err.message
    const code = err.response?.data?.code
    if (code === 2) {
      dtLoggedIn.value = false
      ElMessage.warning('钉钉会话已过期，请重新扫码登录')
    } else if (code === 3) {
      ElMessage.error(`未在钉钉中找到联系人：${staffName}`)
    } else {
      ElMessage.error('发送失败：' + msg)
    }
  } finally {
    sendingLinkId.value = ''
  }
}

// 切换到链接管理 tab 时拉取钉钉状态
watch(activeTab, (tab) => {
  if (tab === 'links') fetchDtStatus()
})

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
      <el-button circle @click="loadTaskData" title="刷新数据" style="font-size:16px;">🔄</el-button>
    </div>

    <el-skeleton v-if="loading" :rows="8" animated />

    <!-- 三Tab切换 -->
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
                  <el-button type="primary" link size="small" @click="startEdit(row)">编辑</el-button>
                  <el-button type="danger" link size="small" @click="deleteRecord(row)">删除</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ===== Tab 2: 链接管理 ===== -->
      <el-tab-pane :label="`链接管理 (${links.length})`" name="links">
        <div class="dt-data-card" style="padding:20px;">
          <!-- 预设通知文本框 -->
          <div style="margin-bottom:20px;">
            <label style="font-size:13px; font-weight:500; color:var(--color-text-2); display:block; margin-bottom:8px;">
              预设通知文本
            </label>
            <el-input
              v-model="notifyText"
              type="textarea"
              :rows="2"
              placeholder="请填写本周工作内容，链接如下："
            />
          </div>

          <!-- 生成链接按钮 + 钉钉登录状态 -->
          <div style="margin-bottom:16px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; position:relative;">
            <el-button type="primary" @click="generateLinks" :loading="generatingLinks">
              🔗 为全员生成链接
            </el-button>

            <!-- 钉钉登录状态指示器 -->
            <div style="display:flex; align-items:center; gap:6px;">
              <!-- 状态标签（点击可重新扫码） -->
              <span
                :style="{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  padding: '3px 10px', borderRadius: '12px', fontSize: '12px',
                  fontWeight: 500, cursor: 'pointer', userSelect: 'none',
                  background: dtLoggedIn ? '#f0fdf4' : '#fff1f0',
                  color: dtLoggedIn ? '#15803d' : '#cf1322',
                  border: dtLoggedIn ? '1px solid #bbf7d0' : '1px solid #ffa39e',
                  transition: 'opacity .2s'
                }"
                @click="toggleDtQrcode"
                :title="dtLoggedIn ? `点击重新登录（${dtSessionAge}）` : '点击扫码登录钉钉'"
              >
                <span>{{ dtLoggedIn ? '●' : '○' }}</span>
                <span>{{ dtLoggedIn ? `钉钉已登录` : '钉钉未登录' }}</span>
                <span v-if="dtLoggedIn && dtSessionAge" style="opacity:.7; font-size:11px;">· {{ dtSessionAge }}</span>
              </span>

              <!-- 展开/收起二维码按钮 -->
              <el-button
                size="small"
                :type="dtQrcodeVisible ? 'info' : 'default'"
                @click="toggleDtQrcode"
                style="padding:3px 8px; font-size:12px; height:26px;"
              >{{ dtQrcodeVisible ? '▲ 收起' : '▼ 扫码' }}</el-button>
            </div>

            <!-- 二维码浮显卡片 -->
            <transition name="dt-qr-fade">
              <div
                v-if="dtQrcodeVisible"
                style="
                  position:absolute; z-index:999;
                  top:calc(100% + 6px); left:0;
                  background:#fff; border:1px solid #e4e7ed;
                  border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,.12);
                  padding:16px; min-width:220px; text-align:center;
                "
              >
                <div style="font-size:13px; font-weight:500; color:var(--color-text-1); margin-bottom:10px;">
                  {{ dtLoggedIn ? '重新登录钉钉' : '扫码登录钉钉' }}
                </div>

                <!-- 加载中 -->
                <div v-if="dtQrcodeLoading" style="padding:30px 0; color:var(--color-text-3); font-size:13px;">
                  <div style="margin-bottom:8px;">正在获取二维码...</div>
                </div>

                <!-- 提示信息（已登录 / 报错） -->
                <div v-else-if="dtQrcodeMsg" style="padding:12px; color:var(--color-text-2); font-size:12px; line-height:1.6;">
                  {{ dtQrcodeMsg }}
                </div>

                <!-- 二维码图片 -->
                <div v-else-if="dtQrcodeImg">
                  <img :src="dtQrcodeImg" style="width:180px; height:180px; display:block; margin:0 auto;" alt="钉钉登录二维码" />
                  <div style="margin-top:8px; font-size:11px; color:var(--color-text-3);">
                    用手机钉钉扫码后自动登录
                  </div>
                </div>

                <el-button
                  size="small"
                  style="margin-top:10px; width:100%;"
                  @click="dtQrcodeVisible = false; stopDtPoll()"
                >关闭</el-button>
              </div>
            </transition>
          </div>

          <!-- 链接列表 -->
          <div v-if="!links.length" class="dt-empty" style="padding:40px;">
            <div class="dt-empty-icon">🔗</div>
            <p class="dt-empty-text">暂无填写链接，请点击上方「为全员生成链接」</p>
          </div>

          <el-table v-else :data="sortedLinks" border>
            <el-table-column label="人员" width="100">
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

            <el-table-column label="专属链接" min-width="300">
              <template #default="{ row }">
                <a :href="buildFillUrl(row.token)" target="_blank"
                   style="font-family:var(--font-mono); font-size:12px; color:var(--color-primary); word-break:break-all;">
                  {{ buildFillUrl(row.token) }}
                </a>
              </template>
            </el-table-column>

            <el-table-column label="提交状态" width="100" align="center">
              <template #default="{ row }">
                <span class="dt-badge" :class="row.is_submitted ? 'dt-badge-active' : 'dt-badge-draft'">
                  {{ row.is_submitted ? '已提交' : '未提交' }}
                </span>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="220" align="center">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="copyLinkOnly(row)">复制链接</el-button>
                <el-button type="primary" link size="small" @click="copyAll(row)">复制全部</el-button>
                <el-button
                  type="primary" link size="small"
                  :loading="sendingLinkId === row.id"
                  :disabled="sendingLinkId !== '' && sendingLinkId !== row.id"
                  @click="sendLink(row)"
                >{{ sendingLinkId === row.id ? '发送中...' : '发送' }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

    </el-tabs>
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
</style>
