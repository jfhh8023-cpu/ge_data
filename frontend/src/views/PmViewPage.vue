<script setup>
/**
 * PmViewPage.vue — 产品经理专属查看页
 * v3.2.1: 搜索按钮 + 周期排序 + 角色工时 + 金银铜牌闪光角标
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
import { ElMessage } from 'element-plus'
import { useRoleStore } from '../stores/roles'
import { ROLE_AI_DEV, ROLE_AI_QUALITY, ROLE_AI_PM, normalizeRole, roleLabel, roleTagStyle } from '../utils/roles'
import { sortRecordsByCreatedAt } from '../utils/recordOrder'

const route = useRoute()
const roleStore = useRoleStore()
const token = computed(() => route.params.token)
const isPersonalProductView = computed(() => route.name === 'ProductManagerHours')

const loading = ref(true)
const error = ref('')
const pmData = ref(null)
const isBlocked = computed(() => pmData.value?.blocked === true)
const blockMessage = computed(() => pmData.value?.message || '用户已离职，无法查看页面数据')

/* ========== 筛选状态 ========== */
const now = new Date()
const CURRENT_YEAR = now.getFullYear()
const CURRENT_QUARTER = Math.ceil((now.getMonth() + 1) / 3)
const CURRENT_MONTH = now.getMonth() + 1

// 支持从路由 query 参数初始化筛选条件（如从"查看全部"跳转）
function queryQuarter(value) {
  if (value === undefined) return CURRENT_QUARTER
  if (String(value).toLowerCase() === 'all' || String(value) === '0') return 0
  const quarter = Number(String(value).replace(/^q/i, ''))
  return Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? quarter : CURRENT_QUARTER
}
const initYear = parseInt(route.query.year) || CURRENT_YEAR
const initQuarter = queryQuarter(route.query.quarter)
const initMonth = route.query.month !== undefined ? parseInt(route.query.month) : 0

const filterYear = ref(initYear)
const filterQuarter = ref(initQuarter)
const filterMonth = ref(initMonth)
const filterTaskId = ref(String(route.query.taskId || 'all'))
const personalTaskOptions = ref([])
const yearOptions = computed(() => {
  const years = []
  for (let y = CURRENT_YEAR + 1; y >= CURRENT_YEAR - 2; y--) years.push(y)
  return [...new Set([...years, filterYear.value])].sort((a, b) => b - a)
})
const QUARTER_OPTIONS = [
  { label: '全年', value: 0 },
  { label: 'Q1', value: 1 },
  { label: 'Q2', value: 2 },
  { label: 'Q3', value: 3 },
  { label: 'Q4', value: 4 }
]
const MONTH_OPTIONS = computed(() => {
  const opts = [{ label: '全部月份', value: 0 }]
  for (let m = 1; m <= 12; m++) opts.push({ label: `${m}月`, value: m })
  return opts
})

/* ========== 周期排序 ========== */
const taskSortOrder = ref('desc')  // 'desc' = 最新优先, 'asc' = 最早优先

const sortedTasks = computed(() => {
  if (!pmData.value?.tasks) return []
  const arr = pmData.value.tasks.filter(task => !isPersonalProductView.value || task.records?.length).map(task => ({
    ...task,
    records: sortRecordsByCreatedAt(task.records)
  }))
  if (taskSortOrder.value === 'asc') {
    arr.sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
  } else {
    arr.sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
  }
  return arr
})

// 季度选全年时自动清空月份
watch(filterQuarter, (val) => {
  if (!val) filterMonth.value = 0
})
watch([filterYear, filterQuarter], () => {
  if (isPersonalProductView.value) {
    filterTaskId.value = 'all'
    personalTaskOptions.value = []
  }
}, { flush: 'sync' })

/* ========== 金银铜牌 ========== */
const MEDAL_EMOJI = ['🥇', '🥈', '🥉']
const MEDAL_CLASS = ['medal-gold', 'medal-silver', 'medal-bronze']

function getMedalRank(records, currentHours) {
  // 获取去重后的前3大工时值
  const uniqueHours = [...new Set(records.map(r => parseFloat(r.hours || 0)))]
    .sort((a, b) => b - a)
    .slice(0, 3)
  const h = parseFloat(currentHours || 0)
  const idx = uniqueHours.indexOf(h)
  return idx >= 0 && idx < 3 ? idx : -1
}

onMounted(() => handleSearch())
let requestId = 0
onUnmounted(() => { requestId += 1 })
watch(() => route.fullPath, () => {
  if (!['PmView', 'ProductManagerHours'].includes(route.name)) {
    requestId += 1
    return
  }
  filterYear.value = parseInt(route.query.year) || CURRENT_YEAR
  filterQuarter.value = queryQuarter(route.query.quarter)
  filterMonth.value = parseInt(route.query.month) || 0
  filterTaskId.value = String(route.query.taskId || 'all')
  personalTaskOptions.value = []
  isFullYear.value = false
  handleSearch()
})

function personalViewData(data, staffId) {
  const staff = data?.staff
  if (!staff || String(staff.id) !== staffId || normalizeRole(staff.role, '') !== ROLE_AI_PM) {
    throw new Error('当前人员不是可查看的AI产品经理')
  }
  const tasks = (data.tasks || []).map(task => ({
    ...task,
    records: (task.records || []).filter(record => String(record.staff_id || record.staff?.id || '') === staffId)
      .map(record => ({
        ...record,
        staffName: staff.name || '-',
        role: staff.role,
        demandSourcesLabel: Array.isArray(record.demand_sources) ? record.demand_sources.join('、') || '-' : '-',
        hours: Number(record.hours) || 0
      }))
  }))
  const records = tasks.flatMap(task => task.records)
  return {
    ...data,
    pm: { id: staff.id, name: staff.name || '-' },
    tasks,
    totalHours: records.reduce((sum, record) => sum + record.hours, 0),
    totalRecords: records.length
  }
}

async function handleSearch() {
  const searchId = ++requestId
  const personalView = isPersonalProductView.value
  loading.value = true
  error.value = ''
  try {
    const params = { year: filterYear.value }
    if (personalView) {
      const staffId = String(route.params.staffId || '')
      if (!staffId) throw new Error('缺少产品经理人员信息')
      params.quarter = filterQuarter.value ? `Q${filterQuarter.value}` : 'all'
      params.taskId = filterTaskId.value || 'all'
      const res = await api.get(`/stats/personal/${encodeURIComponent(staffId)}`, { params })
      if (searchId !== requestId) return
      const data = personalViewData(res.data?.data || res.data, staffId)
      pmData.value = data
      personalTaskOptions.value = data.tasks
    } else {
      if (filterQuarter.value) params.quarter = filterQuarter.value
      if (filterMonth.value) params.month = filterMonth.value
      const res = await api.get(`/pm/view/${token.value}`, { params })
      if (searchId !== requestId) return
      pmData.value = res.data
    }
  } catch (err) {
    if (searchId !== requestId) return
    pmData.value = null
    const msg = err.response?.data?.message || (personalView ? err.message : '') || '加载失败'
    error.value = msg
    ElMessage.error(msg)
  } finally {
    if (searchId === requestId) loading.value = false
  }
}

/* ========== 全年展示切换 ========== */
const isFullYear = ref(false)

function toggleFullYear() {
  if (isFullYear.value) {
    // 恢复当前年季月
    filterYear.value = CURRENT_YEAR
    filterQuarter.value = CURRENT_QUARTER
    filterMonth.value = isPersonalProductView.value ? 0 : CURRENT_MONTH
    isFullYear.value = false
  } else {
    // 切换到全年
    filterYear.value = CURRENT_YEAR
    filterQuarter.value = 0
    filterMonth.value = 0
    isFullYear.value = true
  }
  if (isPersonalProductView.value) filterTaskId.value = 'all'
  handleSearch()
}

const roleSummary = computed(() => {
  const summary = pmData.value?.roleSummary || {}
  return Object.fromEntries(roleStore.list.map(role => {
    if (role.key === ROLE_AI_DEV && summary[role.key] === undefined) return [role.key, Number(summary.frontend || 0) + Number(summary.backend || 0)]
    if (role.key === ROLE_AI_QUALITY && summary[role.key] === undefined) return [role.key, Number(summary.test || 0)]
    return [role.key, Number(summary[role.key] || 0)]
  }))
})
</script>

<template>
  <div class="pm-view-page">
    <!-- 加载中 -->
    <div v-if="loading" class="pm-loading">
      <div class="dt-page-spinner"></div>
      <p style="margin-top:16px; color:#86909C; font-size:14px;">正在加载中...</p>
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="pm-error">
      <div class="pm-error-icon">🔗</div>
      <h2>{{ isPersonalProductView ? '无法查看产品经理工时' : '链接无效' }}</h2>
      <p>{{ error }}</p>
    </div>

    <template v-else-if="isBlocked">
      <div class="pm-blocked-shell"></div>
      <el-dialog
        :model-value="true"
        width="380px"
        align-center
        append-to-body
        :show-close="false"
        :close-on-click-modal="false"
        :close-on-press-escape="false"
        class="pm-blocked-dialog"
      >
        <div class="pm-blocked-content">
          <div class="pm-blocked-title">{{ blockMessage }}</div>
        </div>
      </el-dialog>
    </template>

    <!-- 数据 -->
    <template v-else-if="pmData">
      <!-- 头部 -->
      <div class="pm-header">
        <div class="pm-avatar">{{ pmData.pm.name.charAt(pmData.pm.name.length - 1) }}</div>
        <div class="pm-info">
          <h1 class="pm-name">{{ pmData.pm.name }}<span class="pm-badge">AI产品经理</span></h1>
        </div>
        <div class="pm-stats">
          <div class="pm-stat-item">
            <span class="pm-stat-val">{{ pmData.totalHours?.toFixed(1) || '0' }}</span>
            <span class="pm-stat-label">总工时</span>
          </div>
          <div class="pm-stat-divider"></div>
          <template v-if="!isPersonalProductView"><div v-for="role in roleStore.list" :key="role.key" class="pm-stat-item" :style="{ color: role.color }">
            <span class="pm-stat-val">{{ Number(roleSummary[role.key] || 0).toFixed(1) }}</span>
            <span class="pm-stat-label">{{ role.short_name }}</span>
          </div><div class="pm-stat-divider"></div></template>
          <div class="pm-stat-item">
            <span class="pm-stat-val">{{ pmData.totalRecords || 0 }}</span>
            <span class="pm-stat-label">{{ isPersonalProductView ? '记录数' : '需求数' }}</span>
          </div>
          <div class="pm-stat-item">
            <span class="pm-stat-val">{{ isPersonalProductView ? sortedTasks.length : pmData.tasks?.length || 0 }}</span>
            <span class="pm-stat-label">{{ isPersonalProductView ? '有记录周期' : '周期' }}</span>
          </div>
        </div>
      </div>


      <!-- 筛选栏 -->
      <div class="pm-filter" @keydown.enter="handleSearch">
        <el-select v-model="filterYear" :style="{ width: isPersonalProductView ? '105px' : '85px' }" size="small" aria-label="统计年份">
          <el-option v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="filterQuarter" style="width:80px;" size="small" aria-label="统计季度">
          <el-option v-for="q in QUARTER_OPTIONS" :key="q.value" :label="q.label" :value="q.value" />
        </el-select>
        <el-select v-if="isPersonalProductView" v-model="filterTaskId" class="pm-period-select" size="small" aria-label="统计周期">
          <el-option label="范围内全部周期" value="all" />
          <el-option v-for="task in personalTaskOptions" :key="task.id" :label="task.title || `${task.start_date} ~ ${task.end_date}`" :value="String(task.id)" />
        </el-select>
        <el-select v-else v-model="filterMonth" style="width:95px;" size="small">
          <el-option v-for="m in MONTH_OPTIONS" :key="m.value" :label="m.label" :value="m.value" />
        </el-select>
        <el-button type="primary" size="small" @click="handleSearch">🔍 搜索</el-button>
        <el-button
          :type="isFullYear ? 'warning' : 'default'"
          size="small"
          @click="toggleFullYear"
        >{{ isFullYear ? '📅 恢复当前' : '📆 全年展示' }}</el-button>

        <div style="flex:1;"></div>

        <!-- 周期排序 -->
        <span style="font-size:12px; color:#86909C; margin-right:4px;">周期排序：</span>
        <el-radio-group v-model="taskSortOrder" size="small">
          <el-radio-button value="desc">最新优先</el-radio-button>
          <el-radio-button value="asc">最早优先</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 任务列表 -->
      <div v-if="sortedTasks.length > 0" class="pm-task-grid">
        <div v-for="task in sortedTasks" :key="task.id" class="pm-task-card">
          <div class="pm-task-header">
            <span class="pm-task-title">{{ task.title }}</span>
            <span class="pm-task-dates">{{ task.start_date }} ~ {{ task.end_date }}</span>
          </div>
          <el-table
            :data="task.records"
            border
            size="small"
            style="width:100%;"
            table-layout="fixed"
          >
            <el-table-column type="index" label="#" width="32" align="center" />
            <el-table-column prop="version" label="版本" width="65" sortable>
              <template #default="{ row }">
                <span style="font-family:monospace; font-size:11px; white-space:nowrap;">{{ row.version || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="requirement_title" label="需求标题" min-width="140" show-overflow-tooltip sortable />
            <el-table-column v-if="isPersonalProductView" prop="demandSourcesLabel" label="需求方" min-width="100" show-overflow-tooltip sortable />
            <el-table-column prop="staffName" label="人员" width="65" align="center" sortable />
            <el-table-column v-if="!isPersonalProductView" prop="role" label="角色" width="55" align="center" sortable>
              <template #default="{ row }">
                <span v-if="row.role && row.role !== '-'"
                  :style="{
                    display:'inline-flex', alignItems:'center', justifyContent:'center',
                    padding:'1px 5px', borderRadius:'9999px',
                    minWidth:'42px', lineHeight:'16px', whiteSpace:'nowrap',
                    fontSize:'10px', fontWeight:'500',
                    ...roleTagStyle(row.role)
                  }"
                >{{ roleLabel(row.role, true) }}</span>
                <span v-else style="color:#C9CDD4;">-</span>
              </template>
            </el-table-column>
            <el-table-column prop="hours" label="工时" width="80" align="center" sortable
              :sort-method="(a, b) => parseFloat(a.hours||0) - parseFloat(b.hours||0)"
            >
              <template #default="{ row }">
                <div class="hours-cell" :class="MEDAL_CLASS[getMedalRank(task.records, row.hours)] || ''">
                  <span class="hours-val">{{ parseFloat(row.hours || 0).toFixed(1) }}</span>
                  <span v-if="getMedalRank(task.records, row.hours) >= 0" class="medal-badge">
                    {{ MEDAL_EMOJI[getMedalRank(task.records, row.hours)] }}
                  </span>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <div v-else class="pm-empty">
        <div class="pm-empty-icon">📊</div>
        <p>{{ isPersonalProductView ? '当前筛选范围暂无本人填报工时' : '当前筛选范围暂无需求数据' }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pm-view-page {
  max-width: 100%;
  margin: 0 auto;
  padding: 12px 15px;
  font-family: 'Inter', 'Microsoft YaHei', sans-serif;
}

.pm-loading, .pm-error {
  display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px;
}
.pm-blocked-shell {
  min-height: 70vh;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #F2F3F5;
}
.pm-blocked-content {
  padding: 18px 8px 22px;
  text-align: center;
}
.pm-blocked-title {
  font-size: 18px;
  font-weight: 700;
  color: #1D2129;
  line-height: 1.6;
}
.pm-error-icon { font-size: 48px; margin-bottom: 16px; }
.pm-error h2 { font-size: 20px; color: #1D2129; margin-bottom: 8px; }
.pm-error p { font-size: 14px; color: #86909C; }

/* === 头部 === */
.pm-header {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px; margin-bottom: 10px; color: #fff;
  box-shadow: 0 3px 10px rgba(102, 126, 234, 0.25);
}
.pm-avatar {
  width: 38px; height: 38px; border-radius: 50%;
  background: rgba(255,255,255,0.2);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; flex-shrink: 0;
}
.pm-info { flex: 1; }
.pm-name {
  font-size: 16px; font-weight: 700; margin: 0;
  display: flex; align-items: center; gap: 8px;
}
.pm-badge {
  font-size: 10px; font-weight: 500; padding: 1px 7px;
  border-radius: 9999px; background: rgba(255,255,255,0.2);
}
.pm-stats { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.pm-stat-item { display: flex; flex-direction: column; align-items: center; }
.pm-stat-val { font-size: 17px; font-weight: 700; line-height: 1.2; }
.pm-stat-label { font-size: 10px; opacity: 0.7; }
.pm-stat-divider { width: 1px; height: 24px; background: rgba(255,255,255,0.2); }
.pm-stat-fe .pm-stat-val { color: #93C5FD; }
.pm-stat-be .pm-stat-val { color: #86EFAC; }
.pm-stat-te .pm-stat-val { color: #FDE68A; }

@media (max-width: 900px) {
  .pm-header { align-items: flex-start; flex-wrap: wrap; }
  .pm-info { min-width: 120px; }
  .pm-stats { width: 100%; justify-content: space-between; gap: 8px; overflow-x: auto; }
}

/* === 筛选 === */
.pm-filter {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 10px; flex-wrap: wrap;
}
.pm-period-select { width: 230px; max-width: 100%; }

/* === 网格 === */
.pm-task-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
}
@media (max-width: 1000px) { .pm-task-grid { grid-template-columns: 1fr; } }
@media (min-width: 1600px) { .pm-task-grid { grid-template-columns: repeat(3, 1fr); } }

.pm-task-card {
  background: #fff; border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
  overflow: hidden; border: 1px solid #F2F3F5;
}
.pm-task-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 10px; background: #FAFBFC; border-bottom: 1px solid #F2F3F5;
}
.pm-task-title { font-weight: 600; font-size: 12px; color: #1D2129; }
.pm-task-dates { font-size: 11px; color: #86909C; }

.pm-empty { text-align: center; padding: 60px; color: #86909C; }
.pm-empty-icon { font-size: 40px; margin-bottom: 12px; }

/* ===== 金银铜牌角标 ===== */
.hours-cell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  padding: 2px 6px;
  border-radius: 6px;
  transition: all 0.3s;
}
.hours-val {
  font-weight: 700; font-size: 12px; color: #165DFF;
}

/* 奖牌角标 */
.medal-badge {
  position: absolute;
  top: -8px; right: -10px;
  font-size: 14px;
  animation: medalPulse 2s ease-in-out infinite;
  filter: drop-shadow(0 0 4px rgba(255, 215, 0, 0.6));
  z-index: 2;
}

/* 金牌 */
.medal-gold {
  background: linear-gradient(135deg, #FFF8E1 0%, #FFE082 50%, #FFF8E1 100%);
  background-size: 200% 200%;
  animation: goldShimmer 3s ease-in-out infinite;
  box-shadow: 0 0 8px rgba(255, 193, 7, 0.4), inset 0 0 4px rgba(255, 215, 0, 0.2);
}
.medal-gold .hours-val { color: #B7791F; font-weight: 800; }
.medal-gold .medal-badge { filter: drop-shadow(0 0 6px rgba(255, 215, 0, 0.8)); }

/* 银牌 */
.medal-silver {
  background: linear-gradient(135deg, #F5F5F5 0%, #E0E0E0 50%, #F5F5F5 100%);
  background-size: 200% 200%;
  animation: silverShimmer 3s ease-in-out infinite;
  box-shadow: 0 0 6px rgba(158, 158, 158, 0.3), inset 0 0 3px rgba(192, 192, 192, 0.3);
}
.medal-silver .hours-val { color: #546E7A; font-weight: 800; }
.medal-silver .medal-badge { filter: drop-shadow(0 0 4px rgba(192, 192, 192, 0.8)); }

/* 铜牌 */
.medal-bronze {
  background: linear-gradient(135deg, #FFF3E0 0%, #FFCC80 50%, #FFF3E0 100%);
  background-size: 200% 200%;
  animation: bronzeShimmer 3s ease-in-out infinite;
  box-shadow: 0 0 6px rgba(255, 152, 0, 0.3), inset 0 0 3px rgba(205, 127, 50, 0.2);
}
.medal-bronze .hours-val { color: #8D5524; font-weight: 800; }
.medal-bronze .medal-badge { filter: drop-shadow(0 0 4px rgba(205, 127, 50, 0.8)); }

/* 动画 */
@keyframes goldShimmer {
  0%, 100% { background-position: 0% 50%; box-shadow: 0 0 8px rgba(255, 193, 7, 0.3); }
  50% { background-position: 100% 50%; box-shadow: 0 0 16px rgba(255, 193, 7, 0.6), 0 0 24px rgba(255, 215, 0, 0.2); }
}
@keyframes silverShimmer {
  0%, 100% { background-position: 0% 50%; box-shadow: 0 0 6px rgba(158, 158, 158, 0.2); }
  50% { background-position: 100% 50%; box-shadow: 0 0 12px rgba(158, 158, 158, 0.4), 0 0 20px rgba(192, 192, 192, 0.15); }
}
@keyframes bronzeShimmer {
  0%, 100% { background-position: 0% 50%; box-shadow: 0 0 6px rgba(255, 152, 0, 0.2); }
  50% { background-position: 100% 50%; box-shadow: 0 0 12px rgba(255, 152, 0, 0.4), 0 0 20px rgba(205, 127, 50, 0.15); }
}
@keyframes medalPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}
</style>
