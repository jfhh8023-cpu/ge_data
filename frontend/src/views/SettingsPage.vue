<script setup>
/**
 * SettingsPage.vue — v3.1.0 设置中心
 * 自动执行任务并通知 + 需求工时统计全量备份下载
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
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
const taskTypeDialogVisible = ref(false)
const staffList = ref([])
const staffLoading = ref(false)
const dutyDetailDialogVisible = ref(false)
const dutyBulkDialogVisible = ref(false)
const dutyDetailRule = ref(null)
const dutyDetailRuleIndex = ref(-1)
const dutyDetailKey = ref('')
const dutyDetailMode = ref('weekly')
const dutyDetailForm = ref(createDefaultDutyItem())
const dutyReferenceKey = ref('')
const dutyBulkRule = ref(null)
const dutyBulkRuleIndex = ref(-1)
const dutyBulkForm = ref({
  scope: 'all',
  apply_mode: 'content',
  source_key: '',
  staff_ids: [],
  start_time: '09:00:00',
  end_time: '18:30:00',
  send_mode: 'start_and_end',
  start_message: '请关注线上告警和待处理反馈。',
  end_message: '请同步今日值班处理结果。'
})
const backupFormat = ref('xlsx')
const nowTs = ref(Date.now())
let countdownTimer = null
let dueRefreshRunning = false
let lastDueRefreshAt = 0

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
const actionModeOptions = [
  { value: 'run_and_notify', label: '执行规则并通知' },
  { value: 'run_only', label: '仅执行规则' },
  { value: 'notify_only', label: '仅通知' }
]
const TASK_TYPE_CREATE_NOTIFY = 'task_create_notify'
const TASK_TYPE_DUTY_NOTIFY = 'duty_notify'
const DUTY_SEND_MODE_START = 'start_only'
const DUTY_SEND_MODE_BOTH = 'start_and_end'
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

function pad2(value) {
  return String(value).padStart(2, '0')
}

function currentTimeString() {
  const now = new Date()
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
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

function createDefaultDutyItem() {
  return {
    enabled: false,
    staff_ids: [],
    start_time: '09:00:00',
    end_time: '18:30:00',
    send_mode: DUTY_SEND_MODE_START,
    start_message: '请关注线上告警和待处理反馈。',
    end_message: '请同步今日值班处理结果。'
  }
}

function createDefaultDutyConfig() {
  return {
    weekly: {},
    monthly: {}
  }
}

function createDefaultRule(taskType = TASK_TYPE_CREATE_NOTIFY) {
  const isDuty = taskType === TASK_TYPE_DUTY_NOTIFY
  return {
    localKey: `new_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    id: '',
    name: isDuty ? '自动值班通知' : '自动生成下一周任务',
    enabled: true,
    task_type: taskType,
    action_mode: isDuty ? 'notify_only' : 'run_and_notify',
    schedule_type: 'weekly',
    schedule_year: CURRENT_YEAR,
    month_days: isDuty ? monthDayOptions : [1],
    week_days: isDuty ? weekDayOptions.map(item => item.value) : [1],
    execute_time: '09:00:00',
    notify_enabled: true,
    dingtalk_webhooks: [createDefaultWebhook()],
    dingtalk_message: '',
    dingtalk_recipients: createDefaultRecipientConfig(),
    duty_config: createDefaultDutyConfig(),
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

function normalizeActionMode(value) {
  return actionModeOptions.some(item => item.value === value) ? value : 'run_and_notify'
}

function normalizeTaskType(value) {
  return value === TASK_TYPE_DUTY_NOTIFY ? TASK_TYPE_DUTY_NOTIFY : TASK_TYPE_CREATE_NOTIFY
}

function isDutyRule(rule) {
  return normalizeTaskType(rule?.task_type) === TASK_TYPE_DUTY_NOTIFY
}

function isRunOnly(rule) {
  return normalizeActionMode(rule?.action_mode) === 'run_only'
}

function isNotifyOnly(rule) {
  return normalizeActionMode(rule?.action_mode) === 'notify_only'
}

function applyActionMode(rule) {
  if (isDutyRule(rule)) {
    rule.action_mode = 'notify_only'
    rule.notify_enabled = true
    return rule
  }
  rule.action_mode = normalizeActionMode(rule.action_mode)
  if (isRunOnly(rule)) {
    rule.notify_enabled = false
  } else if (isNotifyOnly(rule)) {
    rule.notify_enabled = true
  }
  return rule
}

function handleActionModeChange(rule) {
  applyActionMode(rule)
}

function notifySwitchTooltip(rule) {
  if (isRunOnly(rule)) return '当前任务仅新增任务，已禁止开放通知'
  if (isNotifyOnly(rule)) return '当前任务仅通知，已禁止生成任务'
  return ''
}

function isNotifySwitchDisabled(rule) {
  return !canEditAutoTasks.value || isRunOnly(rule) || isNotifyOnly(rule)
}

function testRunTooltip(rule) {
  if (isDutyRule(rule)) return '自动值班通知仅发送 webhook，不生成任务'
  if (isNotifyOnly(rule)) return '当前任务仅通知，已禁止生成任务'
  if (!rule.id) return '请先保存规则后再测试执行'
  return '立即测试执行一次任务和通知，不修改自动触发规则'
}

function isTestRunDisabled(rule) {
  return !canEditAutoTasks.value || !rule.id || isNotifyOnly(rule) || isDutyRule(rule)
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

function normalizeTime(value, fallback = '09:00:00') {
  const text = String(value || '').trim()
  if (/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(text)) return text
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return `${text}:00`
  return fallback
}

function normalizeDutyItem(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const staffIds = Array.isArray(source.staff_ids) ? source.staff_ids : []
  return {
    enabled: source.enabled === true,
    staff_ids: [...new Set(staffIds.map(id => String(id || '').trim()).filter(Boolean))],
    start_time: normalizeTime(source.start_time, '09:00:00'),
    end_time: normalizeTime(source.end_time, '18:30:00'),
    send_mode: source.send_mode === DUTY_SEND_MODE_BOTH ? DUTY_SEND_MODE_BOTH : DUTY_SEND_MODE_START,
    start_message: String(source.start_message || ''),
    end_message: String(source.end_message || '')
  }
}

function normalizeDutyDayMap(value, min, max) {
  const result = {}
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  Object.entries(source).forEach(([key, item]) => {
    const day = Number(key)
    if (Number.isInteger(day) && day >= min && day <= max) {
      result[String(day)] = normalizeDutyItem(item)
    }
  })
  return result
}

function normalizeDutyConfig(value) {
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
    weekly: normalizeDutyDayMap(source.weekly, 1, 7),
    monthly: normalizeDutyDayMap(source.monthly, 1, 31)
  }
}

function dutyItemConfigured(item) {
  return Boolean(
    item?.enabled &&
    item.staff_ids?.length &&
    String(item.start_message || '').trim()
  )
}

function dutyMapForRule(rule) {
  const config = normalizeDutyConfig(rule.duty_config)
  return rule.schedule_type === 'monthly' ? config.monthly : config.weekly
}

function notificationKey(rule) {
  return JSON.stringify({
    webhooks: compactWebhooks(rule),
    message: String(rule.dingtalk_message || '').trim(),
    recipients: normalizeRecipientConfig(rule.dingtalk_recipients),
    duty: normalizeDutyConfig(rule.duty_config)
  })
}

function normalizeRule(rule) {
  const normalized = {
    ...createDefaultRule(),
    ...rule,
    month_days: Array.isArray(rule.month_days) ? rule.month_days : [],
    week_days: Array.isArray(rule.week_days) ? rule.week_days : [],
    dingtalk_webhooks: normalizeWebhookConfigs(rule.dingtalk_webhooks || rule.dingtalk_webhook),
    dingtalk_recipients: normalizeRecipientConfig(rule.dingtalk_recipients),
    duty_config: normalizeDutyConfig(rule.duty_config),
    task_type: normalizeTaskType(rule.task_type)
  }
  applyActionMode(normalized)
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

async function loadSettings(options = {}) {
  const silent = options.silent === true
  if (!silent) loading.value = true
  try {
    const res = await api.get('/settings/auto-tasks')
    const data = res.data || {}
    rules.value = sortRules((data.rules || []).map(normalizeRule))
    logs.value = data.logs || []
    messages.value = data.messages || []
  } finally {
    if (!silent) loading.value = false
  }
}

async function ensureStaffList() {
  if (staffList.value.length || staffLoading.value) return
  staffLoading.value = true
  try {
    const res = await api.get('/staff')
    staffList.value = res.data || []
  } catch {
    ElMessage.error('加载团队人员失败')
  } finally {
    staffLoading.value = false
  }
}

function addRule() {
  taskTypeDialogVisible.value = true
}

function addRuleByType(taskType) {
  rules.value.push(createDefaultRule(taskType))
  taskTypeDialogVisible.value = false
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
  const message = isDutyRule(rule) ? dutyFirstMessage(rule) : String(rule.dingtalk_message || '').trim()
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

function dutyFirstMessage(rule) {
  const dayMap = dutyMapForRule(rule)
  const item = Object.values(dayMap).find(dutyItemConfigured)
  return String(item?.start_message || '').trim()
}

function hasConfiguredDutyItem(rule) {
  return Object.values(dutyMapForRule(rule)).some(dutyItemConfigured)
}

function validateRule(rule, options = {}) {
  applyActionMode(rule)
  if (!rule.name?.trim()) {
    warnRule(rule, '请输入规则名称')
    return false
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(rule.execute_time || '')) {
    warnRule(rule, '执行时间格式必须为 HH:mm:ss')
    return false
  }
  if (isDutyRule(rule)) {
    if (!hasConfiguredDutyItem(rule)) {
      warnRule(rule, '请至少配置一个值班日期/星期的人员和开始提醒内容')
      return false
    }
    if (!validateWebhooks(rule, options.requireNotification ?? true)) return false
    return true
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
  applyActionMode(rule)
  const dutyConfig = normalizeDutyConfig(rule.duty_config)
  return {
    name: rule.name.trim(),
    enabled: !!rule.enabled,
    task_type: normalizeTaskType(rule.task_type),
    action_mode: normalizeActionMode(rule.action_mode),
    schedule_type: rule.schedule_type,
    schedule_year: rule.schedule_type === 'monthly' ? Number(rule.schedule_year) : null,
    month_days: rule.schedule_type === 'monthly' ? rule.month_days : [],
    week_days: rule.schedule_type === 'weekly' ? rule.week_days : [],
    execute_time: rule.execute_time,
    notify_enabled: !!rule.notify_enabled,
    dingtalk_webhooks: compactWebhooks(rule),
    dingtalk_message: rule.dingtalk_message || '',
    dingtalk_recipients: normalizeRecipientConfig(rule.dingtalk_recipients),
    duty_config: dutyConfig
  }
}

async function persistRule(rule, index, options = {}, successMessage = '编辑成功', errorMessage = '编辑失败') {
  if (!validateRule(rule, options)) return
  savingId.value = rule.id || rule.localKey
  try {
    const payload = buildPayload(rule)
    const res = rule.id
      ? await api.put(`/settings/auto-tasks/${rule.id}`, payload)
      : await api.post('/settings/auto-tasks', payload)
    rules.value[index] = normalizeRule(res.data)
    ElMessage.success(successMessage)
    await loadSettings()
    return true
  } catch {
    ElMessage.error(errorMessage)
    return false
  } finally {
    savingId.value = ''
  }
}

async function saveRule(rule, index, options = {}) {
  await persistRule(rule, index, options)
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
    const dutyItem = isDutyRule(rule) ? firstConfiguredDutyItem(rule) : null
    await api.post('/settings/auto-tasks/test-notify', {
      rule_id: rule.id,
      task_type: normalizeTaskType(rule.task_type),
      dingtalk_webhooks: compactWebhooks(rule),
      dingtalk_message: isDutyRule(rule) ? dutyItem.start_message : (rule.dingtalk_message || ''),
      dingtalk_recipients: isDutyRule(rule)
        ? { enabled: true, at_mode: 'people', staff_ids: normalizeDutyStaffIds(dutyItem.staff_ids), extra: [] }
        : normalizeRecipientConfig(rule.dingtalk_recipients)
    })
    ElMessage.success('测试发送成功')
    await loadSettings()
  } catch (err) {
    ElMessage.error(err.response?.data?.message || err.response?.data?.detail || '测试发送失败')
  } finally {
    testingId.value = ''
  }
}

function firstConfiguredDutyItem(rule) {
  const item = Object.values(dutyMapForRule(rule)).find(dutyItemConfigured)
  if (!item) {
    const err = new Error('请至少配置一个值班日期/星期的人员和开始提醒内容')
    err.userMessage = err.message
    throw err
  }
  return item
}

async function testRunRule(rule) {
  if (isNotifyOnly(rule)) {
    ElMessage.warning('当前任务仅通知，已禁止生成任务')
    return
  }
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
  } catch (err) {
    ElMessage.error(err.response?.data?.message || err.response?.data?.detail || '测试执行失败')
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

function taskTypeTitle(rule) {
  return isDutyRule(rule) ? '自动值班通知' : '自动任务创建并通知'
}

function dutyKeys(rule) {
  return rule.schedule_type === 'monthly'
    ? monthDayOptions.map(day => String(day))
    : weekDayOptions.map(day => String(day.value))
}

function dutyKeyLabel(rule, key) {
  if (rule.schedule_type === 'monthly') return `${key}日`
  return weekDayOptions.find(day => String(day.value) === String(key))?.label || `周${key}`
}

function getDutyItem(rule, key) {
  const config = normalizeDutyConfig(rule.duty_config)
  const map = rule.schedule_type === 'monthly' ? config.monthly : config.weekly
  return normalizeDutyItem(map[String(key)] || createDefaultDutyItem())
}

function setDutyItem(rule, key, item) {
  const config = normalizeDutyConfig(rule.duty_config)
  const target = rule.schedule_type === 'monthly' ? config.monthly : config.weekly
  target[String(key)] = normalizeDutyItem(item)
  rule.duty_config = config
}

function syncDutyRuleScheduleKeys(rule) {
  const configuredKeys = dutyKeys(rule).filter(key => dutyItemConfigured(getDutyItem(rule, key))).map(Number)
  if (rule.schedule_type === 'monthly') {
    rule.month_days = configuredKeys
  } else {
    rule.week_days = configuredKeys
  }
}

function dutyReferenceOptions(rule, excludeKey = '') {
  if (!rule) return []
  return dutyKeys(rule)
    .filter(key => String(key) !== String(excludeKey))
    .map(key => ({
      value: String(key),
      label: `${dutyKeyLabel(rule, key)}${dutyItemConfigured(getDutyItem(rule, key)) ? '（已配置）' : '（未配置）'}`
    }))
}

function staffById(id) {
  const key = String(id || '').trim()
  if (!key) return null
  return staffList.value.find(staff => String(staff.id) === key)
    || staffList.value.find(staff => String(staff.phone || '').trim() === key)
    || staffList.value.find(staff => String(staff.name || '').trim() === key)
    || null
}

function staffDisplayName(staff) {
  if (!staff) return ''
  const name = String(staff.name || '').trim()
  const phone = String(staff.phone || '').trim()
  if (name && name !== phone && !isValidPhone(name)) return name
  const samePhone = phone
    ? staffList.value.find(item =>
      String(item.phone || '').trim() === phone &&
      String(item.name || '').trim() &&
      !isValidPhone(item.name)
    )
    : null
  return samePhone ? samePhone.name : (name || phone || '未命名')
}

function hasDutyStaffName(staff) {
  const name = String(staff?.name || '').trim()
  if (name && !isValidPhone(name)) return true
  const displayName = staffDisplayName(staff)
  return Boolean(displayName && displayName !== '未命名' && !isValidPhone(displayName))
}

function canSelectDutyStaff(staff) {
  return Boolean(hasDutyStaffName(staff) && isValidPhone(staff?.phone))
}

function dutyStaffUnavailableReason(staff) {
  const hasName = hasDutyStaffName(staff)
  const hasPhone = isValidPhone(staff?.phone)
  if (!hasName && !hasPhone) return '姓名和手机号码为空，请在【团队人员】页面添加后再试'
  if (!hasName) return '姓名为空，请在【团队人员】页面添加后再试'
  if (!hasPhone) return '手机号码为空，请在【团队人员】页面添加后再试'
  return ''
}

function normalizeDutyStaffIds(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map(id => staffById(id)?.id || String(id || '').trim())
    .filter(Boolean))]
}

function staffNames(ids = []) {
  const names = ids
    .map(id => {
      const staff = staffById(id)
      return staff ? staffDisplayName(staff) : String(id || '').trim()
    })
    .filter(Boolean)
  return names.length ? names.join('、') : '未配置'
}

function dutyPeopleText(item) {
  return item.staff_ids?.length ? staffNames(item.staff_ids) : '未配置'
}

function dutyTimeText(item) {
  if (!item.enabled) return '--'
  return item.send_mode === DUTY_SEND_MODE_BOTH
    ? `${item.start_time.slice(0, 5)} / ${item.end_time.slice(0, 5)}`
    : item.start_time.slice(0, 5)
}

function dutyStatusText(item) {
  return dutyItemConfigured(item) ? '已配置' : '跳过'
}

function dutyItemHasStartPreview(item) {
  return Boolean(item?.enabled && item.staff_ids?.length && String(item.start_message || '').trim())
}

function dutyItemHasEndPreview(item) {
  return Boolean(
    item?.enabled &&
    item.send_mode === DUTY_SEND_MODE_BOTH &&
    item.staff_ids?.length &&
    String(item.end_message || '').trim()
  )
}

function localDateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addLocalDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function localWeekdayNumber(date) {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

function localDateAtTime(date, time) {
  const [hours, minutes, seconds] = normalizeTime(time).split(':').map(Number)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, seconds, 0)
}

function dutyKeyForDate(rule, date) {
  return rule.schedule_type === 'monthly'
    ? String(date.getDate())
    : String(localWeekdayNumber(date))
}

function canUseDutyDate(rule, date) {
  return rule.schedule_type !== 'monthly' ||
    !rule.schedule_year ||
    Number(rule.schedule_year) === date.getFullYear()
}

function dutyPreviewEvents(item, date) {
  const events = []
  if (dutyItemHasStartPreview(item)) {
    events.push(localDateAtTime(date, item.start_time))
  }
  if (dutyItemHasEndPreview(item)) {
    events.push(localDateAtTime(date, item.end_time))
  }
  return events
}

function dutyPreviewEntries(item, date) {
  const entries = []
  if (dutyItemHasStartPreview(item)) {
    entries.push({
      kind: 'start',
      label: '开始',
      time: item.start_time,
      message: item.start_message,
      scheduledAt: localDateAtTime(date, item.start_time)
    })
  }
  if (dutyItemHasEndPreview(item)) {
    entries.push({
      kind: 'end',
      label: '结束',
      time: item.end_time,
      message: item.end_message,
      scheduledAt: localDateAtTime(date, item.end_time)
    })
  }
  return entries
}

function findNextDutyPreview(rule) {
  const now = new Date(nowTs.value)
  const today = localDateOnly(now)
  for (let offset = 0; offset <= 400; offset += 1) {
    const date = addLocalDays(today, offset)
    if (!canUseDutyDate(rule, date)) continue
    const key = dutyKeyForDate(rule, date)
    const item = getDutyItem(rule, key)
    if (!item.enabled) continue
    const nextEvent = dutyPreviewEvents(item, date)
      .filter(runAt => runAt.getTime() > now.getTime())
      .sort((a, b) => a.getTime() - b.getTime())[0]
    if (nextEvent) return { key, item }
  }
  return null
}

function findNextDutyPreviewEntry(rule) {
  const now = new Date(nowTs.value)
  const today = localDateOnly(now)
  for (let offset = 0; offset <= 400; offset += 1) {
    const date = addLocalDays(today, offset)
    if (!canUseDutyDate(rule, date)) continue
    const key = dutyKeyForDate(rule, date)
    const item = getDutyItem(rule, key)
    if (!item.enabled) continue
    const event = dutyPreviewEntries(item, date)
      .filter(entry => entry.scheduledAt.getTime() > now.getTime())
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0]
    if (event) return { key, item, date, event }
  }
  return null
}

function dutyDateFromKey(rule, key) {
  const now = new Date(nowTs.value)
  if (rule.schedule_type === 'monthly') {
    const year = Number(rule.schedule_year) || now.getFullYear()
    return new Date(year, now.getMonth(), Number(key))
  }
  const diff = Number(key) - localWeekdayNumber(now)
  return addLocalDays(localDateOnly(now), diff)
}

function isDutyCurrentKey(rule, key) {
  const now = new Date(nowTs.value)
  if (rule.schedule_type === 'monthly') {
    if (rule.schedule_year && Number(rule.schedule_year) !== now.getFullYear()) return false
    return String(key) === String(now.getDate())
  }
  return String(key) === String(localWeekdayNumber(now))
}

function dutyPreviewLines(rule) {
  const next = findNextDutyPreviewEntry(rule)
  const key = next?.key || dutyKeys(rule).find(itemKey => dutyItemConfigured(getDutyItem(rule, itemKey)))
  if (!key) return []
  const item = next?.item || getDutyItem(rule, key)
  const date = next?.date || dutyDateFromKey(rule, key)
  return dutyPreviewEntries(item, date).map(entry => {
    const isPending = entry.scheduledAt.getTime() > nowTs.value
    const isNext = Boolean(
      next &&
      String(next.key) === String(key) &&
      next.event.kind === entry.kind &&
      next.event.scheduledAt.getTime() === entry.scheduledAt.getTime()
    )
    return {
      id: `${key}-${entry.kind}`,
      text: `${dutyKeyLabel(rule, key)} ${entry.label} ${entry.time.slice(0, 5)} ${staffNames(item.staff_ids)} ${entry.message}`,
      status: isPending ? 'pending' : 'done',
      statusText: isPending ? '待通知' : '已通知',
      isNext
    }
  })
}

function formatDutyPreview(rule, key, item) {
  const label = dutyKeyLabel(rule, key)
  const people = staffNames(item.staff_ids)
  const lines = []
  if (dutyItemHasStartPreview(item)) {
    lines.push(`${label} 开始 ${item.start_time.slice(0, 5)} ${people} ${item.start_message}`)
  }
  if (dutyItemHasEndPreview(item)) {
    lines.push(`${label} 结束 ${item.end_time.slice(0, 5)} ${people} ${item.end_message}`)
  }
  return lines.join('\n')
}

function dutyPreviewText(rule) {
  const next = findNextDutyPreview(rule)
  if (next) return formatDutyPreview(rule, next.key, next.item)
  const key = dutyKeys(rule).find(itemKey => dutyItemConfigured(getDutyItem(rule, itemKey)))
  if (!key) return '尚未配置值班通知内容'
  const item = getDutyItem(rule, key)
  return formatDutyPreview(rule, key, item)
}

async function openDutyDetail(rule, index, key) {
  await ensureStaffList()
  dutyDetailRule.value = rule
  dutyDetailRuleIndex.value = index
  dutyDetailKey.value = String(key)
  dutyDetailMode.value = rule.schedule_type
  dutyDetailForm.value = getDutyItem(rule, key)
  dutyReferenceKey.value = dutyReferenceOptions(rule, key).find(option => option.label.includes('已配置'))?.value || ''
  dutyDetailDialogVisible.value = true
}

function closeDutyDetail() {
  dutyDetailDialogVisible.value = false
  dutyDetailRule.value = null
  dutyDetailRuleIndex.value = -1
  dutyDetailKey.value = ''
  dutyReferenceKey.value = ''
}

function isDutyStaffChecked(staff) {
  const ids = dutyDetailForm.value.staff_ids.map(id => String(id))
  return canSelectDutyStaff(staff) && (ids.includes(String(staff.id)) || Boolean(staff.phone && ids.includes(String(staff.phone).trim())))
}

function toggleDutyStaff(staff, checked) {
  if (checked && !canSelectDutyStaff(staff)) {
    ElMessage.warning(dutyStaffUnavailableReason(staff))
    return
  }
  const current = dutyDetailForm.value.staff_ids
  const phone = String(staff.phone || '').trim()
  dutyDetailForm.value.staff_ids = checked
    ? [...new Set([...current, staff.id])]
    : current.filter(id => id !== staff.id && String(id) !== phone)
}

function applyDutyReference() {
  const rule = dutyDetailRule.value
  if (!rule || !dutyReferenceKey.value) {
    ElMessage.warning('请选择要引用的配置')
    return
  }
  dutyDetailForm.value = getDutyItem(rule, dutyReferenceKey.value)
  ElMessage.success(`已引用${dutyKeyLabel(rule, dutyReferenceKey.value)}配置`)
}

async function saveDutyDetail() {
  const rule = dutyDetailRule.value
  if (!rule || !dutyDetailKey.value) return
  const staffIds = normalizeDutyStaffIds(dutyDetailForm.value.staff_ids)
    .filter(id => canSelectDutyStaff(staffById(id)))
  const item = normalizeDutyItem({
    ...dutyDetailForm.value,
    staff_ids: staffIds,
    enabled: staffIds.length > 0 && Boolean(dutyDetailForm.value.start_message?.trim())
  })
  setDutyItem(rule, dutyDetailKey.value, item)
  syncDutyRuleScheduleKeys(rule)
  if (rule.id && dutyDetailRuleIndex.value > -1) {
    const saved = await persistRule(
      rule,
      dutyDetailRuleIndex.value,
      { requireNotification: true },
      '值班配置已保存并生效'
    )
    if (!saved) return
  }
  closeDutyDetail()
  if (!rule.id) {
    ElMessage.success('值班配置已保存到当前规则，请点击保存通知提交')
  }
}

async function openDutyBulk(rule, index) {
  await ensureStaffList()
  const firstConfiguredKey = dutyKeys(rule).find(key => dutyItemConfigured(getDutyItem(rule, key))) || ''
  const seedItem = firstConfiguredKey ? getDutyItem(rule, firstConfiguredKey) : createDefaultDutyItem()
  dutyBulkRule.value = rule
  dutyBulkRuleIndex.value = index
  dutyBulkForm.value = {
    scope: 'all',
    apply_mode: 'content',
    source_key: firstConfiguredKey,
    staff_ids: [...seedItem.staff_ids],
    start_time: seedItem.start_time,
    end_time: seedItem.end_time,
    send_mode: DUTY_SEND_MODE_BOTH,
    start_message: seedItem.start_message || '请关注线上告警和待处理反馈。',
    end_message: seedItem.end_message || '请同步今日值班处理结果。'
  }
  dutyBulkDialogVisible.value = true
}

function dutyBulkTitle() {
  const unit = dutyBulkRule.value?.schedule_type === 'monthly' ? '日期' : '星期'
  return `批量编辑所有${unit}通知内容`
}

function dutyBulkScopeLabel(scope) {
  const unit = dutyBulkRule.value?.schedule_type === 'monthly' ? '日期' : '星期'
  if (scope === 'configured') return `仅已配置${unit}`
  return dutyBulkRule.value?.schedule_type === 'monthly' ? '全日期范畴' : '全星期范畴'
}

function dutyBulkReferencePreview() {
  const rule = dutyBulkRule.value
  if (!rule || !dutyBulkForm.value.source_key) return '请选择引用来源'
  const item = getDutyItem(rule, dutyBulkForm.value.source_key)
  return `${dutyKeyLabel(rule, dutyBulkForm.value.source_key)} ${dutyPeopleText(item)} ${dutyTimeText(item)} ${item.start_message || '未填写开始提醒'}`
}

function isDutyBulkStaffChecked(staff) {
  const ids = dutyBulkForm.value.staff_ids.map(id => String(id))
  return canSelectDutyStaff(staff) && (ids.includes(String(staff.id)) || Boolean(staff.phone && ids.includes(String(staff.phone).trim())))
}

function toggleDutyBulkStaff(staff, checked) {
  if (checked && !canSelectDutyStaff(staff)) {
    ElMessage.warning(dutyStaffUnavailableReason(staff))
    return
  }
  const current = dutyBulkForm.value.staff_ids
  const phone = String(staff.phone || '').trim()
  dutyBulkForm.value.staff_ids = checked
    ? [...new Set([...current, staff.id])]
    : current.filter(id => id !== staff.id && String(id) !== phone)
}

function dutyBulkPreview() {
  const names = staffNames(dutyBulkForm.value.staff_ids)
  const atText = dutyBulkForm.value.staff_ids.length ? `@${names.replaceAll('、', ' @')}` : '未选择接收人'
  const start = `开始 ${dutyBulkForm.value.start_time.slice(0, 5)}\n${atText} ${dutyBulkForm.value.start_message}`
  if (dutyBulkForm.value.send_mode !== DUTY_SEND_MODE_BOTH) return start
  return `${start}\n\n结束 ${dutyBulkForm.value.end_time.slice(0, 5)}\n${atText} ${dutyBulkForm.value.end_message}`
}

async function saveDutyBulkContent() {
  const rule = dutyBulkRule.value
  if (!rule) return
  if (dutyBulkForm.value.apply_mode === 'reference' && !dutyBulkForm.value.source_key) {
    ElMessage.warning('请选择引用来源')
    return
  }
  const staffIds = normalizeDutyStaffIds(dutyBulkForm.value.staff_ids)
    .filter(id => canSelectDutyStaff(staffById(id)))
  if (dutyBulkForm.value.apply_mode === 'content') {
    if (!staffIds.length) {
      ElMessage.warning('请选择值班对象')
      return
    }
    if (!String(dutyBulkForm.value.start_message || '').trim()) {
      ElMessage.warning('请填写今日值班开始提醒')
      return
    }
  }
  const targetKeys = dutyKeys(rule).filter(key => {
    if (dutyBulkForm.value.scope === 'configured') return dutyItemConfigured(getDutyItem(rule, key))
    return true
  })
  const sourceItem = dutyBulkForm.value.apply_mode === 'reference'
    ? getDutyItem(rule, dutyBulkForm.value.source_key)
    : null
  const bulkItem = sourceItem
    ? null
    : normalizeDutyItem({
      enabled: staffIds.length > 0 && Boolean(dutyBulkForm.value.start_message?.trim()),
      staff_ids: staffIds,
      start_time: dutyBulkForm.value.start_time,
      end_time: dutyBulkForm.value.end_time,
      send_mode: dutyBulkForm.value.send_mode,
      start_message: dutyBulkForm.value.start_message,
      end_message: dutyBulkForm.value.end_message
    })
  targetKeys.forEach(key => {
    if (sourceItem) {
      setDutyItem(rule, key, sourceItem)
    } else {
      setDutyItem(rule, key, bulkItem)
    }
  })
  syncDutyRuleScheduleKeys(rule)
  if (rule.id && dutyBulkRuleIndex.value > -1) {
    const saved = await persistRule(
      rule,
      dutyBulkRuleIndex.value,
      { requireNotification: true },
      '批量值班配置已保存并生效'
    )
    if (!saved) return
  }
  dutyBulkDialogVisible.value = false
  if (!rule.id) {
    ElMessage.success('批量配置已写入当前规则，请点击保存通知提交')
  }
}

function dutyDetailPreview() {
  const names = staffNames(dutyDetailForm.value.staff_ids)
  const atText = dutyDetailForm.value.staff_ids.length ? `@${names.replaceAll('、', ' @')}` : '未选择接收人'
  const start = `开始 ${dutyDetailForm.value.start_time.slice(0, 5)}\n${atText} ${dutyDetailForm.value.start_message}`
  if (dutyDetailForm.value.send_mode !== DUTY_SEND_MODE_BOTH) return start
  return `${start}\n\n结束 ${dutyDetailForm.value.end_time.slice(0, 5)}\n${atText} ${dutyDetailForm.value.end_message}`
}

function dutyDetailLabel() {
  return dutyKeyLabel(dutyDetailRule.value || { schedule_type: dutyDetailMode.value }, dutyDetailKey.value || '1')
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
    (isDutyRule(rule) ? hasConfiguredDutyItem(rule) : String(rule.dingtalk_message || '').trim()) &&
    notificationKey(rule) === rule._savedNotificationKey
  )
}

function notificationPreview(rule) {
  if (isDutyRule(rule)) {
    return dutyPreviewText(rule)
  }
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
  if (days > 0) return `${days}天${hours}时${minutes}分${seconds}秒`
  if (hours > 0) return `${hours}时${minutes}分${seconds}秒`
  return `${minutes}分${seconds}秒`
}

function hasExpiredNextRun() {
  return rules.value.some(rule => {
    if (!rule.enabled || !rule.next_run_at) return false
    const target = new Date(rule.next_run_at).getTime()
    return !Number.isNaN(target) && target <= nowTs.value
  })
}

async function refreshExpiredRuns() {
  const current = Date.now()
  if (dueRefreshRunning || current - lastDueRefreshAt < 3000) return
  dueRefreshRunning = true
  lastDueRefreshAt = current
  try {
    await loadSettings({ silent: true })
  } finally {
    dueRefreshRunning = false
  }
}

function handleCountdownTick() {
  nowTs.value = Date.now()
  if (hasExpiredNextRun()) {
    refreshExpiredRuns()
  }
}

function removeTimeNowButtons() {
  document.querySelectorAll('.dt-time-now-button').forEach(button => button.remove())
}

function injectTimeNowButton(assignTime) {
  const mountButton = () => {
    const footers = document.querySelectorAll('.dt-time-now-popper .el-time-panel__footer')
    footers.forEach(footer => {
      footer.querySelectorAll('.dt-time-now-button').forEach(button => button.remove())
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'el-time-panel__btn dt-time-now-button'
      button.textContent = '此刻'
      button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        assignTime(currentTimeString())
      })
      footer.insertBefore(button, footer.firstChild)
    })
  }
  nextTick(mountButton)
  window.setTimeout(mountButton, 0)
}

function handleTimePickerVisible(visible, assignTime) {
  if (visible) {
    injectTimeNowButton(assignTime)
  } else {
    window.setTimeout(removeTimeNowButtons, 0)
  }
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
  if (rules.value.some(isDutyRule)) await ensureStaffList()
  countdownTimer = setInterval(handleCountdownTick, 1000)
})

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer)
  removeTimeNowButtons()
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
            <span class="dt-rule-title" :class="{ 'is-duty': isDutyRule(rule) }">{{ taskTypeTitle(rule) }}</span>
            <el-select v-model="rule.schedule_type" class="dt-rule-type" size="small" :disabled="!canEditAutoTasks">
              <el-option label="每周星期" value="weekly" />
              <el-option label="年内每月日期" value="monthly" />
            </el-select>
            <el-input-number
              v-if="!isDutyRule(rule) && rule.schedule_type === 'monthly'"
              v-model="rule.schedule_year"
              class="dt-rule-year"
              size="small"
              :min="CURRENT_YEAR"
              :max="CURRENT_YEAR + 5"
              :disabled="!canEditAutoTasks"
            />
            <el-select
              v-if="!isDutyRule(rule) && rule.schedule_type === 'monthly'"
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
              v-if="!isDutyRule(rule) && rule.schedule_type === 'weekly'"
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
              v-if="!isDutyRule(rule)"
              v-model="rule.execute_time"
              class="dt-rule-time"
              size="small"
              value-format="HH:mm:ss"
              format="HH:mm:ss"
              popper-class="dt-time-now-popper"
              placeholder="HH:mm:ss"
              :disabled="!canEditAutoTasks"
              @visible-change="visible => handleTimePickerVisible(visible, value => { rule.execute_time = value })"
            />
            <el-select
              v-if="!isDutyRule(rule)"
              v-model="rule.action_mode"
              class="dt-rule-action-mode"
              size="small"
              :disabled="!canEditAutoTasks"
              @change="handleActionModeChange(rule)"
            >
              <el-option
                v-for="option in actionModeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
            <span class="dt-rule-actions-spacer"></span>
            <el-button
              size="small"
              type="primary"
              :loading="savingId === (rule.id || rule.localKey)"
              :disabled="!canEditAutoTasks"
              @click="saveRule(rule, index, { requireNotification: isDutyRule(rule) })"
            >
              {{ isDutyRule(rule) ? '保存通知' : '保存规则' }}
            </el-button>
            <el-tooltip v-if="!isDutyRule(rule)" :content="testRunTooltip(rule)" placement="top" :disabled="!isTestRunDisabled(rule)">
              <span class="dt-button-tooltip-wrap" :class="{ 'is-disabled': isTestRunDisabled(rule) }">
                <el-button
                  size="small"
                  plain
                  :loading="testingRunId === rule.id"
                  :disabled="isTestRunDisabled(rule)"
                  @click="testRunRule(rule)"
                >
                  测试执行
                </el-button>
              </span>
            </el-tooltip>
            <el-button
              v-if="isDutyRule(rule)"
              size="small"
              :icon="Promotion"
              :loading="testingId === (rule.id || rule.localKey)"
              :disabled="!canEditAutoTasks"
              @click="testNotification(rule)"
            >
              测试发送webhook
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

          <div v-if="!isDutyRule(rule)" class="dt-notify-submodule">
            <div class="dt-notify-connector" aria-hidden="true"></div>
            <div class="dt-notify-content">
              <div class="dt-settings-notify-row">
                <span class="dt-settings-switch-label">钉钉 webhook 通知</span>
                <template v-if="hasSavedNotification(rule)">
                  <span class="dt-next-run">下次通知：{{ nextCountdown(rule) }}</span>
                  <el-tooltip :content="rule.dingtalk_message" placement="top">
                    <span class="dt-notify-preview">内容：{{ notificationPreview(rule) }}</span>
                  </el-tooltip>
                </template>
              </div>

              <div class="dt-settings-notify-fields" :class="{ 'is-notify-off': !rule.notify_enabled }">
                <div v-if="rule.notify_enabled" class="dt-webhook-list">
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
                <div v-else class="dt-notify-disabled-hint">钉钉 webhook 通知已关闭</div>
                <el-input
                  v-if="rule.notify_enabled"
                  v-model="rule.dingtalk_message"
                  class="dt-notify-message"
                  type="textarea"
                  :rows="2"
                  placeholder="发送给所有钉钉 webhook 机器人的固定文本内容"
                  :disabled="!canEditAutoTasks"
                />
                <div class="dt-notify-actions">
                  <template v-if="rule.notify_enabled">
                    <el-button
                      size="small"
                      type="primary"
                      :loading="savingId === (rule.id || rule.localKey)"
                      :disabled="!canEditAutoTasks"
                      @click="saveRule(rule, index, { requireNotification: true })"
                    >
                      保存通知
                    </el-button>
                    <el-button
                      size="small"
                      plain
                      :disabled="!canEditAutoTasks || !rule.id"
                      @click="openRecipients(rule, index)"
                    >
                      配置接收人
                    </el-button>
                    <el-button
                      size="small"
                      :icon="Promotion"
                      :loading="testingId === (rule.id || rule.localKey)"
                      :disabled="!canEditAutoTasks"
                      @click="testNotification(rule)"
                    >
                      测试发送webhook
                    </el-button>
                  </template>
                  <el-tooltip :content="notifySwitchTooltip(rule)" placement="top" :disabled="!notifySwitchTooltip(rule)">
                    <span class="dt-switch-tooltip-wrap" :class="{ 'is-disabled': isNotifySwitchDisabled(rule) }">
                      <el-switch
                        v-model="rule.notify_enabled"
                        class="dt-switch-large"
                        size="large"
                        :disabled="isNotifySwitchDisabled(rule)"
                      />
                    </span>
                  </el-tooltip>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="dt-duty-submodule">
            <div class="dt-notify-connector" aria-hidden="true"></div>
            <div class="dt-notify-content">
              <div class="dt-settings-notify-row">
                <span class="dt-settings-switch-label">钉钉 webhook 通知</span>
                <span class="dt-next-run">下次通知：{{ nextCountdown(rule) }}</span>
                <el-tooltip :content="dutyPreviewText(rule)" placement="top">
                  <span class="dt-notify-preview is-duty-full">内容：{{ notificationPreview(rule) }}</span>
                </el-tooltip>
              </div>

              <div class="dt-duty-layout">
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

                <div class="dt-duty-card">
                  <div class="dt-duty-card-head">
                    <div>
                      <strong>{{ rule.schedule_type === 'monthly' ? '每月值班概览' : '每周值班概览' }}</strong>
                      <span>{{ rule.schedule_type === 'monthly' ? '1-31 日完整展示，点击日期配置提醒。' : '周一至周日完整展示，点击星期配置提醒。' }}</span>
                    </div>
                    <div class="dt-duty-card-actions">
                      <el-button
                        size="small"
                        plain
                        :disabled="!canEditAutoTasks"
                        @click="openDutyBulk(rule, index)"
                      >
                        批量编辑/引用
                      </el-button>
                    </div>
                  </div>

                  <div :class="rule.schedule_type === 'monthly' ? 'dt-duty-month-grid' : 'dt-duty-week-grid'">
                    <button
                      v-for="key in dutyKeys(rule)"
                      :key="key"
                      type="button"
                      class="dt-duty-cell"
                      :class="{
                        'is-configured': dutyItemConfigured(getDutyItem(rule, key)),
                        'is-current-duty': isDutyCurrentKey(rule, key)
                      }"
                      :disabled="!canEditAutoTasks"
                      @click="openDutyDetail(rule, index, key)"
                    >
                      <strong>{{ dutyKeyLabel(rule, key) }}</strong>
                      <div class="dt-duty-cell-info">
                        <span>{{ dutyPeopleText(getDutyItem(rule, key)) }}</span>
                        <em>{{ dutyTimeText(getDutyItem(rule, key)) }}</em>
                        <small>{{ dutyStatusText(getDutyItem(rule, key)) }}</small>
                      </div>
                    </button>
                  </div>

                  <div class="dt-duty-preview">
                    <strong>最近一次任务通知信息预览：</strong>
                    <div v-if="dutyPreviewLines(rule).length" class="dt-duty-preview-lines">
                      <div
                        v-for="line in dutyPreviewLines(rule)"
                        :key="line.id"
                        class="dt-duty-preview-line"
                        :class="{ 'is-next': line.isNext }"
                      >
                        <span class="dt-duty-preview-text">{{ line.text }}</span>
                        <span class="dt-duty-preview-status" :class="`is-${line.status}`">{{ line.statusText }}</span>
                      </div>
                    </div>
                    <span v-else class="dt-duty-preview-empty">尚未配置值班通知内容</span>
                  </div>
                </div>
              </div>
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
        v-model="taskTypeDialogVisible"
        title="请选择一个自动执行任务类型"
        width="560px"
        :close-on-click-modal="false"
      >
        <div class="dt-task-type-options">
          <button type="button" class="dt-task-type-card" @click="addRuleByType(TASK_TYPE_CREATE_NOTIFY)">
            <strong>1，自动任务创建并通知</strong>
            <span>沿用当前自动生成下一周任务和钉钉通知能力。</span>
          </button>
          <button type="button" class="dt-task-type-card is-duty" @click="addRuleByType(TASK_TYPE_DUTY_NOTIFY)">
            <strong>2，自动值班通知</strong>
            <span>按星期或每月日期配置值班人员、开始/结束提醒和 webhook 通知。</span>
          </button>
        </div>
      </el-dialog>

      <el-dialog
        v-model="dutyDetailDialogVisible"
        width="920px"
        :close-on-click-modal="false"
        class="dt-duty-dialog"
      >
        <template #header>
          <div class="dt-duty-dialog-title">
            {{ dutyDetailMode === 'monthly' ? '每月日期值班配置' : '每周星期值班配置' }} - {{ dutyDetailLabel() }}
          </div>
        </template>

        <div class="dt-duty-dialog-grid">
          <div class="dt-duty-dialog-card">
            <h4>值班对象</h4>
            <label class="dt-duty-field-label">团队人员</label>
            <div class="dt-duty-staff-grid" v-loading="staffLoading">
              <label
                v-for="staff in staffList"
                :key="staff.id"
                class="dt-duty-staff-item"
                :class="{ 'is-disabled': !canSelectDutyStaff(staff) }"
                :title="dutyStaffUnavailableReason(staff)"
              >
                <el-checkbox
                  :model-value="isDutyStaffChecked(staff)"
                  :disabled="!canSelectDutyStaff(staff)"
                  @change="checked => toggleDutyStaff(staff, checked)"
                />
                <span>{{ staffDisplayName(staff) }}</span>
              </label>
            </div>
            <p class="dt-duty-dialog-tip">勾选人员会在 webhook 消息中按手机号 @，姓名和手机号完整才可勾选。</p>
          </div>

          <div class="dt-duty-dialog-card">
            <h4>通知配置</h4>
            <div class="dt-duty-reference-row">
              <label class="dt-duty-field-label">引用配置</label>
              <div class="dt-duty-reference-controls">
                <el-select v-model="dutyReferenceKey" size="small" clearable placeholder="选择来源">
                  <el-option
                    v-for="option in dutyReferenceOptions(dutyDetailRule, dutyDetailKey)"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <el-button size="small" plain :disabled="!dutyReferenceKey" @click="applyDutyReference">
                  引用
                </el-button>
              </div>
            </div>
            <label class="dt-duty-field-label">发送策略</label>
            <el-radio-group v-model="dutyDetailForm.send_mode" size="small" class="dt-duty-send-mode">
              <el-radio-button :label="DUTY_SEND_MODE_START">只发送开始提醒</el-radio-button>
              <el-radio-button :label="DUTY_SEND_MODE_BOTH">开始和结束都发送</el-radio-button>
            </el-radio-group>

            <div class="dt-duty-time-row" :class="{ 'is-single': dutyDetailForm.send_mode !== DUTY_SEND_MODE_BOTH }">
              <div>
                <label class="dt-duty-field-label">值班开始时间</label>
                <el-time-picker
                  v-model="dutyDetailForm.start_time"
                  value-format="HH:mm:ss"
                  format="HH:mm:ss"
                  size="small"
                  popper-class="dt-time-now-popper"
                  placeholder="开始时间"
                  @visible-change="visible => handleTimePickerVisible(visible, value => { dutyDetailForm.start_time = value })"
                />
              </div>
              <div v-if="dutyDetailForm.send_mode === DUTY_SEND_MODE_BOTH">
                <label class="dt-duty-field-label">值班结束时间</label>
                <el-time-picker
                  v-model="dutyDetailForm.end_time"
                  value-format="HH:mm:ss"
                  format="HH:mm:ss"
                  size="small"
                  popper-class="dt-time-now-popper"
                  placeholder="结束时间"
                  @visible-change="visible => handleTimePickerVisible(visible, value => { dutyDetailForm.end_time = value })"
                />
              </div>
            </div>

            <label class="dt-duty-field-label">今日值班开始提醒：</label>
            <el-input
              v-model="dutyDetailForm.start_message"
              type="textarea"
              :rows="3"
              placeholder="这里填写的内容就是开始时间 webhook 实际发送内容"
            />
            <template v-if="dutyDetailForm.send_mode === DUTY_SEND_MODE_BOTH">
              <label class="dt-duty-field-label">今日值班结束提醒：</label>
              <el-input
                v-model="dutyDetailForm.end_message"
                type="textarea"
                :rows="3"
                placeholder="这里填写的内容就是结束时间 webhook 实际发送内容"
              />
            </template>

            <div class="dt-duty-dialog-preview">
              <strong>发送预览</strong>
              <pre>{{ dutyDetailPreview() }}</pre>
            </div>
          </div>
        </div>

        <template #footer>
          <el-button @click="closeDutyDetail">退出</el-button>
          <el-button type="primary" @click="saveDutyDetail">保存通知</el-button>
        </template>
      </el-dialog>

      <el-dialog
        v-model="dutyBulkDialogVisible"
        :title="dutyBulkTitle()"
        width="1080px"
        :close-on-click-modal="false"
      >
        <div class="dt-duty-dialog-grid is-bulk">
          <div class="dt-duty-dialog-card">
            <h4>应用范围</h4>
            <el-radio-group v-model="dutyBulkForm.scope" class="dt-duty-bulk-scope">
              <el-radio label="all">{{ dutyBulkScopeLabel('all') }}</el-radio>
              <el-radio label="configured">{{ dutyBulkScopeLabel('configured') }}</el-radio>
            </el-radio-group>
            <label class="dt-duty-field-label">批量方式</label>
            <el-radio-group v-model="dutyBulkForm.apply_mode" class="dt-duty-bulk-scope">
              <el-radio label="content">批量填写内容</el-radio>
              <el-radio label="reference">引用某一天配置</el-radio>
            </el-radio-group>
            <template v-if="dutyBulkForm.apply_mode === 'reference'">
              <label class="dt-duty-field-label">引用来源</label>
              <el-select v-model="dutyBulkForm.source_key" size="small" class="dt-duty-reference-select" placeholder="选择来源">
                <el-option
                  v-for="option in dutyReferenceOptions(dutyBulkRule)"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <div class="dt-duty-reference-preview">{{ dutyBulkReferencePreview() }}</div>
            </template>
            <template v-else>
              <label class="dt-duty-field-label">发送策略</label>
              <el-radio-group v-model="dutyBulkForm.send_mode" class="dt-duty-bulk-scope">
                <el-radio :label="DUTY_SEND_MODE_BOTH">开始和结束都发送</el-radio>
                <el-radio :label="DUTY_SEND_MODE_START">只发送开始提醒</el-radio>
              </el-radio-group>
            </template>
          </div>

          <div v-if="dutyBulkForm.apply_mode === 'content'" class="dt-duty-dialog-card">
            <h4>值班对象</h4>
            <label class="dt-duty-field-label">团队人员</label>
            <div class="dt-duty-staff-grid is-bulk" v-loading="staffLoading">
              <label
                v-for="staff in staffList"
                :key="staff.id"
                class="dt-duty-staff-item"
                :class="{ 'is-disabled': !canSelectDutyStaff(staff) }"
                :title="dutyStaffUnavailableReason(staff)"
              >
                <el-checkbox
                  :model-value="isDutyBulkStaffChecked(staff)"
                  :disabled="!canSelectDutyStaff(staff)"
                  @change="checked => toggleDutyBulkStaff(staff, checked)"
                />
                <span>{{ staffDisplayName(staff) }}</span>
              </label>
            </div>
            <p class="dt-duty-dialog-tip">勾选人员会在 webhook 消息中按手机号 @，姓名和手机号完整才可勾选。</p>
          </div>

          <div v-if="dutyBulkForm.apply_mode === 'content'" class="dt-duty-dialog-card">
            <h4>通知配置</h4>
            <div class="dt-duty-time-row" :class="{ 'is-single': dutyBulkForm.send_mode !== DUTY_SEND_MODE_BOTH }">
              <div>
                <label class="dt-duty-field-label">值班开始时间</label>
                <el-time-picker
                  v-model="dutyBulkForm.start_time"
                  value-format="HH:mm:ss"
                  format="HH:mm:ss"
                  size="small"
                  popper-class="dt-time-now-popper"
                  placeholder="开始时间"
                  @visible-change="visible => handleTimePickerVisible(visible, value => { dutyBulkForm.start_time = value })"
                />
              </div>
              <div v-if="dutyBulkForm.send_mode === DUTY_SEND_MODE_BOTH">
                <label class="dt-duty-field-label">值班结束时间</label>
                <el-time-picker
                  v-model="dutyBulkForm.end_time"
                  value-format="HH:mm:ss"
                  format="HH:mm:ss"
                  size="small"
                  popper-class="dt-time-now-popper"
                  placeholder="结束时间"
                  @visible-change="visible => handleTimePickerVisible(visible, value => { dutyBulkForm.end_time = value })"
                />
              </div>
            </div>

            <label class="dt-duty-field-label">今日值班开始提醒：</label>
            <el-input
              v-model="dutyBulkForm.start_message"
              type="textarea"
              :rows="3"
              placeholder="这里填写的内容就是开始时间 webhook 实际发送内容"
            />
            <template v-if="dutyBulkForm.send_mode === DUTY_SEND_MODE_BOTH">
              <label class="dt-duty-field-label">今日值班结束提醒：</label>
              <el-input
                v-model="dutyBulkForm.end_message"
                type="textarea"
                :rows="3"
                placeholder="这里填写的内容就是结束时间 webhook 实际发送内容"
              />
            </template>

            <div class="dt-duty-dialog-preview">
              <strong>发送预览</strong>
              <pre>{{ dutyBulkPreview() }}</pre>
            </div>
          </div>
        </div>
        <template #footer>
          <el-button @click="dutyBulkDialogVisible = false">退出</el-button>
          <el-button type="primary" @click="saveDutyBulkContent">保存批量内容</el-button>
        </template>
      </el-dialog>

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

.dt-rule-title {
  flex: 0 0 auto;
  min-width: 132px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-primary);
}

.dt-rule-title.is-duty {
  color: #b45309;
}

.dt-inline-label,
.dt-settings-switch-label {
  font-size: 13px;
  color: var(--color-text-2);
  white-space: nowrap;
}

.dt-rule-type { flex: 0 0 150px; min-width: 150px; }
.dt-rule-year { flex: 0 0 116px; }
.dt-rule-days { flex: 0 0 220px; min-width: 190px; }
.dt-rule-weekdays { flex: 0 0 96px; min-width: 96px; }
.dt-rule-time { flex: 0 0 116px; width: 116px !important; min-width: 116px; max-width: 116px; }
.dt-rule-action-mode { flex: 0 0 128px; min-width: 128px; }
.dt-rule-actions-spacer { flex: 1 1 auto; min-width: 12px; }

.dt-rule-time.el-date-editor.el-input {
  width: 116px !important;
  max-width: 116px;
}

.dt-rule-line :deep(.dt-rule-time.el-date-editor.el-input) {
  flex: 0 0 116px;
  width: 116px !important;
  min-width: 116px;
  max-width: 116px;
}

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

.dt-button-tooltip-wrap,
.dt-switch-tooltip-wrap {
  display: inline-flex;
  align-items: center;
}

.dt-button-tooltip-wrap.is-disabled,
.dt-switch-tooltip-wrap.is-disabled {
  cursor: not-allowed;
}

.dt-switch-large {
  --el-switch-on-color: var(--color-primary);
  --el-switch-off-color: #C9CDD4;
  transform: scale(1.12);
  transform-origin: center;
}

.dt-notify-submodule {
  position: relative;
  display: flex;
  gap: 8px;
  margin-top: 8px;
  margin-left: 32px;
}

.dt-notify-connector {
  position: relative;
  flex: 0 0 22px;
  align-self: stretch;
  min-height: 34px;
}

.dt-notify-connector::before {
  content: '';
  position: absolute;
  left: 10px;
  top: 0;
  bottom: 14px;
  width: 1px;
  background: var(--color-border);
}

.dt-notify-connector::after {
  content: '';
  position: absolute;
  left: 10px;
  top: 20px;
  width: 18px;
  height: 1px;
  background: var(--color-border);
}

.dt-notify-content {
  flex: 1 1 auto;
  min-width: 0;
}

.dt-settings-notify-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 0;
  padding-top: 0;
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

.dt-notify-preview.is-duty-full {
  max-width: none;
  overflow: visible;
  text-overflow: clip;
  white-space: pre-wrap;
  flex: 1 1 auto;
}

:global(.dt-time-now-popper .dt-time-now-button) {
  color: var(--color-primary);
  font-weight: 600;
  margin-right: 8px;
}

.dt-settings-notify-fields {
  display: grid;
  grid-template-columns: minmax(590px, 590px) minmax(280px, 1fr) auto;
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

.dt-notify-actions :deep(.el-button) {
  height: 24px;
  min-height: 24px;
  padding-left: 9px;
  padding-right: 9px;
  font-size: 12px;
}

.dt-notify-actions .dt-switch-large {
  transform: scale(0.75);
}

.dt-notify-actions .dt-switch-tooltip-wrap {
  height: 24px;
}

.dt-settings-notify-fields.is-notify-off .dt-notify-actions {
  grid-column: 3;
}

.dt-notify-disabled-hint {
  height: 30px;
  display: flex;
  align-items: center;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  padding: 0 12px;
  color: var(--color-text-3);
  font-size: 12px;
  background: var(--color-bg-white);
}

.dt-settings-history {
  margin-top: 8px;
}

.dt-duty-submodule {
  position: relative;
  display: flex;
  gap: 8px;
  margin-top: 8px;
  margin-left: 32px;
}

.dt-duty-layout {
  display: grid;
  grid-template-columns: minmax(590px, 590px) minmax(520px, 1fr);
  gap: 10px;
  margin-top: 8px;
  align-items: flex-start;
}

.dt-duty-card {
  border: 1px solid #fde7c4;
  border-radius: 8px;
  background: #fffaf2;
  padding: 6px;
}

.dt-duty-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}

.dt-duty-card-head strong {
  display: block;
  color: #9a5b00;
  font-size: 13px;
}

.dt-duty-card-head span {
  color: var(--color-text-3);
  font-size: 11px;
}

.dt-duty-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.dt-duty-week-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.dt-duty-month-grid {
  display: grid;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 3px;
}

.dt-duty-cell {
  position: relative;
  min-width: 0;
  height: 48px;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
  background: var(--color-bg-white);
  padding: 4px 6px;
  text-align: left;
  color: var(--color-text-2);
  cursor: pointer;
  overflow: visible;
}

.dt-duty-month-grid .dt-duty-cell {
  height: 26px;
  grid-template-columns: 1fr;
  gap: 0;
  align-items: center;
  justify-items: center;
  padding: 2px 3px;
}

.dt-duty-cell.is-configured {
  border-color: #f4c37d;
  background: #fff7ed;
}

.dt-duty-cell.is-current-duty::before {
  content: '';
  position: absolute;
  inset: -1px;
  z-index: 1;
  border-radius: 7px;
  padding: 1px;
  background: conic-gradient(
    from var(--dt-duty-spin, 0deg),
    rgba(255, 77, 79, 0) 0deg,
    #ff4d4f 22deg,
    #ffd666 42deg,
    #52c41a 62deg,
    #13c2c2 82deg,
    #1677ff 102deg,
    #722ed1 122deg,
    rgba(114, 46, 209, 0) 152deg,
    rgba(255, 77, 79, 0) 360deg
  );
  pointer-events: none;
  animation: dt-duty-rainbow-border 3.6s linear infinite;
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

.dt-duty-cell:disabled {
  cursor: not-allowed;
}

.dt-duty-cell strong {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  height: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #9a5b00;
  border-right: 1px solid #fde7c4;
  padding-right: 4px;
}

.dt-duty-cell-info {
  position: relative;
  z-index: 2;
  min-width: 0;
  display: grid;
  gap: 1px;
}

.dt-duty-cell-info span,
.dt-duty-cell-info em,
.dt-duty-cell-info small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-style: normal;
  color: var(--color-text-3);
  line-height: 1.15;
}

.dt-duty-month-grid .dt-duty-cell-info {
  display: none;
}

.dt-duty-month-grid .dt-duty-cell strong {
  overflow: visible;
  font-size: 11px;
  border-right: 0;
  padding-right: 0;
  justify-content: center;
}

@property --dt-duty-spin {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}

@keyframes dt-duty-rainbow-border {
  to {
    --dt-duty-spin: 360deg;
  }
}

.dt-duty-preview {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-height: 28px;
  margin-top: 4px;
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
  background: var(--color-bg-white);
  padding: 5px 8px;
  color: var(--color-text-2);
  font-size: 12px;
}

.dt-duty-preview strong {
  flex: 0 0 auto;
}

.dt-duty-preview-lines {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 3px;
}

.dt-duty-preview-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dt-duty-preview-text,
.dt-duty-preview-empty {
  flex: 1 1 auto;
  overflow: visible;
  white-space: pre-wrap;
  line-height: 1.5;
}

.dt-duty-preview-line.is-next .dt-duty-preview-text {
  color: var(--color-text-1);
  font-weight: 700;
}

.dt-duty-preview-status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 1.4;
}

.dt-duty-preview-status.is-pending {
  background: #e8f3ff;
  color: #165dff;
}

.dt-duty-preview-status.is-done {
  background: #f2f3f5;
  color: #86909c;
}

.dt-duty-preview-empty {
  color: var(--color-text-3);
}

.dt-task-type-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.dt-task-type-card {
  min-height: 116px;
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  background: var(--color-bg-3);
  padding: 14px;
  text-align: left;
  cursor: pointer;
  color: var(--color-text-2);
}

.dt-task-type-card:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.dt-task-type-card strong,
.dt-task-type-card span {
  display: block;
}

.dt-task-type-card strong {
  margin-bottom: 8px;
  color: var(--color-text-1);
  font-size: 15px;
}

.dt-task-type-card span {
  font-size: 13px;
  line-height: 1.6;
}

.dt-duty-dialog-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-1);
}

.dt-duty-dialog-grid {
  display: grid;
  grid-template-columns: minmax(260px, .75fr) minmax(420px, 1.25fr);
  gap: 12px;
  align-items: start;
}

.dt-duty-dialog-grid.is-bulk {
  grid-template-columns: minmax(220px, .7fr) minmax(300px, .95fr) minmax(420px, 1.35fr);
}

.dt-duty-dialog-card {
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  background: var(--color-bg-3);
  padding: 12px;
}

.dt-duty-dialog-card h4 {
  margin-bottom: 10px;
  color: var(--color-text-1);
  font-size: 14px;
}

.dt-duty-reference-row {
  margin-bottom: 8px;
}

.dt-duty-reference-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.dt-duty-field-label {
  display: block;
  margin: 8px 0 5px;
  color: var(--color-text-3);
  font-size: 12px;
}

.dt-duty-staff-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.dt-duty-staff-grid.is-bulk {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-height: 260px;
  overflow: auto;
  padding-right: 2px;
}

.dt-duty-staff-item {
  min-height: 28px;
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
  background: var(--color-bg-white);
  padding: 3px 6px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.dt-duty-staff-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--color-text-1);
}

.dt-duty-staff-item.is-disabled {
  cursor: not-allowed;
  background: var(--color-bg-3);
  color: var(--color-text-4);
}

.dt-duty-staff-item.is-disabled span {
  color: var(--color-text-4);
}

.dt-duty-staff-item :deep(.el-checkbox) {
  height: 18px;
}

.dt-duty-dialog-tip {
  margin-top: 8px;
  color: var(--color-text-3);
  font-size: 12px;
}

.dt-duty-send-mode,
.dt-duty-bulk-scope {
  margin-bottom: 8px;
}

.dt-duty-reference-select {
  width: 100%;
  margin-bottom: 8px;
}

.dt-duty-reference-preview {
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
  background: var(--color-bg-white);
  padding: 7px 8px;
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 1.5;
}

.dt-duty-time-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.dt-duty-time-row.is-single {
  grid-template-columns: 1fr;
}

.dt-duty-time-row :deep(.el-date-editor.el-input) {
  width: 100%;
}

.dt-duty-dialog-preview {
  margin-top: 10px;
  border: 1px solid #fde7c4;
  border-radius: 8px;
  background: #fffaf2;
  padding: 10px;
}

.dt-duty-dialog-preview strong {
  display: block;
  margin-bottom: 5px;
  color: #9a5b00;
  font-size: 13px;
}

.dt-duty-dialog-preview pre {
  margin: 0;
  color: var(--color-text-2);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
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

  .dt-notify-submodule {
    margin-left: 12px;
  }

  .dt-duty-submodule {
    margin-left: 12px;
  }

  .dt-duty-layout,
  .dt-duty-dialog-grid,
  .dt-duty-dialog-grid.is-bulk {
    grid-template-columns: 1fr;
  }

  .dt-duty-week-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .dt-duty-month-grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
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

  .dt-task-type-options,
  .dt-duty-staff-grid,
  .dt-duty-time-row {
    grid-template-columns: 1fr;
  }
}
</style>
