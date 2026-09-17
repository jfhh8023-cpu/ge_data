<script setup>
import { computed, ref } from 'vue'
import StatsRecordTable from './StatsRecordTable.vue'
import { sortStatsRows } from '../utils/statsTable'
const props = defineProps({
  rows: { type: Array, default: () => [] },
  tasks: { type: Array, default: () => [] },
  maxHeight: { type: [Number, String], default: 'max(180px, calc(80vh - 275px))' },
  recordOnly: Boolean,
  externalSort: Boolean,
  sortState: { type: Object, default: null }
})
const emit = defineEmits(['sort-change'])
const localSort = ref(props.sortState ? { ...props.sortState } : {})
const displayRows = computed(() => props.externalSort ? props.rows : sortStatsRows(props.rows, localSort.value))
function changeSort({ prop, order }) {
  const sort = { prop, order }
  if (!props.externalSort) localSort.value = sort
  emit('sort-change', sort)
}
const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
</script>

<template>
  <el-table :data="displayRows" :default-sort="sortState || undefined" border size="small" :max-height="maxHeight" empty-text="当前范围暂无需求记录" @sort-change="changeSort">
    <el-table-column type="expand" width="40"><template #default="{ row }"><div class="progress-records"><StatsRecordTable :rows="row.records" :tasks="tasks" :max-height="280" :record-only="row.versionType === '无版本号'" /></div></template></el-table-column>
    <el-table-column prop="person" label="人员" width="110" sortable="custom" />
    <el-table-column prop="role" label="岗位" width="105" sortable="custom" />
    <el-table-column prop="versionType" label="版本分组" width="100" sortable="custom" />
    <el-table-column prop="weeks" label="周" width="80" sortable="custom"><template #default="{ row }">{{ row.weeks?.join('、') || '-' }}</template></el-table-column>
    <el-table-column prop="version" label="版本号" width="115" sortable="custom"><template #default="{ row }">{{ row.versionType === '无版本号' ? '无版本号' : row.version }}</template></el-table-column>
    <el-table-column prop="requirement" label="需求" min-width="210" show-overflow-tooltip sortable="custom" />
    <el-table-column prop="hours" label="工时/h" width="90" align="right" sortable="custom" />
    <el-table-column v-if="!recordOnly" prop="deliveredHours" label="有效已交付/h" width="130" align="right" sortable="custom" />
    <el-table-column v-if="!recordOnly" prop="deliveryRate" label="有效交付率" width="120" sortable="custom"><template #default="{ row }"><span :title="`有效已交付${row.deliveredHours}h÷该人员所属周期应交付${row.standardHours}h`">{{ row.versionType === '无版本号' || row.deliveryRate == null ? '—' : `${row.deliveryRate}%` }}</span></template></el-table-column>
    <el-table-column v-if="!recordOnly" prop="progress" label="需求进度 / 状态" width="145" sortable="custom"><template #default="{ row }">
      <span v-if="row.fullCredit" class="record-only">不适用</span>
      <span v-else-if="row.versionType === '无版本号'" class="record-only">仅记录，不计交付率</span>
      <span v-else :class="{ 'is-complete': row.completed }" title="同人员、版本、标题取所选范围内最新周期填写的累计进度；缺失保持未知。">{{ row.progress == null ? '未填写' : `${row.progress}%` }}{{ row.completed ? ' · 已完成' : '' }}</span>
    </template></el-table-column>
    <el-table-column prop="created_at" label="最新创建时间" width="175" sortable="custom"><template #default="{ row }">{{ date(row.created_at) }}</template></el-table-column>
  </el-table>
</template>

<style scoped>
.progress-records { padding: 8px 12px; }
.is-complete { color: #146c2e; background: #e8f7ee; padding: 2px 5px; border-radius: 4px; font-weight: 700; }
.record-only { color: #86909c; font-size: 11px; }
</style>
