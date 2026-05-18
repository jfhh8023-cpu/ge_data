<script setup>
/**
 * SettingsPage.vue — v3.1.0 设置中心
 * 自动执行任务并通知 + 需求工时统计全量备份下载
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Download, Plus, Promotion } from '@element-plus/icons-vue'
import api from '../api'
import BackButton from '../components/BackButton.vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const loading = ref(true)
const savingId = ref('')
const testingId = ref('')
const testingRunId = ref('')
const downloading = ref(false)
const rules = ref([])
const logs = ref([])
const messages = ref([])
const historyExpanded = ref({})
const historyBatchMode = ref({})
const selectedHistoryIds = ref({})
const recipientDialogVisible = ref(false)
const recipientSaving = ref(false)
const recipientStaffLoading = ref(false)
const recipientRule = ref(null)
const recipientRuleIndex = ref(-1)
const recipientStaffList = ref([])
const recipientConfig = ref(createDefaultRecipientConfig())
const backupFormat = ref('xlsx')
const nowTs = ref(Date.now())
let countdownTimer = null

const CURRENT_YEAR = new Date().getFullYear()
const OLD_SKIP_MESSAGE = '本周任务已存在，若需新增，请手动处理'
const NEW_SKIP_MESSAGE = '该任务已存在或无法新增超过下一周的新收集任务，若仍需新增，请手动处理'
const monthDayOptions = Array.from({ length: 31 }, (_, i) => i + 1)
const weekDayOptions = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' }
]
const ROLE_LABEL = { frontend: '前端', backend: '后端', test: '测试' }
const PHONE_PATTERN = /^\d{5,20}$/

const canEditAutoTasks = computed(() =>
  authStore.hasPermission('btn:settings:auto_task_save', 'create') ||
  authStore.hasPermission('btn:settings:auto_task_save', 'update') ||
  authStore.hasPermission('btn:settings:auto_task_save', 'delete')
)
const canCreateAutoTasks = computed(() => authStore.hasPermission('btn:settings:auto_task_save', 'create'))
const canDeleteAutoTasks = computed(() => authStore.hasPermission('btn:settings:auto_task_save', 'delete'))
const canDownloadBackup = computed(() => authStore.hasPermission('btn:settings:backup_download', 'view'))

function defaultWebhookName(index) {
  return `钉钉群webhook机器人${String(index + 1).padStart(2, '0')}`
}

function createDefaultWebhook(index = 0) {
  return {
    name: defaultWebhookName(index),
    url: ''
  }
}

function createDefaultRecipientConfig() {
  return {
    enabled: false,
    at_mode: 'people',
    staff_ids: [],
    extra: []
  }
}

function createDefaultRule() {
  return {
    localKey: `new_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    id: '',
    name: '自动生成下一周任务',
    enabled: true,
    schedule_type: 'weekly',
    schedule_year: CURRENT_YEAR,
    month_days: [1],
    week_days: [1],
    execute_time: '09:00:00',
    notify_enabled: true,
    dingtalk_webhooks: [createDefaultWebhook()],
    dingtalk_message: '',
    dingtalk_recipients: createDefaultRecipientConfig(),
    next_run_at: null,
    _savedNotificationKey: ''
  }
}

function normalizeWebhookConfigs(value) {
  let list = value
  if (typeof list === 'string') {
    try {
      const parsed = JSON.parse(list)
      list = Array.isArray(parsed) ? parsed : list
    } catch {
      // keep string as a single webhook
    }
  }
  if (!Array.isArray(list)) list = list ? [list] : [createDefaultWebhook()]
  const normalized = list.map((item, index) => {
    if (typeof item === 'string') {
      return {
        name: defaultWebhookName(index),
        url: item
      }
    }
    return {
      name: String(item?.name || defaultWebhookName(index)),
      url: String(item?.url || item?.webhook || item?.value || '')
    }
  })
  return normalized.length ? normalized : [createDefaultWebhook()]
}

function compactWebhooks(rule) {
  return normalizeWebhookConfigs(rule.dingtalk_webhooks)
    .map((item, index) => ({
      name: String(item.name || defaultWebhookName(index)).trim() || defaultWebhookName(index),
      url: String(item.url || '').trim()
    }))
    .filter(item => item.url)
}

function isValidPhone(phone) {
  return PHONE_PATTERN.test(String(phone || '').trim())
}

function normalizeRecipientConfig(value) {
  let raw = value
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = null
    }
  }
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    enabled: source.enabled === true,
    at_mode: source.at_mode === 'all' ? 'all' : 'people',
    staff_ids: Array.isArray(source.staff_ids)
      ? [...new Set(source.staff_ids.map(id => String(id || '').trim()).filter(Boolean))]
      : [],
    extra: Array.isArray(source.extra)
      ? source.extra.map((item, index) => ({
        id: String(item?.id || `extra_${Date.now()}_${index}`),
        name: String(item?.name || ''),
        role: String(item?.role || ''),
        phone: String(item?.phone || ''),
        selected: item?.selected === true
      }))
      : []
  }
}

function hasRecipientConfig(value) {
  const config = normalizeRecipientConfig(value)
  return Boolean(config.enabled || config.staff_ids.length || config.extra.length)
}

function notificationKey(rule) {
  return JSON.stringify({
    webhooks: compactWebhooks(rule),
    message: String(rule.dingtalk_message || '').trim(),
    recipients: normalizeRecipientConfig(rule.dingtalk_recipients)
  })
}

function normalizeRule(rule) {
  const normalized = {
    ...createDefaultRule(),
    ...rule,
    month_days: Array.isArray(rule.month_days) ? rule.month_days : [],
    week_days: Array.isArray(rule.week_days) ? rule.week_days : [],
    dingtalk_webhooks: normalizeWebhookConfigs(rule.dingtalk_webhooks || rule.dingtalk_webhook),
    dingtalk_recipients: normalizeRecipientConfig(rule.dingtalk_recipients)
  }
  normalized._savedNotificationKey = normalized.id ? notificationKey(normalized) : ''
  return normalized
}

function sortRules(list) {
  return [...list].sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : Number.MAX_SAFE_INTEGER
    const bt = b.created_at ? new Date(b.created_at).getTime() : Number.MAX_SAFE_INTEGER
    return at - bt
  })
}

async function loadSettings() {
  loading.value = true
  try {
    const res = await api.get('/settings/auto-tasks')
    const data = res.data || {}
    rules.value = sortRules((data.rules || []).map(normalizeRule))
    logs.value = data.logs || []
    messages.value = data.messages || []
  } finally {
    loading.value = false
  }
}

function addRule() {
  rules.value.push(createDefaultRule())
}

function localRuleKey(rule) {
  return rule.id || rule.localKey
}

async function recordRuleMessage(rule, level, action, message) {
  if (!rule?.id || !message) return
  try {
    const res = await api.post(`/settings/auto-tasks/${rule.id}/messages`, { level, action, message })
    if (res.data) messages.value = [res.data, ...messages.value]
  } catch {
    // 提示历史记录失败不阻断当前用户操作。
  }
}

function warnRule(rule, message) {
  ElMessage.warning(message)
  recordRuleMessage(rule, 'warning', 'validate', message)
}

function validateWebhooks(rule, requireComplete = false) {
  const webhooks = compactWebhooks(rule)
  const message = String(rule.dingtalk_message || '').trim()
  if (requireComplete && webhooks.length === 0) {
    warnRule(rule, '请至少配置一个钉钉 webhook')
    return false
  }
  if (requireComplete && !message) {
    warnRule(rule, '请填写通知内容')
    return false
  }
  const invalid = webhooks.find(item => !/^https?:\/\//i.test(item.url))
  if (invalid) {
    warnRule(rule, 'webhook 地址必须以 http 或 https 开头')
    return false
  }
  return true
}

function validateRule(rule, options = {}) {
  if (!rule.name?.trim()) {
    warnRule(rule, '请输入规则名称')
    return false
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(rule.execute_time || '')) {
    warnRule(rule, '执行时间格式必须为 HH:mm:ss')
    return false
  }
  if (rule.schedule_type === 'monthly') {
    if (!rule.schedule_year) {
      warnRule(rule, '请选择执行年份')
      return false
    }
    if (!rule.month_days?.length) {
      warnRule(rule, '请选择每月执行日期')
      return false
    }
  }
  if (rule.schedule_type === 'weekly' && !rule.week_days?.length) {
    warnRule(rule, '请选择每周执行星期')
    return false
  }
  if (rule.notify_enabled && !validateWebhooks(rule, options.requireNotification)) return false
  return true
}

function buildPayload(rule) {
  return {
    name: rule.name.trim(),
    enabled: !!rule.enabled,
    schedule_type: rule.schedule_type,
    schedule_year: rule.schedule_type === 'monthly' ? Number(rule.schedule_year) : null,
    month_days: rule.schedule_type === 'monthly' ? rule.month_days : [],
    week_days: rule.schedule_type === 'weekly' ? rule.week_days : [],
    execute_time: rule.execute_time,
    notify_enabled: !!rule.notify_enabled,
    dingtalk_webhooks: compactWebhooks(rule),
    dingtalk_message: rule.dingtalk_message || '',
    dingtalk_recipients: normalizeRecipientConfig(rule.dingtalk_recipients)
  }
}

async function saveRule(rule, index, options = {}) {
  if (!validateRule(rule, options)) return
  savingId.value = rule.id || rule.localKey
  try {
    const payload = buildPayload(rule)
    const res = rule.id
      ? await api.put(`/settings/auto-tasks/${rule.id}`, payload)
      : await api.post('/settings/auto-tasks', payload)
    rules.value[index] = normalizeRule(res.data)
    ElMessage.success('编辑成功')
    await loadSettings()
  } catch {
    ElMessage.error('编辑失败')
  } finally {
    savingId.value = ''
  }
}

async function handleRuleStatusChange(rule, index) {
  if (!rule.id) return
  savingId.value = rule.id
  try {
    const res = await api.patch(`/settings/auto-tasks/${rule.id}/status`, { enabled: rule.enabled })
    rules.value[index] = normalizeRule(res.data)
    ElMessage.success('编辑成功')
  } catch {
    rule.enabled = !rule.enabled
    ElMessage.error('编辑失败')
  } finally {
    savingId.value = ''
  }
}

async function deleteRule(rule, index) {
  if (!rule.id) {
    rules.value.splice(index, 1)
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除自动任务规则「${rule.name}」？`, '删除规则', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    await api.delete(`/settings/auto-tasks/${rule.id}`)
    rules.value.splice(index, 1)
    ElMessage.success('已删除')
  } catch {
    // 用户取消或删除失败时保持原状态
  }
}

function addWebhook(rule) {
  rule.dingtalk_webhooks = normalizeWebhookConfigs(rule.dingtalk_webhooks)
  rule.dingtalk_webhooks.push(createDefaultWebhook(rule.dingtalk_webhooks.length))
}

function removeWebhook(rule, index) {
  rule.dingtalk_webhooks = normalizeWebhookConfigs(rule.dingtalk_webhooks)
  if (rule.dingtalk_webhooks.length <= 1) {
    rule.dingtalk_webhooks = [createDefaultWebhook()]
    return
  }
  rule.dingtalk_webhooks.splice(index, 1)
}

async function testNotification(rule) {
  if (!validateWebhooks(rule, true)) return
  testingId.value = rule.id || rule.localKey
  try {
    await api.post('/settings/auto-tasks/test-notify', {
      rule_id: rule.id,
      dingtalk_webhooks: compactWebhooks(rule),
      dingtalk_message: rule.dingtalk_message || '',
      dingtalk_recipients: normalizeRecipientConfig(rule.dingtalk_recipients)
    })
    ElMessage.success('测试发送成功')
    await loadSettings()
  } catch {
    ElMessage.error('测试发送失败')
  } finally {
    testingId.value = ''
  }
}

async function testRunRule(rule) {
  if (!rule.id) {
    ElMessage.warning('请先保存规则后再测试执行')
    return
  }
  testingRunId.value = rule.id
  try {
    const res = await api.post(`/settings/auto-tasks/${rule.id}/test-run`)
    if (res.code !== 0) {
      ElMessage.error(res.message || '测试执行失败')
    } else {
      ElMessage.success(res.message || '测试执行完成')
    }
    await loadSettings()
  } catch {
    ElMessage.error('测试执行失败')
  } finally {
    testingRunId.value = ''
  }
}

async function openRecipients(rule, index) {
  if (!rule.id) {
    ElMessage.warning('请先保存规则后再配置接收人')
    return
  }
  recipientRule.value = rule
  recipientRuleIndex.value = index
  recipientDialogVisible.value = true
  recipientStaffLoading.value = true
  try {
    const res = await api.get('/staff')
    recipientStaffList.value = res.data || []
    const config = normalizeRecipientConfig(rule.dingtalk_recipients)
    recipientConfig.value = {
      ...config,
      staff_ids: hasRecipientConfig(rule.dingtalk_recipients)
        ? config.staff_ids
        : recipientStaffList.value.filter(staff => isValidPhone(staff.phone)).map(staff => staff.id),
      extra: config.extra
    }
  } catch {
    ElMessage.error('加载接收人失败')
    recipientDialogVisible.value = false
  } finally {
    recipientStaffLoading.value = false
  }
}

function isStaffRecipientChecked(staff) {
  return recipientConfig.value.staff_ids.includes(staff.id)
}

function toggleStaffRecipient(staff, checked) {
  if (checked && !isValidPhone(staff.phone)) {
    ElMessage.warning('手机号码为空，请在【团队人员】页面添加后再试')
    return
  }
  const current = recipientConfig.value.staff_ids
  recipientConfig.value.staff_ids = checked
    ? [...new Set([...current, staff.id])]
    : current.filter(id => id !== staff.id)
}

function addExtraRecipient() {
  recipientConfig.value.extra.push({
    id: `extra_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: '',
    role: '',
    phone: '',
    selected: false
  })
}

function removeExtraRecipient(index) {
  recipientConfig.value.extra.splice(index, 1)
}

function isExtraComplete(item) {
  return Boolean(item.name?.trim() && item.role?.trim() && isValidPhone(item.phone))
}

function autoCheckExtraRecipient(item) {
  if (isExtraComplete(item)) item.selected = true
  if (!item.name?.trim() || !item.role?.trim() || !item.phone?.trim()) item.selected = false
}

function toggleExtraRecipient(item, checked) {
  if (checked && !isExtraComplete(item)) {
    ElMessage.warning('请填写姓名、角色和有效手机号码后再勾选')
    return
  }
  item.selected = checked
}

function buildRecipientPayload() {
  const extra = []
  for (const item of recipientConfig.value.extra) {
    const hasAnyValue = item.name?.trim() || item.role?.trim() || item.phone?.trim()
    if (!hasAnyValue) continue
    if (!isExtraComplete(item)) {
      ElMessage.warning('额外接收人的姓名、角色、手机号码必须填写完整')
      return null
    }
    extra.push({
      id: item.id,
      name: item.name.trim(),
      role: item.role.trim(),
      phone: item.phone.trim(),
      selected: item.selected === true
    })
  }
  const validStaffIds = recipientStaffList.value
    .filter(staff => isValidPhone(staff.phone) && recipientConfig.value.staff_ids.includes(staff.id))
    .map(staff => staff.id)
  return {
    enabled: recipientConfig.value.enabled === true,
    at_mode: recipientConfig.value.at_mode === 'all' ? 'all' : 'people',
    staff_ids: validStaffIds,
    extra
  }
}

async function saveRecipients() {
  const rule = recipientRule.value
  if (!rule?.id) return
  const payload = buildRecipientPayload()
  if (!payload) return
  recipientSaving.value = true
  try {
    rule.dingtalk_recipients = payload
    const res = await api.put(`/settings/auto-tasks/${rule.id}`, buildPayload(rule))
    if (recipientRuleIndex.value > -1) {
      rules.value[recipientRuleIndex.value] = normalizeRule(res.data)
    }
    ElMessage.success('编辑成功')
    recipientDialogVisible.value = false
    await loadSettings()
  } catch {
    ElMessage.error('编辑失败')
  } finally {
    recipientSaving.value = false
  }
}

function historyKey(rule) {
  return rule.id || rule.localKey
}

function historyLevelFromStatus(status) {
  if (status === 'success') return 'success'
  if (status === 'skipped') return 'warning'
  if (status === 'failed' || status === 'notify_failed') return 'error'
  return 'info'
}

function ruleHistory(rule) {
  if (!rule?.id) return []
  const messageRows = messages.value
    .filter(item => item.rule_id === rule.id)
    .map(item => ({ ...item, message: normalizeHistoryMessage(item.message), source: 'message' }))
  const runRows = logs.value
    .filter(log => log.rule_id === rule.id)
    .map(log => ({
      id: `run_${log.id}`,
      rule_id: log.rule_id,
      status: log.status,
      level: historyLevelFromStatus(log.status),
      action: 'auto_run',
      message: normalizeHistoryMessage(log.message),
      created_at: log.created_at || log.scheduled_at,
      scheduled_at: log.scheduled_at,
      source: 'run'
    }))
  return [...messageRows, ...runRows].sort((a, b) => {
    const at = new Date(a.created_at || a.scheduled_at || 0).getTime()
    const bt = new Date(b.created_at || b.scheduled_at || 0).getTime()
    return bt - at
  })
}

function firstHistory(rule) {
  return ruleHistory(rule)[0] || null
}

function normalizeHistoryMessage(message) {
  return message === OLD_SKIP_MESSAGE ? NEW_SKIP_MESSAGE : message
}

function toggleHistory(rule) {
  const key = historyKey(rule)
  historyExpanded.value[key] = !historyExpanded.value[key]
}

function isHistorySelected(rule, item) {
  const key = historyKey(rule)
  return (selectedHistoryIds.value[key] || []).includes(item.id)
}

function toggleHistorySelected(rule, item, checked) {
  const key = historyKey(rule)
  const current = selectedHistoryIds.value[key] || []
  selectedHistoryIds.value[key] = checked
    ? [...new Set([...current, item.id])]
    : current.filter(id => id !== item.id)
}

function toggleHistoryBatch(rule, checked) {
  const key = historyKey(rule)
  historyBatchMode.value[key] = checked
  if (!checked) selectedHistoryIds.value[key] = []
}

async function deleteHistoryItem(rule, item) {
  if (!rule?.id || !item?.id) return
  try {
    await api.delete(`/settings/auto-tasks/${rule.id}/messages`, { data: { ids: [item.id] } })
    messages.value = messages.value.filter(row => row.id !== item.id)
    logs.value = logs.value.filter(row => `run_${row.id}` !== item.id)
    ElMessage.success('已删除')
    await loadSettings()
  } catch {
    ElMessage.error('删除失败')
  }
}

async function deleteSelectedHistory(rule) {
  const key = historyKey(rule)
  const ids = selectedHistoryIds.value[key] || []
  if (!rule?.id || ids.length === 0) return
  try {
    await api.delete(`/settings/auto-tasks/${rule.id}/messages`, { data: { ids } })
    messages.value = messages.value.filter(row => !ids.includes(row.id))
    logs.value = logs.value.filter(row => !ids.includes(`run_${row.id}`))
    selectedHistoryIds.value[key] = []
    ElMessage.success('已删除')
    await loadSettings()
  } catch {
    ElMessage.error('删除失败')
  }
}

async function deleteAllHistory(rule) {
  if (!rule?.id) return
  try {
    await ElMessageBox.confirm('确认删除该规则下全部提示历史？', '删除提示历史', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    await api.delete(`/settings/auto-tasks/${rule.id}/messages`, { data: {} })
    messages.value = messages.value.filter(row => row.rule_id !== rule.id)
    logs.value = logs.value.filter(row => row.rule_id !== rule.id)
    selectedHistoryIds.value[historyKey(rule)] = []
    ElMessage.success('已删除')
    await loadSettings()
  } catch {
    // 用户取消或删除失败时保持原状。
  }
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function statusText(status) {
  return {
    running: '执行中',
    success: '成功',
    skipped: '无需新增',
    failed: '失败',
    notify_failed: '通知失败',
    warning: '校验',
    error: '失败',
    info: '信息'
  }[status] || '未执行'
}

function statusClass(status) {
  return {
    success: 'dt-tag-green',
    warning: 'dt-tag-orange',
    skipped: 'dt-tag-orange',
    error: 'dt-tag-red',
    failed: 'dt-tag-red',
    notify_failed: 'dt-tag-red',
    running: 'dt-tag-blue'
  }[status] || 'dt-tag-gray'
}

function historyStatusText(item) {
  return item.status ? statusText(item.status) : statusText(item.level)
}

function historyStatusClass(item) {
  return statusClass(item.status || item.level)
}

function historyTimeLabel(item) {
  return item.status ? '最近触发' : '记录时间'
}

function hasSavedNotification(rule) {
  return Boolean(
    rule.id &&
    rule.notify_enabled &&
    compactWebhooks(rule).length > 0 &&
    String(rule.dingtalk_message || '').trim() &&
    notificationKey(rule) === rule._savedNotificationKey
  )
}

function notificationPreview(rule) {
  const text = String(rule.dingtalk_message || '').trim()
  return text.length > 20 ? `${text.slice(0, 20)}...` : text
}

function nextCountdown(rule) {
  if (!rule.next_run_at) return '暂无下一次触发'
  const target = new Date(rule.next_run_at).getTime()
  if (Number.isNaN(target)) return '暂无下一次触发'
  const diff = target - nowTs.value
  if (diff <= 0) return '等待触发'
  const totalSeconds = Math.floor(diff / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}天${hours}时${minutes}分`
  if (hours > 0) return `${hours}时${minutes}分${seconds}秒`
  return `${minutes}分${seconds}秒`
}

function downloadFilename(format) {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `需求工时统计全量备份_${ts}.${format}`
}

async function downloadBackup() {
  if (!canDownloadBackup.value) return
  downloading.value = true
  try {
    const blob = await api.get(`/settings/report-backup?format=${backupFormat.value}`, {
      responseType: 'blob',
      timeout: 60000
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = downloadFilename(backupFormat.value)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    ElMessage.success('下载已开始')
  } catch {
    ElMessage.error('下载失败')
  } finally {
    downloading.value = false
  }
}

onMounted(async () => {
  await loadSettings()
  countdownTimer = setInterval(() => { nowTs.value = Date.now() }, 1000)
})

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>

<template>
  <div>
    <BackButton />

    <div class="dt-page-header">
      <h2 class="dt-page-title">设置</h2>
      <p class="dt-page-description">自动任务、钉钉 webhook 通知与需求工时统计备份。</p>
    </div>

    <div v-if="loading" class="dt-page-loading">
      <div class="dt-page-spinner"></div>
    </div>

    <template v-else>
      <section class="dt-settings-section">
        <div class="dt-settings-section-head">
          <div>
            <h3>自动执行任务并通知</h3>
            <p>按北京时间触发，自动生成下一个周维度任务收集任务。</p>
          </div>
          <el-button v-if="canCreateAutoTasks" type="primary" :icon="Plus" @click="addRule">新增规则</el-button>
        </div>

        <div v-if="rules.length === 0" class="dt-empty">
          <div class="dt-empty-text">暂无自动任务规则</div>
        </div>

        <div v-for="(rule, index) in rules" :key="rule.id || rule.localKey" class="dt-settings-rule">
          <div class="dt-rule-line">
            <span class="dt-rule-index">{{ index + 1 }}</span>
            <el-select v-model="rule.schedule_type" class="dt-rule-type" size="small" :disabled="!canEditAutoTasks">
              <el-option label="每周星期" value="weekly" />
              <el-option label="年内每月日期" value="monthly" />
            </el-select>
            <el-input-number
              v-if="rule.schedule_type === 'monthly'"
              v-model="rule.schedule_year"
              class="dt-rule-year"
              size="small"
              :min="CURRENT_YEAR"
              :max="CURRENT_YEAR + 5"
              :disabled="!canEditAutoTasks"
            />
            <el-select
              v-if="rule.schedule_type === 'monthly'"
              v-model="rule.month_days"
              class="dt-rule-days"
              size="small"
              multiple
              collapse-tags
              collapse-tags-tooltip
              :disabled="!canEditAutoTasks"
              placeholder="日期"
            >
              <el-option v-for="day in monthDayOptions" :key="day" :label="`${day}日`" :value="day" />
            </el-select>
            <el-select
              v-if="rule.schedule_type === 'weekly'"
              v-model="rule.week_days"
              class="dt-rule-weekdays"
              size="small"
              multiple
              collapse-tags
              collapse-tags-tooltip
              :disabled="!canEditAutoTasks"
              placeholder="星期"
            >
              <el-option v-for="day in weekDayOptions" :key="day.value" :label="day.label" :value="day.value" />
            </el-select>
            <el-time-picker
              v-model="rule.execute_time"
              class="dt-rule-time"
              size="small"
              value-format="HH:mm:ss"
              format="HH:mm:ss"
              placeholder="HH:mm:ss"
              :disabled="!canEditAutoTasks"
            />
            <el-button
              size="small"
              type="primary"
              :loading="savingId === (rule.id || rule.localKey)"
              :disabled="!canEditAutoTasks"
              @click="saveRule(rule, index)"
            >
              保存规则
            </el-button>
            <el-button
              size="small"
              plain
              :loading="testingRunId === rule.id"
              :disabled="!canEditAutoTasks || !rule.id"
              title="立即测试执行一次任务和通知，不修改自动触发规则"
              @click="testRunRule(rule)"
            >
              测试执行
            </el-button>
            <el-button
              v-if="canDeleteAutoTasks"
              size="small"
              type="danger"
              plain
              title="删除规则"
              @click="deleteRule(rule, index)"
            >
              删除
            </el-button>
            <span class="dt-inline-label">启用</span>
            <el-switch
              v-model="rule.enabled"
              class="dt-switch-large"
              size="large"
              :disabled="!canEditAutoTasks"
              @change="handleRuleStatusChange(rule, index)"
            />
          </div>

          <div class="dt-settings-notify-row">
            <span class="dt-settings-switch-label">钉钉 webhook 通知</span>
            <el-switch
              v-model="rule.notify_enabled"
              class="dt-switch-large"
              size="large"
              :disabled="!canEditAutoTasks"
            />
            <template v-if="hasSavedNotification(rule)">
              <span class="dt-next-run">下次通知：{{ nextCountdown(rule) }}</span>
              <el-tooltip :content="rule.dingtalk_message" placement="top">
                <span class="dt-notify-preview">内容：{{ notificationPreview(rule) }}</span>
              </el-tooltip>
            </template>
          </div>

          <div v-if="rule.notify_enabled" class="dt-settings-notify-fields">
            <div class="dt-webhook-list">
              <div v-for="(webhook, webhookIndex) in rule.dingtalk_webhooks" :key="webhookIndex" class="dt-webhook-row">
                <el-input
                  v-model="webhook.name"
                  size="small"
                  :placeholder="defaultWebhookName(webhookIndex)"
                  :disabled="!canEditAutoTasks"
                />
                <el-input
                  v-model="webhook.url"
                  size="small"
                  :placeholder="`机器人 ${webhookIndex + 1} webhook`"
                  :disabled="!canEditAutoTasks"
                />
                <el-button
                  size="small"
                  plain
                  :icon="Plus"
                  title="添加机器人"
                  :disabled="!canEditAutoTasks"
                  @click="addWebhook(rule)"
                />
                <el-button
                  size="small"
                  plain
                  type="danger"
                  :icon="Delete"
                  title="删除机器人"
                  :disabled="!canEditAutoTasks"
                  @click="removeWebhook(rule, webhookIndex)"
                />
              </div>
            </div>
            <el-input
              v-model="rule.dingtalk_message"
              class="dt-notify-message"
              type="textarea"
              :rows="2"
              placeholder="发送给所有钉钉 webhook 机器人的固定文本内容"
              :disabled="!canEditAutoTasks"
            />
            <div class="dt-notify-actions">
              <el-button
                size="small"
                :icon="Promotion"
                :loading="testingId === (rule.id || rule.localKey)"
                :disabled="!canEditAutoTasks"
                @click="testNotification(rule)"
              >
                测试发送
              </el-button>
              <el-button
                size="small"
                plain
                :disabled="!canEditAutoTasks || !rule.id"
                @click="openRecipients(rule, index)"
              >
                接收人
              </el-button>
              <el-button
                size="small"
                type="primary"
                :loading="savingId === (rule.id || rule.localKey)"
                :disabled="!canEditAutoTasks"
                @click="saveRule(rule, index, { requireNotification: true })"
              >
                保存通知
              </el-button>
            </div>
          </div>

          <div v-if="firstHistory(rule)" class="dt-settings-history">
            <div class="dt-history-summary">
              <button type="button" class="dt-history-toggle" @click="toggleHistory(rule)">
                {{ historyExpanded[historyKey(rule)] ? '收起' : '展开' }}
              </button>
              <span class="dt-tag" :class="historyStatusClass(firstHistory(rule))">
                {{ historyStatusText(firstHistory(rule)) }}
              </span>
              <span>{{ historyTimeLabel(firstHistory(rule)) }}：{{ formatDateTime(firstHistory(rule).scheduled_at || firstHistory(rule).created_at) }}</span>
              <span class="dt-history-message">{{ firstHistory(rule).message }}</span>
              <button type="button" class="dt-history-delete" title="删除" @click="deleteHistoryItem(rule, firstHistory(rule))">×</button>
            </div>

            <div v-if="historyExpanded[historyKey(rule)]" class="dt-history-panel">
              <div class="dt-history-actions">
                <el-checkbox
                  :model-value="historyBatchMode[historyKey(rule)]"
                  @change="checked => toggleHistoryBatch(rule, checked)"
                >
                  批量
                </el-checkbox>
                <el-button
                  v-if="historyBatchMode[historyKey(rule)]"
                  size="small"
                  plain
                  :disabled="!(selectedHistoryIds[historyKey(rule)] || []).length"
                  @click="deleteSelectedHistory(rule)"
                >
                  删除选中
                </el-button>
                <el-button size="small" plain type="danger" @click="deleteAllHistory(rule)">全部删除</el-button>
              </div>
              <div v-for="item in ruleHistory(rule)" :key="item.id" class="dt-history-item">
                <el-checkbox
                  v-if="historyBatchMode[historyKey(rule)]"
                  :model-value="isHistorySelected(rule, item)"
                  @change="checked => toggleHistorySelected(rule, item, checked)"
                />
                <span class="dt-tag" :class="historyStatusClass(item)">{{ historyStatusText(item) }}</span>
                <span class="dt-history-time">{{ historyTimeLabel(item) }}：{{ formatDateTime(item.scheduled_at || item.created_at) }}</span>
                <span class="dt-history-message">{{ item.message }}</span>
                <button type="button" class="dt-history-delete" title="删除" @click="deleteHistoryItem(rule, item)">×</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <el-dialog
        v-model="recipientDialogVisible"
        width="860px"
        :close-on-click-modal="false"
        class="dt-recipient-dialog"
      >
        <template #header>
          <div class="dt-recipient-dialog-head">
            <span>webhook配置通知对象</span>
            <div class="dt-recipient-switch">
              <span>@人功能</span>
              <el-switch v-model="recipientConfig.enabled" />
              <el-radio-group
                v-if="recipientConfig.enabled"
                v-model="recipientConfig.at_mode"
                size="small"
                class="dt-recipient-mode"
              >
                <el-radio-button label="people">仅@人</el-radio-button>
                <el-radio-button label="all">@所有人</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </template>

        <el-skeleton v-if="recipientStaffLoading" :rows="6" animated />
        <template v-else>
          <div class="dt-recipient-table-wrap">
            <table class="dt-recipient-table">
              <thead>
                <tr>
                  <th>选择</th>
                  <th>姓名</th>
                  <th>角色</th>
                  <th>手机号码</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="staff in recipientStaffList" :key="staff.id">
                  <td>
                    <el-checkbox
                      :model-value="isStaffRecipientChecked(staff)"
                      @change="checked => toggleStaffRecipient(staff, checked)"
                    />
                  </td>
                  <td>{{ staff.name }}</td>
                  <td>{{ ROLE_LABEL[staff.role] || staff.role || '' }}</td>
                  <td>{{ staff.phone || '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="dt-extra-recipient-head">
            <span>其他接收人</span>
            <el-button size="small" plain :icon="Plus" @click="addExtraRecipient">添加</el-button>
          </div>
          <div v-if="recipientConfig.extra.length === 0" class="dt-extra-recipient-empty">
            暂无其他接收人
          </div>
          <div v-for="(item, index) in recipientConfig.extra" :key="item.id" class="dt-extra-recipient-row">
            <el-checkbox
              :model-value="item.selected"
              @change="checked => toggleExtraRecipient(item, checked)"
            />
            <el-input v-model="item.name" placeholder="姓名" @input="autoCheckExtraRecipient(item)" />
            <el-input v-model="item.role" placeholder="角色" @input="autoCheckExtraRecipient(item)" />
            <el-input v-model="item.phone" placeholder="手机号码" @input="autoCheckExtraRecipient(item)" />
            <el-button type="danger" plain @click="removeExtraRecipient(index)">删除</el-button>
          </div>
        </template>

        <template #footer>
          <el-button @click="recipientDialogVisible = false">退出</el-button>
          <el-button type="primary" :loading="recipientSaving" @click="saveRecipients">保存编辑</el-button>
        </template>
      </el-dialog>

      <section class="dt-settings-section">
        <div class="dt-settings-section-head">
          <div>
            <h3>数据备份下载</h3>
            <p>按周期维度下载需求工时统计下的全部数据，单文件保存。</p>
          </div>
          <div class="dt-settings-backup-actions">
            <el-radio-group v-model="backupFormat">
              <el-radio-button label="xlsx">Excel</el-radio-button>
              <el-radio-button label="md">Markdown</el-radio-button>
            </el-radio-group>
            <el-button
              type="primary"
              :icon="Download"
              :loading="downloading"
              :disabled="!canDownloadBackup"
              @click="downloadBackup"
            >
              下载全部数据
            </el-button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dt-settings-section {
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-1);
}

.dt-settings-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.dt-settings-section-head h3 {
  font-size: 17px;
  font-weight: 600;
  color: var(--color-text-1);
  margin-bottom: 4px;
}

.dt-settings-section-head p {
  font-size: 13px;
  color: var(--color-text-3);
}

.dt-settings-rule {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 10px;
  background: var(--color-bg-3);
}

.dt-rule-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  white-space: nowrap;
  width: 100%;
}

.dt-rule-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
  flex: 0 0 auto;
}

.dt-inline-label,
.dt-settings-switch-label {
  font-size: 13px;
  color: var(--color-text-2);
  white-space: nowrap;
}

.dt-rule-type { flex: 1 1 160px; min-width: 150px; }
.dt-rule-year { flex: 0 0 116px; }
.dt-rule-days { flex: 2 1 220px; min-width: 190px; }
.dt-rule-weekdays { flex: 2 1 240px; min-width: 200px; }
.dt-rule-time { flex: 1 1 150px; min-width: 140px; }

.dt-rule-line :deep(.el-input__wrapper),
.dt-rule-line :deep(.el-select__wrapper),
.dt-rule-line :deep(.el-input-number),
.dt-rule-line :deep(.el-date-editor),
.dt-rule-line :deep(.el-button) {
  height: 36px;
  min-height: 36px;
}

.dt-rule-line :deep(.el-input),
.dt-rule-line :deep(.el-select),
.dt-rule-line :deep(.el-date-editor.el-input) {
  height: 36px;
}

.dt-rule-line :deep(.el-input__inner) {
  height: 34px;
  line-height: 34px;
}

.dt-rule-time :deep(.el-input__wrapper) {
  align-items: center;
}

.dt-rule-line :deep(.el-button) {
  padding-left: 18px;
  padding-right: 18px;
}

.dt-switch-large {
  --el-switch-on-color: var(--color-primary);
  --el-switch-off-color: #C9CDD4;
  transform: scale(1.12);
  transform-origin: center;
}

.dt-settings-notify-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-light);
  min-height: 28px;
}

.dt-next-run {
  font-size: 12px;
  color: var(--color-primary);
  background: var(--color-primary-light);
  padding: 3px 8px;
  border-radius: 999px;
}

.dt-notify-preview {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--color-text-3);
  cursor: default;
}

.dt-settings-notify-fields {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(280px, 1.4fr) auto;
  gap: 10px;
  align-items: flex-start;
  margin-top: 8px;
}

.dt-webhook-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dt-webhook-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.45fr) minmax(220px, 1fr) 32px 32px;
  gap: 6px;
}

.dt-notify-actions,
.dt-settings-backup-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dt-notify-actions {
  justify-content: flex-end;
}

.dt-settings-history {
  margin-top: 8px;
}

.dt-history-summary,
.dt-history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--color-bg-white);
  color: var(--color-text-2);
  font-size: 13px;
}

.dt-history-panel {
  margin-top: 6px;
  padding: 8px;
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
  background: var(--color-bg-white);
}

.dt-history-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.dt-history-item {
  padding: 7px 4px;
  border-radius: 4px;
  background: transparent;
}

.dt-history-item + .dt-history-item {
  border-top: 1px solid var(--color-border-light);
}

.dt-history-toggle,
.dt-history-delete {
  border: 0;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 13px;
  padding: 0;
  white-space: nowrap;
}

.dt-history-delete {
  margin-left: auto;
  color: var(--color-danger);
  font-size: 18px;
  line-height: 1;
}

.dt-history-time {
  white-space: nowrap;
}

.dt-history-message {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dt-recipient-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-1);
}

.dt-recipient-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-2);
}

.dt-recipient-mode {
  margin-left: 4px;
}

.dt-recipient-table-wrap {
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
}

.dt-recipient-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.dt-recipient-table th,
.dt-recipient-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-light);
  text-align: left;
  color: var(--color-text-2);
}

.dt-recipient-table th {
  background: var(--color-bg-3);
  color: var(--color-text-1);
  font-weight: 600;
}

.dt-extra-recipient-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
}

.dt-extra-recipient-empty {
  padding: 12px;
  border: 1px dashed var(--color-border-light);
  border-radius: 6px;
  color: var(--color-text-3);
  font-size: 13px;
}

.dt-extra-recipient-row {
  display: grid;
  grid-template-columns: 34px minmax(120px, 1fr) minmax(120px, 1fr) minmax(160px, 1fr) 70px;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

@media (max-width: 1200px) {
  .dt-rule-line {
    flex-wrap: wrap;
    white-space: normal;
  }
}

@media (max-width: 900px) {
  .dt-settings-section-head,
  .dt-settings-backup-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .dt-settings-notify-row {
    flex-wrap: wrap;
  }

  .dt-settings-notify-fields {
    grid-template-columns: 1fr;
  }

  .dt-webhook-row {
    grid-template-columns: 1fr;
  }

  .dt-history-summary,
  .dt-history-item {
    flex-wrap: wrap;
  }

  .dt-extra-recipient-row {
    grid-template-columns: 1fr;
  }

  .dt-notify-actions {
    justify-content: flex-start;
  }
}
</style>
