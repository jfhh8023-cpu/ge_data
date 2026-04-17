<script setup>
/**
 * CreateTaskModal — 新建收集任务弹窗
 * 左右双栏布局：左侧表单 + 右侧日历
 * 日历与表单双向实时联动
 */
import { ref, computed, watch } from 'vue'
import { useTaskStore } from '../stores/task'
import { ElMessage } from 'element-plus'

const emit = defineEmits(['close', 'created'])
const props = defineProps({
  visible: { type: Boolean, default: false },
  editTask: { type: Object, default: null }
})

/** 是否是编辑模式 */
const isEditMode = computed(() => !!props.editTask)

const taskStore = useTaskStore()
const submitting = ref(false)

/* ========== 时间维度常量 ========== */
const DIMENSION_OPTIONS = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'half_month', label: '半月' },
  { value: 'month', label: '月' },
  { value: 'quarter', label: '季度' },
  { value: 'half_year', label: '半年' },
  { value: 'year', label: '年' }
]

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

/* ========== 表单状态 ========== */
const timeDimension = ref('week')
const referenceDate = ref(new Date())
const startDate = ref('')
const endDate = ref('')
const taskTitle = ref('')

/* ========== 日历状态 ========== */
const calendarYear = ref(new Date().getFullYear())
const calendarMonth = ref(new Date().getMonth()) // 0-based

/* ========== 日期计算工具 ========== */
function formatDate(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateCN(d) {
  return `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月${String(d.getDate()).padStart(2,'0')}日`
}

/** 获取 ISO 周数 */
function getWeekNumber(d) {
  const tempDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = tempDate.getUTCDay() || 7
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1))
  return Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7)
}

/** 根据维度和参考日期计算起止日期 */
function calculateRange(dim, refDate) {
  const d = new Date(refDate)
  let s, e

  switch (dim) {
    case 'day':
      s = e = new Date(d)
      break
    case 'week': {
      // 上周一到上周日
      const today = new Date(d)
      const dayOfWeek = today.getDay() || 7
      const lastMonday = new Date(today)
      lastMonday.setDate(today.getDate() - dayOfWeek - 6)
      const lastSunday = new Date(lastMonday)
      lastSunday.setDate(lastMonday.getDate() + 6)
      s = lastMonday
      e = lastSunday
      break
    }
    case 'half_month':
      if (d.getDate() <= 15) {
        s = new Date(d.getFullYear(), d.getMonth(), 1)
        e = new Date(d.getFullYear(), d.getMonth(), 15)
      } else {
        s = new Date(d.getFullYear(), d.getMonth(), 16)
        e = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      }
      break
    case 'month':
      s = new Date(d.getFullYear(), d.getMonth(), 1)
      e = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      break
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3)
      s = new Date(d.getFullYear(), q * 3, 1)
      e = new Date(d.getFullYear(), q * 3 + 3, 0)
      break
    }
    case 'half_year':
      if (d.getMonth() < 6) {
        s = new Date(d.getFullYear(), 0, 1)
        e = new Date(d.getFullYear(), 5, 30)
      } else {
        s = new Date(d.getFullYear(), 6, 1)
        e = new Date(d.getFullYear(), 11, 31)
      }
      break
    case 'year':
      s = new Date(d.getFullYear(), 0, 1)
      e = new Date(d.getFullYear(), 11, 31)
      break
    default:
      s = e = new Date(d)
  }
  return { start: s, end: e }
}

/** 生成任务标题 */
function generateTitle(s, e, dim) {
  const sd = new Date(s)
  const ed = new Date(e)

  if (dim === 'week') {
    const wn = getWeekNumber(sd)
    return `语音业务线-${sd.getFullYear()}年第${wn}周工时统计`
  }
  const startStr = formatDateCN(sd)
  const endStr = formatDateCN(ed)
  return `语音业务线-${startStr}-${endStr}工时统计`
}

/** 初始化计算 */
function recalculate() {
  const { start, end } = calculateRange(timeDimension.value, referenceDate.value)
  startDate.value = formatDate(start)
  endDate.value = formatDate(end)
  taskTitle.value = generateTitle(start, end, timeDimension.value)
  // 日历跳转到起始月份
  calendarYear.value = start.getFullYear()
  calendarMonth.value = start.getMonth()
}

// 响应维度变化
watch(timeDimension, recalculate, { immediate: true })

// 编辑模式初始化
watch(() => props.editTask, (task) => {
  if (task) {
    timeDimension.value = task.time_dimension || 'week'
    startDate.value = task.start_date || ''
    endDate.value = task.end_date || ''
    taskTitle.value = task.title || ''
    if (task.start_date) {
      const sd = new Date(task.start_date)
      calendarYear.value = sd.getFullYear()
      calendarMonth.value = sd.getMonth()
    }
  }
}, { immediate: true })

/* ========== 日历渲染 ========== */
const calendarDays = computed(() => {
  const firstDay = new Date(calendarYear.value, calendarMonth.value, 1)
  const startWeekday = firstDay.getDay()
  const daysInMonth = new Date(calendarYear.value, calendarMonth.value + 1, 0).getDate()
  const prevMonthDays = new Date(calendarYear.value, calendarMonth.value, 0).getDate()

  const days = []
  // 上月尾部
  for (let i = startWeekday - 1; i >= 0; i--) {
    days.push({ day: prevMonthDays - i, otherMonth: true, date: new Date(calendarYear.value, calendarMonth.value - 1, prevMonthDays - i) })
  }
  // 本月
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({ day: i, otherMonth: false, date: new Date(calendarYear.value, calendarMonth.value, i) })
  }
  // 下月头部
  const remaining = 42 - days.length
  for (let i = 1; i <= remaining; i++) {
    days.push({ day: i, otherMonth: true, date: new Date(calendarYear.value, calendarMonth.value + 1, i) })
  }
  return days
})

const calendarTitle = computed(() => `${calendarYear.value}年 ${MONTH_NAMES[calendarMonth.value]}`)

function prevMonth() {
  if (calendarMonth.value === 0) {
    calendarMonth.value = 11
    calendarYear.value--
  } else {
    calendarMonth.value--
  }
}

function nextMonth() {
  if (calendarMonth.value === 11) {
    calendarMonth.value = 0
    calendarYear.value++
  } else {
    calendarMonth.value++
  }
}

/** 判断日期是否在选中范围内 */
function isInRange(d) {
  if (!startDate.value || !endDate.value) return false
  const ds = formatDate(d)
  return ds >= startDate.value && ds <= endDate.value
}

function isRangeStart(d) { return formatDate(d) === startDate.value }
function isRangeEnd(d) { return formatDate(d) === endDate.value }
function isToday(d) { return formatDate(d) === formatDate(new Date()) }

/** 日历点击 → 更新表单 */
function onDayClick(dayObj) {
  referenceDate.value = dayObj.date
  recalculate()
}

/* ========== 快捷周期列表 ========== */
/** 获取指定日期所在周的周一 */
function getMonday(d) {
  const date = new Date(d)
  const day = date.getDay() || 7 // 周日=7
  date.setDate(date.getDate() - day + 1)
  date.setHours(0, 0, 0, 0)
  return date
}

/** 快捷列表：未来2周 + 本周 + 过去4周 = 7项，按时间倒序 */
const SHORTCUT_FUTURE_WEEKS = 2
const SHORTCUT_PAST_WEEKS = 4

const shortcuts = computed(() => {
  const items = []
  const thisMonday = getMonday(new Date())

  for (let offset = SHORTCUT_FUTURE_WEEKS; offset >= -SHORTCUT_PAST_WEEKS; offset--) {
    const monday = new Date(thisMonday)
    monday.setDate(monday.getDate() + offset * 7)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const wn = getWeekNumber(monday)
    const tag = offset > 0 ? ' 🔮' : offset === 0 ? ' 📌' : ''
    items.push({
      label: `第${wn}周 (${formatDate(monday).slice(5)} ~ ${formatDate(sunday).slice(5)})${tag}`,
      start: monday,
      end: sunday,
      isCurrent: offset === 0
    })
  }
  return items
})

function selectShortcut(item) {
  timeDimension.value = 'week'
  startDate.value = formatDate(item.start)
  endDate.value = formatDate(item.end)
  taskTitle.value = generateTitle(item.start, item.end, 'week')
  calendarYear.value = item.start.getFullYear()
  calendarMonth.value = item.start.getMonth()
}

/* ========== 提交 ========== */
async function handleSubmit() {
  if (!startDate.value || !endDate.value) {
    ElMessage.warning('请选择时间范围')
    return
  }
  submitting.value = true
  try {
    const sd = new Date(startDate.value)
    const weekNum = timeDimension.value === 'week' ? getWeekNumber(sd) : undefined
    const payload = {
      title: taskTitle.value,
      time_dimension: timeDimension.value,
      start_date: startDate.value,
      end_date: endDate.value,
      week_number: weekNum,
      year: sd.getFullYear()
    }
    if (isEditMode.value) {
      await taskStore.update(props.editTask.id, payload)
      ElMessage.success('任务已更新')
    } else {
      await taskStore.create(payload)
      ElMessage.success('收集任务创建成功')
    }
    emit('created')
    emit('close')
  } catch {
    ElMessage.error(isEditMode.value ? '更新失败' : '创建失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('close')"
    :title="isEditMode ? '编辑收集任务' : '新建收集任务'"
    width="960px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div style="display:grid; grid-template-columns:1fr 380px; gap:36px;">
      <!-- 左栏：表单 -->
      <div>
        <el-form label-position="top">
          <el-form-item label="时间维度">
            <el-select v-model="timeDimension" style="width:100%;">
              <el-option v-for="opt in DIMENSION_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </el-form-item>

          <el-form-item label="起止日期">
            <div style="display:flex; gap:12px; align-items:center; width:100%;">
              <el-date-picker v-model="startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" style="flex:1;" />
              <span style="color:var(--color-text-4);">—</span>
              <el-date-picker v-model="endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" style="flex:1;" />
            </div>
          </el-form-item>

          <el-form-item label="任务标题（自动生成）">
            <el-input v-model="taskTitle" type="textarea" :rows="2" />
          </el-form-item>
        </el-form>

        <!-- 快捷周期 -->
        <div style="margin-top:8px;">
          <span style="font-size:13px; font-weight:500; color:var(--color-text-3); display:block; margin-bottom:8px;">快捷选择</span>
          <div style="display:flex; flex-direction:column; gap:4px;">
            <button
              v-for="(item, idx) in shortcuts" :key="idx"
              @click="selectShortcut(item)"
              style="padding:8px 12px; font-size:13px; color:var(--color-text-2); border-radius:4px; cursor:pointer;
                     background:none; border:none; text-align:left; font-family:var(--font-base); transition:all 0.15s;"
              @mouseover="$event.target.style.background='var(--color-primary-light)'; $event.target.style.color='var(--color-primary)'"
              @mouseleave="$event.target.style.background='none'; $event.target.style.color='var(--color-text-2)'"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- 右栏：日历 -->
      <div style="background:var(--color-bg-2); border-radius:8px; padding:20px; border:1px solid var(--color-border-light);">
        <!-- 日历导航 -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <button @click="prevMonth" style="background:none; border:none; cursor:pointer; color:var(--color-text-3); font-size:16px; padding:4px 8px; border-radius:4px;"
            @mouseover="$event.target.style.background='var(--color-bg-1)'" @mouseleave="$event.target.style.background='none'">&lt;</button>
          <span style="font-size:14px; font-weight:600; color:var(--color-text-1);">{{ calendarTitle }}</span>
          <button @click="nextMonth" style="background:none; border:none; cursor:pointer; color:var(--color-text-3); font-size:16px; padding:4px 8px; border-radius:4px;"
            @mouseover="$event.target.style.background='var(--color-bg-1)'" @mouseleave="$event.target.style.background='none'">&gt;</button>
        </div>

        <!-- 星期标题 -->
        <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center;">
          <div v-for="w in WEEKDAYS" :key="w" style="font-size:12px; color:var(--color-text-4); padding:6px 0; font-weight:500;">{{ w }}</div>
        </div>

        <!-- 日期格子 -->
        <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center;">
          <div
            v-for="(d, i) in calendarDays" :key="i"
            @click="!d.otherMonth && onDayClick(d)"
            :style="{
              padding: '8px 0',
              fontSize: '13px',
              borderRadius: '4px',
              cursor: d.otherMonth ? 'default' : 'pointer',
              transition: 'all 0.15s',
              color: d.otherMonth ? 'var(--color-text-4)'
                : isRangeStart(d.date) || isRangeEnd(d.date) ? '#fff'
                : isInRange(d.date) ? 'var(--color-primary)'
                : isToday(d.date) ? 'var(--color-primary)'
                : 'var(--color-text-2)',
              background: isRangeStart(d.date) || isRangeEnd(d.date) ? 'var(--color-primary)'
                : isInRange(d.date) ? 'var(--color-primary-light)'
                : 'transparent',
              fontWeight: isToday(d.date) || isRangeStart(d.date) || isRangeEnd(d.date) ? '700' : '400'
            }"
          >
            {{ d.day }}
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="$emit('close')">取消</el-button>
      <el-button type="primary" @click="handleSubmit" :loading="submitting">{{ isEditMode ? '保存' : '创建任务' }}</el-button>
    </template>
  </el-dialog>
</template>
