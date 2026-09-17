<script setup>
import { onBeforeUnmount, ref } from 'vue'
const narrowScreen = window.matchMedia('(max-width: 600px)')
const compact = ref(narrowScreen.matches)
const updateCompact = event => { compact.value = event.matches }
narrowScreen.addEventListener('change', updateCompact)
onBeforeUnmount(() => narrowScreen.removeEventListener('change', updateCompact))
defineProps({ modelValue: Boolean, scopeLabel: { type: String, default: '' }, rows: { type: Array, default: () => [] } })
defineEmits(['update:modelValue'])
</script>

<template>
  <el-dialog :model-value="modelValue" title="跨周期未完成需求" width="min(1040px, 94vw)" top="10vh" class="incomplete-requirements-dialog" append-to-body @update:model-value="$emit('update:modelValue', $event)">
    <p class="incomplete-scope">{{ scopeLabel }} · {{ rows.length }} 项未完成需求</p>
    <el-table :data="rows" row-key="key" border size="small" :max-height="460" :default-sort="{ prop: 'periodEnd', order: 'descending' }" empty-text="当前范围暂无未完成需求">
      <el-table-column prop="periodEnd" label="周次" :width="compact ? 78 : 138" sortable><template #default="{ row }">{{ row.weekLabel }}</template></el-table-column>
      <el-table-column prop="staffName" label="人员" :width="compact ? 62 : 100" sortable />
      <el-table-column prop="requirementTitle" label="需求" :min-width="compact ? 90 : 210" sortable><template #default="{ row }"><div class="incomplete-requirement" :title="row.requirementTitle"><span>{{ row.requirementTitle }}</span><small>{{ row.version }} · {{ row.roleLabel }}</small></div></template></el-table-column>
      <el-table-column prop="progress" label="当前进度" :width="compact ? 72 : 105" sortable align="right"><template #default="{ row }"><strong class="incomplete-progress">{{ row.progress }}%</strong></template></el-table-column>
    </el-table>
  </el-dialog>
</template>

<style scoped>
.incomplete-scope { margin: 0 0 12px; color: #667085; font-size: 12px; }
.incomplete-progress { color: #a66300; }
.incomplete-requirement { display: flex; flex-direction: column; gap: 3px; }
.incomplete-requirement > span { overflow-wrap: anywhere; }
.incomplete-requirement small { color: #86909c; }
@media (max-width: 600px) {
  :deep(.el-table .cell) { padding: 0 5px; font-size: 11px; overflow-wrap: anywhere; }
}
</style>
