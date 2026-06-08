<script setup>
/**
 * PmViewPage.vue — 产品经理专属查看页
 * v3.2.1: 搜索按钮 + 周期排序 + 角色工时 + 金银铜牌闪光角标
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
import { ElMessage } from 'element-plus'

const route = useRoute()
const token = computed(() => route.params.token)

const loading = ref(true)
const error = ref('')
const pmData = ref(null)

/* ========== 筛选状态 ========== */
const now = new Date()
const CURRENT_YEAR = now.getFullYear()
const CURRENT_QUARTER = Math.ceil((now.getMonth() + 1) / 3)
const CURRENT_MONTH = now.getMonth() + 1

// 支持从路由 query 参数初始化筛选条件（如从"查看全部"跳转）
const initYear = route.query.year ? parseInt(route.query.year) : CURRENT_YEAR
const initQuarter = route.query.quarter !== undefined ? parseInt(route.query.quarter) : CURRENT_QUARTER
const initMonth = route.query.month !== undefined ? parseInt(route.query.month) : 0

const filterYear = ref(initYear)
const filterQuarter = ref(initQuarter)
const filterMonth = ref(initMonth)
const yearOptions = computed(() => {
  const years = []
  for (let y = CURRENT_YEAR + 1; y >= CURRENT_YEAR - 2; y--) years.push(y)
  return years
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
  const arr = [...pmData.value.tasks]
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

const ROLE_LABEL = { frontend: '前端', backend: '后端', test: '测试' }
const ROLE_TAG_STYLE = {
  frontend: { background: '#E8F3FF', color: '#165DFF' },
  backend: { background: '#E8FFEA', color: '#00B42A' },
  test: { background: '#FFF7E8', color: '#FF7D00' }
}

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

async function handleSearch() {
  loading.value = true
  error.value = ''
  try {
    const params = { year: filterYear.value }
    if (filterQuarter.value) params.quarter = filterQuarter.value
    if (filterMonth.value) params.month = filterMonth.value
    const res = await api.get(`/pm/view/${token.value}`, { params })
    pmData.value = res.data
  } catch (err) {
    const msg = err.response?.data?.message || '加载失败'
    error.value = msg
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

/* ========== 全年展示切换 ========== */
const isFullYear = ref(false)

function toggleFullYear() {
  if (isFullYear.value) {
    // 恢复当前年季月
    filterYear.value = CURRENT_YEAR
    filterQuarter.value = CURRENT_QUARTER
    filterMonth.value = CURRENT_MONTH
    isFullYear.value = false
  } else {
    // 切换到全年
    filterYear.value = CURRENT_YEAR
    filterQuarter.value = 0
    filterMonth.value = 0
    isFullYear.value = true
  }
  handleSearch()
}

const roleSummary = computed(() => pmData.value?.roleSummary || { frontend: 0, backend: 0, test: 0 })
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
      <h2>链接无效</h2>
      <p>{{ error }}</p>
    </div>

    <!-- 数据 -->
    <template v-else-if="pmData">
      <!-- 头部 -->
      <div class="pm-header">
        <div class="pm-avatar">{{ pmData.pm.name.charAt(pmData.pm.name.length - 1) }}</div>
        <div class="pm-info">
          <h1 class="pm-name">{{ pmData.pm.name }}<span class="pm-badge">产品经理</span></h1>
        </div>
        <div class="pm-stats">
          <div class="pm-stat-item">
            <span class="pm-stat-val">{{ pmData.totalHours?.toFixed(1) || '0' }}</span>
            <span class="pm-stat-label">总工时</span>
          </div>
          <div class="pm-stat-divider"></div>
          <div class="pm-stat-item pm-stat-fe">
            <span class="pm-stat-val">{{ roleSummary.frontend.toFixed(1) }}</span>
            <span class="pm-stat-label">前端</span>
          </div>
          <div class="pm-stat-item pm-stat-be">
            <span class="pm-stat-val">{{ roleSummary.backend.toFixed(1) }}</span>
            <span class="pm-stat-label">后端</span>
          </div>
          <div class="pm-stat-item pm-stat-te">
            <span class="pm-stat-val">{{ roleSummary.test.toFixed(1) }}</span>
            <span class="pm-stat-label">测试</span>
          </div>
          <div class="pm-stat-divider"></div>
          <div class="pm-stat-item">
            <span class="pm-stat-val">{{ pmData.totalRecords || 0 }}</span>
            <span class="pm-stat-label">需求数</span>
          </div>
          <div class="pm-stat-item">
            <span class="pm-stat-val">{{ pmData.tasks?.length || 0 }}</span>
            <span class="pm-stat-label">周期</span>
          </div>
        </div>
      </div>

      <!-- 筛选栏 -->
      <div class="pm-filter" @keydown.enter="handleSearch">
        <el-select v-model="filterYear" style="width:85px;" size="small">
          <el-option v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="filterQuarter" style="width:80px;" size="small">
          <el-option v-for="q in QUARTER_OPTIONS" :key="q.value" :label="q.label" :value="q.value" />
        </el-select>
        <el-select v-model="filterMonth" style="width:95px;" size="small">
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
            :default-sort="{ prop: 'hours', order: 'descending' }"
          >
            <el-table-column type="index" label="#" width="32" align="center" />
            <el-table-column prop="version" label="版本" width="65" sortable>
              <template #default="{ row }">
                <span style="font-family:monospace; font-size:11px; white-space:nowrap;">{{ row.version || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="requirement_title" label="需求标题" min-width="140" show-overflow-tooltip sortable />
            <el-table-column prop="staffName" label="人员" width="65" align="center" sortable />
            <el-table-column prop="role" label="角色" width="55" align="center" sortable>
              <template #default="{ row }">
                <span v-if="row.role && row.role !== '-'"
                  :style="{
                    display:'inline-block', padding:'1px 5px', borderRadius:'9999px',
                    fontSize:'10px', fontWeight:'500',
                    ...(ROLE_TAG_STYLE[row.role] || {background:'#F2F3F5',color:'#86909C'})
                  }"
                >{{ ROLE_LABEL[row.role] || row.role }}</span>
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
        <p>当前筛选范围暂无需求数据</p>
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

/* === 筛选 === */
.pm-filter {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 10px; flex-wrap: wrap;
}

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
