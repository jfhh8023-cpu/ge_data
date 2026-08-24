<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Calendar, Check, RefreshLeft, User } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { roleLabel } from '../utils/roles'

const EMPLOYMENT_STATUS_LABEL = {
  active: '在职',
  retained: '留职',
  long_leave: '长假'
}

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  rules: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue', 'saved'])

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 2100 - 2007 + 1 }, (_, index) => 2100 - index)
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' })
const loading = ref(false)
const saving = ref(false)
const previewing = ref(false)
const selectedYear = ref(currentYear)
const selectedRuleId = ref('')
const loadedYear = ref(currentYear)
const loadedRuleId = ref('')
const selectedDate = ref('')
const activeDetailTab = ref('date')
const calendarData = ref(null)
const effectiveFrom = ref('')
const manualOverrides = ref({})
const exceptions = ref([])
const swaps = ref([])
const previewDays = ref({})
const previewSummary = ref(null)
const dirty = ref(false)
const atDialogVisible = ref(false)
const noticeScope = ref('current')
const swapForm = reactive({ current_staff_id: '', target_date: '', target_staff_id: '' })

const dutyRules = computed(() => props.rules.filter(rule => String(rule.task_type) === 'duty_notify' && rule.id))
const selectedRule = computed(() => dutyRules.value.find(rule => rule.id === selectedRuleId.value) || null)
const availableStaff = computed(() => calendarData.value?.staff || [])
const staffMap = computed(() => new Map(availableStaff.value.map(staff => [String(staff.id), staff])))
const selectedBaseDay = computed(() => calendarData.value?.days?.find(day => day.date === selectedDate.value) || null)
const selectedDraftDay = computed(() => selectedBaseDay.value ? deriveDraftDay(selectedBaseDay.value) : null)
const currentPreview = computed(() => previewDays.value[selectedDate.value] || null)
const targetPreview = computed(() => previewDays.value[swapForm.target_date] || null)
const firstEffectiveFrom = computed(() => calendarData.value?.first_effective_from || effectiveFrom.value)
const isBeforeFirstEffective = computed(() => (
  selectedDate.value && firstEffectiveFrom.value && selectedDate.value < firstEffectiveFrom.value
))
function safeOfficialSourceUrl(value) {
  try {
    const url = new URL(String(value || ''))
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && (host === 'gov.cn' || host === 'www.gov.cn' || host.endsWith('.www.gov.cn'))
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

const sourceUrl = computed(() => safeOfficialSourceUrl(calendarData.value?.revision?.source_url))
const sourceTitle = computed(() => calendarData.value?.revision?.source_title || '当年法定节假日数据未初始化')
const holidaySync = computed(() => calendarData.value?.holiday_sync || { status: 'not_checked' })
const officialDataAvailable = computed(() => calendarData.value?.official_data_available === true)
const holidaySyncText = computed(() => {
  if (holidaySync.value.status === 'ready') return '官方数据已自动校验'
  if (holidaySync.value.status === 'refresh_failed') return '官方数据刷新失败，当前使用上次已校验缓存'
  if (holidaySync.value.status === 'pending') return '等待官方年度通知发布'
  if (holidaySync.value.status === 'error') return '官方数据同步失败，已保留现有数据'
  return '官方数据待自动检查'
})

const months = computed(() => {
  const groups = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, days: [] }))
  ;(calendarData.value?.days || []).forEach(day => groups[day.month - 1].days.push(day))
  return groups
})

const currentException = computed(() => {
  if (!selectedDate.value) return null
  let row = exceptions.value.find(item => item.calendar_date === selectedDate.value)
  if (!row) {
    row = createEmptyException(selectedDate.value)
    exceptions.value.push(row)
  }
  return row
})

const selectedSwapRows = computed(() => swaps.value.filter(swap =>
  swap.date_a === selectedDate.value || swap.date_b === selectedDate.value
))

const currentSwapStaffOptions = computed(() => currentPreview.value?.final_staff || [])
const targetSwapStaffOptions = computed(() => targetPreview.value?.final_staff || [])

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function localYmd(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function lunarDayText(value) {
  const day = Number(value)
  const digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  if (day >= 1 && day <= 10) return `初${digits[day - 1]}`
  if (day < 20) return `十${digits[day - 11] || ''}`
  if (day === 20) return '二十'
  if (day < 30) return `廿${digits[day - 21] || ''}`
  return day === 30 ? '三十' : String(day)
}

function lunarLabel(ymd) {
  const date = new Date(`${ymd}T12:00:00+08:00`)
  const parts = lunarFormatter.formatToParts(date)
  const month = parts.find(part => part.type === 'month')?.value || ''
  const day = parts.find(part => part.type === 'day')?.value || ''
  return `${month}${lunarDayText(day)}`
}

function createEmptyException(date) {
  return {
    id: '',
    calendar_date: date,
    skip_staff_ids: [],
    notice_enabled: false,
    notice_time: '09:00:00',
    notice_message: '',
    notice_at_mode: 'none',
    notice_staff_ids: [],
    status: 'active'
  }
}

function compactExceptions() {
  return exceptions.value
    .filter(item => item.skip_staff_ids.length || item.notice_enabled || item.notice_message || item.notice_staff_ids.length)
    .map(item => ({ ...clone(item), status: 'active' }))
}

function compactSwaps() {
  return swaps.value
    .filter(item => item.date_a && item.date_b && item.staff_a_id && item.staff_b_id)
    .map(item => ({ ...clone(item), status: 'active' }))
}

function buildDraft() {
  return {
    calendar_revision: {
      calendar_year: selectedYear.value,
      effective_from: effectiveFrom.value,
      manual_overrides: clone(manualOverrides.value)
    },
    exceptions: compactExceptions(),
    swaps: compactSwaps()
  }
}

function ruleLabel(rule) {
  return rule.name || (rule.schedule_type === 'monthly' ? '每月值班规则' : '每周值班规则')
}

function staffName(id) {
  return staffMap.value.get(String(id))?.name || '人员已不可用'
}

function staffStatusLabel(staff) {
  return EMPLOYMENT_STATUS_LABEL[staff?.employment_status] || '在职'
}

function deriveDraftDay(day) {
  const override = manualOverrides.value[day.date] || ''
  const effectiveSkipped = override === 'force_work'
    ? false
    : (override === 'manual_skip' ? true : day.default_skipped)
  return { ...day, override_mode: override, effective_skipped: effectiveSkipped }
}

function dayClass(day) {
  const draft = deriveDraftDay(day)
  return {
    'is-holiday': draft.effective_skipped && draft.is_official_holiday,
    'is-weekend': draft.effective_skipped && !draft.is_official_holiday && draft.is_weekend,
    'is-manual': draft.override_mode === 'manual_skip',
    'is-force-work': draft.override_mode === 'force_work',
    'is-adjusted-workday': draft.is_adjusted_workday && !draft.effective_skipped,
    'is-unconfigured': !draft.configured,
    'is-focused': selectedDate.value === draft.date,
    'is-today': draft.date === localYmd(new Date())
  }
}

function dayBadge(day) {
  const draft = deriveDraftDay(day)
  if (draft.override_mode === 'manual_skip') return '手动'
  if (draft.override_mode === 'force_work') return '已取消'
  if (draft.is_adjusted_workday) return '补班'
  if (draft.is_official_holiday) return draft.holiday_name || '节假日'
  if (draft.is_weekend) return '周末'
  return ''
}

function dayTooltip(day) {
  const draft = deriveDraftDay(day)
  const parts = [draft.date]
  if (draft.is_official_holiday) parts.push(draft.holiday_name || '法定节假日')
  if (draft.is_weekend) parts.push('周末')
  if (draft.is_adjusted_workday) parts.push('官方调休上班日')
  if (draft.override_mode === 'manual_skip') parts.push('手动停排')
  if (draft.override_mode === 'force_work') parts.push('已取消默认停排')
  if (!draft.configured) parts.push('规则未配置')
  const names = dayDutyNames(day)
  if (names) parts.push(`值班：${names}`)
  return parts.join(' · ')
}

function dayDutyNames(day) {
  if (deriveDraftDay(day).effective_skipped) return ''
  return (previewDays.value[day.date]?.final_staff || []).map(staff => staff.name).filter(Boolean).join('、')
}

function markDirty() {
  dirty.value = true
}

async function chooseDate(day, toggle = true) {
  selectedDate.value = day.date
  if (toggle) {
    if (firstEffectiveFrom.value && day.date < firstEffectiveFrom.value) {
      ElMessage.warning(`当前日期早于 ${firstEffectiveFrom.value} 生效日，仅供历史查看`)
      return
    }
    const current = manualOverrides.value[day.date] || ''
    if (day.default_skipped) {
      if (current === 'force_work') delete manualOverrides.value[day.date]
      else manualOverrides.value[day.date] = 'force_work'
    } else if (current === 'manual_skip') {
      delete manualOverrides.value[day.date]
    } else {
      manualOverrides.value[day.date] = 'manual_skip'
    }
    markDirty()
    await refreshYearPreview(false)
  }
}

function firstSelectableDate(data) {
  const today = localYmd(new Date())
  const firstEffective = data.revision?.effective_from || data.suggested_effective_from
  if (!data.feature_active && data.days.some(day => day.date === firstEffective)) return firstEffective
  return data.days.find(day => day.date === today)?.date || data.days[0]?.date || ''
}

async function loadCalendar() {
  if (!selectedRuleId.value) return
  loading.value = true
  try {
    const response = await api.get('/settings/duty-calendar', {
      params: { year: selectedYear.value, rule_id: selectedRuleId.value }
    })
    calendarData.value = response.data
    loadedYear.value = selectedYear.value
    loadedRuleId.value = selectedRuleId.value
    effectiveFrom.value = response.data.revision?.effective_from || response.data.suggested_effective_from
    manualOverrides.value = clone(response.data.revision?.manual_overrides || {})
    exceptions.value = clone(response.data.exceptions || [])
    swaps.value = clone(response.data.swaps || [])
    selectedDate.value = firstSelectableDate(response.data)
    previewDays.value = {}
    previewSummary.value = null
    dirty.value = false
    if (selectedDate.value) await refreshYearPreview(false)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '节假日配置加载失败')
  } finally {
    loading.value = false
  }
}

async function handleOpen() {
  if (!selectedRuleId.value || !dutyRules.value.some(rule => rule.id === selectedRuleId.value)) {
    selectedRuleId.value = dutyRules.value[0]?.id || ''
  }
  if (selectedRuleId.value) await loadCalendar()
}

async function confirmDiscard() {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('存在未保存修改，确认放弃吗？', '未保存修改', {
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
      type: 'warning'
    })
    return true
  } catch {
    return false
  }
}

async function changeYear(value) {
  if (!await confirmDiscard()) {
    selectedYear.value = loadedYear.value
    return
  }
  selectedYear.value = value
  await loadCalendar()
}

async function changeRule() {
  if (!await confirmDiscard()) {
    selectedRuleId.value = loadedRuleId.value
    return
  }
  await loadCalendar()
}

async function beforeClose(done) {
  if (await confirmDiscard()) done()
}

async function closeDialog() {
  if (await confirmDiscard()) emit('update:modelValue', false)
}

async function restoreDefaults() {
  try {
    await ElMessageBox.confirm('恢复后将清空当年所有手动停排和取消默认停排标记。', '恢复当年默认值', {
      confirmButtonText: '恢复默认',
      cancelButtonText: '取消',
      type: 'warning'
    })
    manualOverrides.value = {}
    markDirty()
    await refreshYearPreview(false)
  } catch {
    // Cancelled by user.
  }
}

async function refreshPreview(
  from = selectedDate.value,
  to = selectedDate.value,
  showMessage = true,
  presentationBeforeFirstEffective = false
) {
  if (!selectedRuleId.value || !from || !to) return null
  previewing.value = true
  try {
    const response = await api.post('/settings/duty-calendar/preview', {
      rule_id: selectedRuleId.value,
      from,
      to,
      draft: buildDraft(),
      presentation_before_first_effective: presentationBeforeFirstEffective
    })
    const nextDays = from === `${selectedYear.value}-01-01` && to === `${selectedYear.value}-12-31`
      ? {}
      : { ...previewDays.value }
    response.data.days.forEach(day => { nextDays[day.date] = day })
    previewDays.value = nextDays
    previewSummary.value = response.data.summary
    if (showMessage) ElMessage.success('排班预览已刷新')
    return response.data
  } catch (error) {
    if (showMessage) ElMessage.error(error.response?.data?.message || '排班预览失败')
    return null
  } finally {
    previewing.value = false
  }
}

function refreshYearPreview(showMessage = true) {
  return refreshPreview(
    `${selectedYear.value}-01-01`,
    `${selectedYear.value}-12-31`,
    showMessage,
    true
  )
}

async function handleEffectiveFromChange() {
  markDirty()
  await refreshYearPreview(false)
}

async function saveCalendar() {
  if (!officialDataAvailable.value) {
    ElMessage.warning('当年国家法定节假日数据尚未发布或尚未同步成功，暂不能保存生效')
    return
  }
  if (!effectiveFrom.value) {
    ElMessage.warning('请选择生效日期')
    return
  }
  saving.value = true
  try {
    const payload = {
      rule_id: selectedRuleId.value,
      revision_no: calendarData.value?.revision_no || 0,
      effective_from: effectiveFrom.value,
      manual_overrides: clone(manualOverrides.value),
      exceptions: compactExceptions(),
      swaps: compactSwaps()
    }
    const response = await api.put(`/settings/duty-calendar/${selectedYear.value}`, payload)
    calendarData.value = response.data
    manualOverrides.value = clone(response.data.revision?.manual_overrides || {})
    exceptions.value = clone(response.data.exceptions || [])
    swaps.value = clone(response.data.swaps || [])
    dirty.value = false
    ElMessage.success(response.message || '节假日跳过设置已保存并生效')
    emit('saved', response.data)
    await refreshYearPreview(false)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '节假日跳过设置保存失败')
  } finally {
    saving.value = false
  }
}

function noticeScopeDates() {
  const selected = selectedBaseDay.value
  if (!selected) return []
  if (noticeScope.value === 'holiday_range') {
    if (!selected.holiday_range_id) return [selected.date]
    return calendarData.value.days
      .filter(day => day.holiday_range_id === selected.holiday_range_id)
      .map(day => day.date)
  }
  if (noticeScope.value === 'weekends') {
    return calendarData.value.days.filter(day => day.is_weekend).map(day => day.date)
  }
  if (noticeScope.value === 'manual') {
    return Object.entries(manualOverrides.value)
      .filter(([, mode]) => mode === 'manual_skip')
      .map(([date]) => date)
  }
  return [selected.date]
}

function applyNoticeScope() {
  const source = currentException.value
  const dates = noticeScopeDates()
  if (!source || dates.length === 0) {
    ElMessage.warning('当前范围没有可应用日期')
    return
  }
  dates.forEach(date => {
    let target = exceptions.value.find(item => item.calendar_date === date)
    if (!target) {
      target = createEmptyException(date)
      exceptions.value.push(target)
    }
    Object.assign(target, {
      notice_enabled: source.notice_enabled,
      notice_time: source.notice_time,
      notice_message: source.notice_message,
      notice_at_mode: source.notice_at_mode,
      notice_staff_ids: clone(source.notice_staff_ids)
    })
  })
  markDirty()
  ElMessage.success(`已应用到 ${dates.length} 个日期`)
}

function handleAtModeChange(value) {
  if (!currentException.value) return
  if (value !== 'people') currentException.value.notice_staff_ids = []
  if (value === 'people') atDialogVisible.value = true
  markDirty()
}

function staffIdsToNames(ids) {
  return (ids || []).map(staffName).join('、') || '无'
}

async function handleSkipStaffChange() {
  markDirty()
  await refreshYearPreview(false)
}

async function enterSwapTab() {
  activeDetailTab.value = 'swap'
  swapForm.current_staff_id = ''
  swapForm.target_staff_id = ''
  if (swapForm.target_date) {
    const from = swapForm.target_date < selectedDate.value ? swapForm.target_date : selectedDate.value
    const to = swapForm.target_date > selectedDate.value ? swapForm.target_date : selectedDate.value
    await refreshPreview(from, to, false)
  } else {
    await refreshPreview(selectedDate.value, selectedDate.value, false)
  }
}

async function handleSwapTargetDate() {
  swapForm.target_staff_id = ''
  if (!swapForm.target_date) return
  const from = swapForm.target_date < selectedDate.value ? swapForm.target_date : selectedDate.value
  const to = swapForm.target_date > selectedDate.value ? swapForm.target_date : selectedDate.value
  await refreshPreview(from, to, false)
}

async function addSwap() {
  if (!swapForm.current_staff_id || !swapForm.target_date || !swapForm.target_staff_id) {
    ElMessage.warning('请选择双方日期和值班人员')
    return
  }
  if (swapForm.target_date === selectedDate.value) {
    ElMessage.warning('换班目标日期不能与当前日期相同')
    return
  }
  swaps.value.push({
    id: '',
    date_a: selectedDate.value,
    date_b: swapForm.target_date,
    staff_a_id: swapForm.current_staff_id,
    staff_b_id: swapForm.target_staff_id,
    status: 'active'
  })
  markDirty()
  swapForm.current_staff_id = ''
  swapForm.target_date = ''
  swapForm.target_staff_id = ''
  ElMessage.success('临时换班已加入草稿')
  await refreshYearPreview(false)
}

async function removeSwap(row) {
  swaps.value = swaps.value.filter(item => item !== row)
  markDirty()
  await refreshYearPreview(false)
}

function disableSwapDate(date) {
  const ymd = localYmd(date)
  return !ymd.startsWith(`${selectedYear.value}-`) || ymd === selectedDate.value
}

watch(selectedDate, () => {
  swapForm.current_staff_id = ''
  swapForm.target_date = ''
  swapForm.target_staff_id = ''
})
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="duty-calendar-dialog"
    width="calc(100vw - 48px)"
    top="24px"
    append-to-body
    :close-on-click-modal="false"
    :before-close="beforeClose"
    @update:model-value="emit('update:modelValue', $event)"
    @open="handleOpen"
  >
    <template #header>
      <div class="calendar-dialog-title">
        <el-icon><Calendar /></el-icon>
        <strong>节假日跳过设置</strong>
        <span>{{ selectedYear }} 年</span>
      </div>
    </template>

    <div v-loading="loading" class="calendar-dialog-body">
      <el-empty v-if="!dutyRules.length" description="暂无自动值班通知规则" />

      <template v-else-if="calendarData">
        <div class="calendar-toolbar">
          <div class="calendar-toolbar-fields">
            <label>
              <span>年份</span>
              <el-select :model-value="selectedYear" filterable style="width: 112px" @change="changeYear">
                <el-option v-for="year in yearOptions" :key="year" :label="`${year}年`" :value="year" />
              </el-select>
            </label>
            <label>
              <span>值班规则</span>
              <el-select v-model="selectedRuleId" style="width: 240px" @change="changeRule">
                <el-option v-for="rule in dutyRules" :key="rule.id" :label="ruleLabel(rule)" :value="rule.id" />
              </el-select>
            </label>
            <label>
              <span>生效日期</span>
              <el-date-picker
                v-model="effectiveFrom"
                type="date"
                value-format="YYYY-MM-DD"
                format="YYYY-MM-DD"
                style="width: 150px"
                @change="handleEffectiveFromChange"
              />
            </label>
          </div>
          <div class="calendar-toolbar-actions">
            <el-button :icon="RefreshLeft" @click="restoreDefaults">恢复当年默认值</el-button>
            <el-button :loading="previewing" @click="refreshPreview(effectiveFrom, `${selectedYear}-12-31`)">影响预览</el-button>
            <el-button
              type="primary"
              :loading="saving"
              :disabled="!officialDataAvailable"
              :title="officialDataAvailable ? '' : '官方节假日数据可用后才能保存生效'"
              :icon="Check"
              @click="saveCalendar"
            >保存生效</el-button>
          </div>
        </div>

        <div class="calendar-meta-row">
          <div class="calendar-legend" aria-label="日历图例">
            <span><i class="legend-dot is-weekend"></i>周末</span>
            <span><i class="legend-dot is-holiday"></i>法定节假日</span>
            <span><i class="legend-dot is-manual"></i>手动停排</span>
            <span><i class="legend-dot is-force"></i>已取消默认停排</span>
            <span><i class="legend-dot is-adjusted"></i>补班工作日</span>
            <span><i class="legend-underline"></i>规则未配置</span>
          </div>
          <div class="calendar-source-block" :title="holidaySync.error_message || holidaySyncText">
            <span class="calendar-sync-status" :class="`is-${holidaySync.status}`">{{ holidaySyncText }}</span>
            <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noreferrer">{{ sourceTitle }}</a>
            <span v-else class="calendar-source-missing">{{ sourceTitle }}</span>
          </div>
        </div>

        <div v-if="previewSummary" class="calendar-impact-summary">
          <span>已配置 {{ previewSummary.configured_days }} 天</span>
          <span>整日停排 {{ previewSummary.whole_day_skipped }} 天</span>
          <span>人员跳过 {{ previewSummary.person_skip_days }} 天</span>
          <span>换班影响 {{ previewSummary.swapped_days }} 天</span>
        </div>

        <div class="year-calendar" aria-label="全年值班日历">
          <section v-for="month in months" :key="month.month" class="month-panel">
            <h3>{{ month.month }}月</h3>
            <div class="weekday-head">
              <span v-for="label in ['一','二','三','四','五','六','日']" :key="label">{{ label }}</span>
            </div>
            <div class="month-days">
              <span
                v-for="blank in (month.days[0]?.weekday || 1) - 1"
                :key="`blank-${blank}`"
                class="day-blank"
              ></span>
              <button
                v-for="day in month.days"
                :key="day.date"
                type="button"
                class="calendar-day"
                :class="dayClass(day)"
                :title="dayTooltip(day)"
                :aria-label="dayTooltip(day)"
                :aria-pressed="deriveDraftDay(day).effective_skipped"
                @click="chooseDate(day)"
                @contextmenu.prevent="chooseDate(day, false)"
              >
                <span class="calendar-day-staff" :title="dayDutyNames(day)">{{ dayDutyNames(day) || '\u00a0' }}</span>
                <strong>{{ day.day }}</strong>
                <span class="calendar-day-lunar">{{ lunarLabel(day.date) }}</span>
                <small>{{ dayBadge(day) }}</small>
              </button>
            </div>
          </section>
        </div>

        <section v-if="selectedDraftDay && currentException" class="date-detail-panel">
          <div class="date-detail-head">
            <div>
              <strong>{{ selectedDate }}</strong>
              <span>{{ dayTooltip(selectedBaseDay) }}</span>
            </div>
            <div v-if="currentPreview" class="date-preview-people" :class="{ 'is-skipped': selectedDraftDay.effective_skipped }">
              <template v-if="selectedDraftDay.effective_skipped">
                <span>最终：整日停排</span>
                <span>值班通知：不生成</span>
              </template>
              <template v-else>
                <span>基础：{{ staffIdsToNames(currentPreview.base_staff_ids) }}</span>
                <span>最终：{{ staffIdsToNames(currentPreview.final_staff_ids) }}</span>
              </template>
            </div>
          </div>

          <el-tabs v-model="activeDetailTab" class="date-detail-tabs" @tab-change="name => name === 'swap' && enterSwapTab()">
            <el-tab-pane label="日期规则" name="date">
              <div class="detail-grid is-date-rule">
                <div><span>默认类型</span><strong>{{ selectedBaseDay.default_skipped ? '默认停排' : '普通工作日' }}</strong></div>
                <div><span>当前结果</span><strong>{{ selectedDraftDay.effective_skipped ? '整日停排' : '参与排班' }}</strong></div>
                <div><span>规则配置</span><strong>{{ selectedBaseDay.configured ? '已配置' : '未配置' }}</strong></div>
                <div><span>覆盖状态</span><strong>{{ selectedDraftDay.override_mode || '无' }}</strong></div>
              </div>
            </el-tab-pane>

            <el-tab-pane label="特殊通知" name="notice">
              <div class="notice-editor">
                <div class="notice-row">
                  <label><span>是否发送</span><el-switch v-model="currentException.notice_enabled" @change="markDirty" /></label>
                  <label><span>触发时间</span><el-time-picker v-model="currentException.notice_time" value-format="HH:mm:ss" format="HH:mm:ss" @change="markDirty" /></label>
                  <label class="notice-at-mode">
                    <span>@ 模式</span>
                    <el-radio-group v-model="currentException.notice_at_mode" @change="handleAtModeChange">
                      <el-radio-button value="none">不 @</el-radio-button>
                      <el-radio-button value="people">指定人员</el-radio-button>
                      <el-radio-button value="all">所有人</el-radio-button>
                    </el-radio-group>
                  </label>
                </div>
                <label class="notice-message">
                  <span>通知文案</span>
                  <el-input v-model="currentException.notice_message" type="textarea" :rows="3" maxlength="5000" show-word-limit @input="markDirty" />
                </label>
                <div class="notice-scope-row">
                  <el-select v-model="noticeScope" style="width: 190px">
                    <el-option label="仅当前日期" value="current" />
                    <el-option label="当前节假日区间" value="holiday_range" />
                    <el-option label="当年全部周末" value="weekends" />
                    <el-option label="当年全部手动停排日" value="manual" />
                  </el-select>
                  <el-button @click="applyNoticeScope">应用通知到范围</el-button>
                  <span v-if="currentException.notice_at_mode === 'people'">已选择：{{ staffIdsToNames(currentException.notice_staff_ids) }}</span>
                </div>
              </div>
            </el-tab-pane>

            <el-tab-pane label="人员跳过" name="people">
              <div v-if="isBeforeFirstEffective || selectedDraftDay.effective_skipped || !selectedBaseDay.configured" class="detail-disabled-note">
                {{ isBeforeFirstEffective
                  ? `当前日期早于 ${effectiveFrom} 生效日，不能配置人员跳过`
                  : (selectedDraftDay.effective_skipped ? '整日已停排，无需配置人员跳过' : '规则未配置，不参与排班') }}
              </div>
              <el-checkbox-group
                v-else
                v-model="currentException.skip_staff_ids"
                class="staff-check-grid"
                @change="handleSkipStaffChange"
              >
                <el-checkbox v-for="staff in availableStaff" :key="staff.id" :value="staff.id">
                  <span>{{ staff.name }}</span><small>{{ roleLabel(staff.role) }} · {{ staffStatusLabel(staff) }}</small>
                </el-checkbox>
              </el-checkbox-group>
            </el-tab-pane>

            <el-tab-pane label="临时换班" name="swap">
              <div v-if="isBeforeFirstEffective || selectedDraftDay.effective_skipped || !selectedBaseDay.configured" class="detail-disabled-note">
                {{ isBeforeFirstEffective
                  ? `当前日期早于 ${firstEffectiveFrom} 生效日，不能配置临时换班`
                  : (selectedDraftDay.effective_skipped ? '整日已停排，不能配置临时换班' : '规则未配置，不参与排班') }}
              </div>
              <template v-else>
                <div class="swap-editor-row">
                  <el-select v-model="swapForm.current_staff_id" placeholder="当前日期人员" style="width: 180px">
                    <el-option v-for="staff in currentSwapStaffOptions" :key="staff.id" :label="staff.name" :value="staff.id" />
                  </el-select>
                  <el-date-picker
                    v-model="swapForm.target_date"
                    type="date"
                    value-format="YYYY-MM-DD"
                    format="YYYY-MM-DD"
                    placeholder="换班日期"
                    :disabled-date="disableSwapDate"
                    style="width: 160px"
                    @change="handleSwapTargetDate"
                  />
                  <el-select v-model="swapForm.target_staff_id" placeholder="目标日期人员" style="width: 180px">
                    <el-option v-for="staff in targetSwapStaffOptions" :key="staff.id" :label="staff.name" :value="staff.id" />
                  </el-select>
                  <el-button type="primary" plain @click="addSwap">添加换班</el-button>
                </div>
                <div v-if="selectedSwapRows.length" class="swap-list">
                  <div v-for="row in selectedSwapRows" :key="row.id || `${row.date_a}-${row.date_b}-${row.staff_a_id}`">
                    <span>{{ row.date_a }} {{ staffName(row.staff_a_id) }}</span>
                    <strong>⇄</strong>
                    <span>{{ row.date_b }} {{ staffName(row.staff_b_id) }}</span>
                    <el-button link type="danger" @click="removeSwap(row)">取消</el-button>
                  </div>
                </div>
                <el-empty v-else :image-size="52" description="当前日期暂无临时换班" />
              </template>
            </el-tab-pane>
          </el-tabs>
        </section>
      </template>
    </div>

    <template #footer>
      <el-button @click="closeDialog">取消</el-button>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="!officialDataAvailable"
        :title="officialDataAvailable ? '' : '官方节假日数据可用后才能保存生效'"
        @click="saveCalendar"
      >保存生效</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="atDialogVisible" title="选择通知 @ 人员" width="560px" append-to-body>
    <el-checkbox-group v-if="currentException" v-model="currentException.notice_staff_ids" class="staff-check-grid at-staff-grid" @change="markDirty">
      <el-checkbox v-for="staff in availableStaff" :key="staff.id" :value="staff.id">
        <span>{{ staff.name }}</span><small>{{ roleLabel(staff.role, true) }} · {{ staffStatusLabel(staff) }}</small>
      </el-checkbox>
    </el-checkbox-group>
    <template #footer>
      <el-button type="primary" :icon="User" @click="atDialogVisible = false">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.calendar-dialog-body {
  min-height: 420px;
  max-height: calc(100vh - 154px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
}

.calendar-dialog-title,
.calendar-toolbar,
.calendar-toolbar-fields,
.calendar-toolbar-actions,
.calendar-meta-row,
.calendar-legend,
.calendar-impact-summary,
.date-detail-head,
.date-preview-people,
.notice-row,
.notice-scope-row,
.swap-editor-row {
  display: flex;
  align-items: center;
}

.calendar-dialog-title {
  gap: 8px;
  font-size: 18px;
}

.calendar-dialog-title span {
  color: var(--color-text-3);
  font-size: 13px;
}

.calendar-toolbar {
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border-light);
}

.calendar-toolbar-fields,
.calendar-toolbar-actions {
  gap: 10px;
  flex-wrap: wrap;
}

.calendar-toolbar label,
.notice-row label,
.notice-message {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--color-text-2);
  font-size: 13px;
  white-space: nowrap;
}

.calendar-meta-row {
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  font-size: 12px;
}

.calendar-meta-row a {
  color: var(--color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calendar-source-block {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.calendar-sync-status {
  flex: 0 0 auto;
  padding-left: 8px;
  border-left: 2px solid #8c95a3;
  color: var(--color-text-2);
  white-space: nowrap;
}

.calendar-sync-status.is-ready { color: #08783b; border-color: #1a9b55; }
.calendar-sync-status.is-pending { color: #8a4d00; border-color: #d69e2e; }
.calendar-sync-status.is-error { color: #a61d24; border-color: #d9363e; }

.calendar-source-missing {
  color: var(--color-danger);
}

.calendar-legend {
  gap: 14px;
  flex-wrap: wrap;
  color: var(--color-text-2);
}

.calendar-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend-dot.is-weekend { background: #2f6feb; }
.legend-dot.is-holiday { background: #d9363e; }
.legend-dot.is-manual { background: #1a9b55; }
.legend-dot.is-force { background: #c7ccd6; border: 1px solid #7f8795; }
.legend-dot.is-adjusted { background: #f6c344; border: 1px solid #b7791f; }
.legend-underline { width: 12px; border-bottom: 2px dotted #8c95a3; }

.calendar-impact-summary {
  gap: 18px;
  min-height: 34px;
  padding: 7px 10px;
  margin-bottom: 8px;
  color: #174ea6;
  background: #edf4ff;
  border-left: 3px solid #2f6feb;
  font-size: 12px;
}

.year-calendar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.month-panel {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
}

.month-panel h3 {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--color-text-1);
}

.weekday-head,
.month-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}

.weekday-head {
  margin-bottom: 3px;
  color: var(--color-text-3);
  font-size: 11px;
  text-align: center;
}

.calendar-day,
.day-blank {
  width: 100%;
  min-height: 68px;
}

.calendar-day {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 3px;
  --calendar-day-bg: #fff;
  color: var(--color-text-1);
  background: var(--calendar-day-bg);
  border: 1px solid #e4e8ef;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
}

.calendar-day:hover { border-color: #1f5fd6; }
.calendar-day strong { font-size: 17px; line-height: 1; }
.calendar-day small,
.calendar-day-lunar,
.calendar-day-staff {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calendar-day small { min-height: 13px; font-size: 11px; line-height: 1.15; }
.calendar-day-lunar { color: #667085; font-size: 11px; line-height: 1.15; }
.calendar-day-staff {
  align-self: stretch;
  min-height: 13px;
  color: #0f5bd7;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-align: left;
}
.calendar-day.is-weekend { --calendar-day-bg: #eaf2ff; color: #174ea6; border-color: #a9c6fa; }
.calendar-day.is-holiday { --calendar-day-bg: #fff0f0; color: #a61d24; border-color: #f0a6aa; }
.calendar-day.is-manual { --calendar-day-bg: #e9f8ef; color: #08783b; border-color: #8ed5ad; }
.calendar-day.is-force-work { --calendar-day-bg: #f7f8fa; color: #4e5969; border-color: #aeb5c1; }
.calendar-day.is-adjusted-workday { --calendar-day-bg: #fff8dc; color: #7a4700; border-color: #e2b33c; }
.calendar-day.is-unconfigured { border-bottom-style: dotted; border-bottom-width: 2px; }
.calendar-day.is-focused { outline: 2px solid #111827; outline-offset: 1px; }

.calendar-day.is-today {
  isolation: isolate;
  border-color: transparent;
}

.calendar-day.is-today::before,
.calendar-day.is-today::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.calendar-day.is-today::before {
  z-index: -2;
  inset: -65%;
  background: conic-gradient(
    #ff3b30, #ff9500, #ffd60a, #34c759, #00c7be,
    #0a84ff, #5e5ce6, #bf5af2, #ff2d55, #ff3b30
  );
  animation: duty-today-ring 2.8s linear infinite;
}

.calendar-day.is-today::after {
  z-index: -1;
  inset: 2px;
  border-radius: 2px;
  background: var(--calendar-day-bg);
}

@keyframes duty-today-ring {
  to { transform: rotate(1turn); }
}

@media (prefers-reduced-motion: reduce) {
  .calendar-day.is-today::before { animation: none; }
}

.date-detail-panel {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.date-detail-head {
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 4px;
}

.date-detail-head > div:first-child {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.date-detail-head span {
  color: var(--color-text-3);
  font-size: 12px;
}

.date-preview-people {
  gap: 16px;
  white-space: nowrap;
}

.date-preview-people.is-skipped span {
  color: #a61d24;
  font-weight: 600;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: var(--color-border-light);
  border: 1px solid var(--color-border-light);
}

.detail-grid > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 58px;
  padding: 10px;
  background: #fff;
}

.detail-grid span { color: var(--color-text-3); font-size: 12px; }
.detail-grid strong { font-size: 14px; }

.notice-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.notice-row {
  gap: 18px;
  flex-wrap: wrap;
}

.notice-message {
  align-items: flex-start;
}

.notice-message > span { width: 58px; padding-top: 7px; }
.notice-message :deep(.el-textarea) { flex: 1; }
.notice-scope-row { gap: 10px; }
.notice-scope-row > span { color: var(--color-text-3); font-size: 12px; }

.detail-disabled-note {
  padding: 12px;
  color: #8a4d00;
  background: #fff8e8;
  border-left: 3px solid #d69e2e;
}

.staff-check-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.staff-check-grid :deep(.el-checkbox) {
  width: 100%;
  margin-right: 0;
  padding: 7px 9px;
  border: 1px solid var(--color-border-light);
  border-radius: 4px;
}

.staff-check-grid small {
  margin-left: 6px;
  color: var(--color-text-3);
  white-space: nowrap;
}

.at-staff-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.swap-editor-row {
  gap: 8px;
  flex-wrap: wrap;
}

.swap-list {
  margin-top: 10px;
  border-top: 1px solid var(--color-border-light);
}

.swap-list > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px minmax(0, 1fr) 52px;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  border-bottom: 1px solid var(--color-border-light);
}

.swap-list strong { text-align: center; color: var(--color-primary); }

@media (max-width: 1400px) {
  .year-calendar { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 1040px) {
  .year-calendar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .calendar-toolbar { align-items: flex-start; flex-direction: column; }
  .detail-grid, .staff-check-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 720px) {
  .year-calendar { grid-template-columns: minmax(0, 1fr); }
  .calendar-meta-row, .date-detail-head { align-items: flex-start; flex-direction: column; }
  .detail-grid, .staff-check-grid { grid-template-columns: minmax(0, 1fr); }
  .date-preview-people { align-items: flex-start; flex-direction: column; gap: 4px; white-space: normal; }
}
</style>
