<script setup>
import { computed, ref } from 'vue'
import { hasDeliveryVersion } from '../utils/deliverySummary'
import { recordTableRows, sortStatsRows } from '../utils/statsTable'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  tasks: { type: Array, default: () => [] },
  maxHeight: { type: [String, Number], default: 'max(180px, calc(80vh - 275px))' },
  recordOnly: Boolean,
  externalSort: Boolean,
  sortState: { type: Object, default: null }
})
const emit = defineEmits(['sort-change'])
const localSort = ref(props.sortState ? { ...props.sortState } : {})
const displayRows = computed(() => {
  const rows = recordTableRows(props.rows, props.tasks)
  return props.externalSort ? rows : sortStatsRows(rows, localSort.value)
})
const tasksById = computed(() => new Map(props.tasks.map(task => [String(task.id), task])))
function changeSort({ prop, order }) {
  const sort = { prop, order }
  if (!props.externalSort) localSort.value = sort
  emit('sort-change', sort)
}
const date = value => {
  const time = new Date(value)
  return value && Number.isFinite(time.getTime()) ? time.toLocaleString('zh-CN', { hour12: false }) : '-'
}
</script>

<template>
  <el-table :data="displayRows" :default-sort="sortState || undefined" border size="small" class="dt-delivery-records" :max-height="maxHeight" empty-text="当前范围暂无工时记录" @sort-change="changeSort">
    <el-table-column type="index" label="#" width="45" />
    <el-table-column prop="sourceLabel" label="来源" width="90" sortable="custom" />
    <el-table-column prop="staffName" label="人员" width="105" sortable="custom" />
    <el-table-column prop="roleLabel" label="岗位" width="100" sortable="custom" />
    <el-table-column prop="weekLabel" label="周期 / 周" width="100" sortable="custom"><template #default="{ row }"><span :title="tasksById.get(String(row.task_id))?.title || row.task_id">{{ row.weekLabel }}</span></template></el-table-column>
    <el-table-column prop="versionLabel" label="版本号" width="110" sortable="custom" />
    <el-table-column prop="requirement_title" label="需求" min-width="210" show-overflow-tooltip sortable="custom" />
    <el-table-column prop="demandSourcesLabel" label="需求方" min-width="120" sortable="custom" />
    <el-table-column prop="pmNames" label="AI产品经理归属" min-width="155" show-overflow-tooltip sortable="custom" />
    <el-table-column prop="hours" label="工时/h" width="85" align="right" sortable="custom" />
    <el-table-column v-if="!recordOnly" prop="deliveryRate" label="有效交付率" width="110" sortable="custom"><template #default="{ row }">
      <span v-if="!hasDeliveryVersion(row)" class="record-only">仅记录</span>
      <span v-else :class="{ 'is-complete': row.deliveryRate != null && row.deliveryRate >= 100 }" title="该条有效工时（有版本普通记录或五类工时）÷该人员所属周期工作日基准×100%">{{ row.deliveryRate == null ? '—' : `${row.deliveryRate}%` }}</span>
    </template></el-table-column>
    <el-table-column prop="created_at" label="创建时间" width="175" sortable="custom"><template #default="{ row }">{{ date(row.created_at) }}</template></el-table-column>
  </el-table>
</template>

<style scoped>
.dt-delivery-records { width: 100%; }
.is-complete { color: #146c2e; background: #e8f7ee; padding: 2px 5px; border-radius: 4px; font-weight: 700; }
.record-only { color: #86909c; }
</style>
