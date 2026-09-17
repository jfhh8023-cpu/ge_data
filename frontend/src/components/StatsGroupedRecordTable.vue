<script setup>
import { computed, ref, watch } from 'vue'
import { ElRadioButton, ElRadioGroup, ElTable, ElTableColumn } from 'element-plus'
import { recordSource, recordStaffId, sortStatsRows, uniqueStatsRecords } from '../utils/statsTable.js'
import { latestCreatedAt, sortRecordsByCreatedAt } from '../utils/recordOrder.js'
import { roleLabel, roleTagStyle } from '../utils/roles.js'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  maxHeight: { type: [String, Number], default: 560 }
})
const emit = defineEmits(['sort-change'])
const defaultSort = () => ({ prop: 'created_at', order: 'descending' })
const localSort = ref(defaultSort())
const selectedGroup = ref('')
const tableRef = ref(null)
const medals = ['🥇', '🥈', '🥉']
const medalClasses = ['medal-gold', 'medal-silver', 'medal-bronze']
const numericText = value => String(Number(Number(value || 0).toFixed(2)))
const versionText = value => {
  const text = String(value ?? '').trim()
  return text && text !== '-' ? text : '-'
}

function managerNames(row) {
  let managers = row.product_managers
  if (typeof managers === 'string') {
    try {
      managers = JSON.parse(managers)
      if (typeof managers === 'string') managers = JSON.parse(managers)
    } catch { managers = undefined }
  }
  if (!Array.isArray(managers)) managers = String(row.pmNames || '').split('、')
  return [...new Set(managers.filter(name => typeof name === 'string')
    .map(name => name.trim()).filter(name => name && name !== '-' && name !== '—' && Number.isNaN(Number(name))))]
}

const groupedRecords = computed(() => {
  const groups = new Map()
  const records = uniqueStatsRecords(props.rows.filter(row => row && !row.isTotalRow))
  for (const [index, record] of records.entries()) {
    const product = recordSource(record) === 'product_manager'
    const managers = managerNames(record)
    const staffName = record.staffName || record.staff?.name || record.staff_name || '-'
    const pmName = product ? staffName : managers[0] || '不在上述'
    const groupKey = product ? `product:${recordStaffId(record) || staffName}` : `engineering:${pmName}`
    if (!groups.has(groupKey)) groups.set(groupKey, { groupKey, pmName, records: [] })
    groups.get(groupKey).records.push({
      ...record,
      groupKey, pmName, staffName,
      managerTooltip: product ? `${staffName}（AI产品经理本人填报）` : managers.length ? `全部归属：${managers.join('、')}` : '不在上述',
      version: versionText(record.version),
      requirement_title: record.requirement_title || '-',
      roleRaw: record.staff?.role || record.role || '',
      roleLabel: record.roleLabel || roleLabel(record.staff?.role || record.role, true),
      hours: Number(record.hours),
      tableRowKey: JSON.stringify(['record', recordSource(record), record.id || index]),
      isTotalRow: false
    })
  }
  const list = [...groups.values()].map(group => ({ ...group, created_at: latestCreatedAt(group.records) }))
  return localSort.value.prop === 'pmName'
    ? sortStatsRows(list, localSort.value) : sortRecordsByCreatedAt(list)
})

function mergeConsecutive(rows, spanField, sameValue) {
  let start = 0
  while (start < rows.length) {
    let end = start + 1
    while (end < rows.length && sameValue(rows[start], rows[end])) end += 1
    rows[start][spanField] = end - start
    for (let index = start + 1; index < end; index += 1) rows[index][spanField] = 0
    start = end
  }
}

const displayRows = computed(() => {
  const result = []
  let sequence = 0
  for (const group of groupedRecords.value) {
    const byCreation = sortRecordsByCreatedAt(group.records)
    const sorted = localSort.value.prop === 'created_at' && localSort.value.order === 'descending'
      ? byCreation : sortStatsRows(byCreation, localSort.value)
    const topHours = [...new Set(sorted.map(row => row.hours).filter(hours => hours > 0))].sort((a, b) => b - a).slice(0, 3)
    const realRows = sorted.map((row, index) => ({
      ...row,
      sequence: ++sequence,
      pmRowSpan: index === 0 ? sorted.length + 1 : 0,
      versionRowSpan: 1,
      requirementRowSpan: 1,
      medalRank: row.hours > 0 ? topHours.indexOf(row.hours) : -1
    }))
    mergeConsecutive(realRows, 'versionRowSpan', (left, right) => left.version !== '-' && left.version === right.version)
    mergeConsecutive(realRows, 'requirementRowSpan', (left, right) => left.requirement_title !== '-'
      && left.requirement_title === right.requirement_title && left.version === right.version)
    result.push(...realRows, {
      groupKey: group.groupKey, pmName: group.pmName, pmRowSpan: 0,
      tableRowKey: JSON.stringify(['total', group.groupKey]),
      pmTotal: Number(realRows.reduce((sum, row) => sum + row.hours, 0).toFixed(2)),
      isTotalRow: true
    })
  }
  return result
})

const orderPreset = computed(() => localSort.value.prop === 'hours'
  ? localSort.value.order === 'ascending' ? 'asc' : 'desc'
  : localSort.value.prop === 'created_at' ? '' : null)

function changeSort({ prop, order }) {
  localSort.value = prop && order ? { prop, order } : defaultSort()
  emit('sort-change', { ...localSort.value })
}
function changePreset(value) {
  if (value) tableRef.value?.sort('hours', value === 'asc' ? 'ascending' : 'descending')
  else {
    tableRef.value?.clearSort()
    changeSort(defaultSort())
  }
}
watch(groupedRecords, groups => {
  if (selectedGroup.value && !groups.some(group => group.groupKey === selectedGroup.value)) selectedGroup.value = ''
})

function spanMethod({ row, columnIndex }) {
  if (columnIndex === 1) return { rowspan: row.pmRowSpan, colspan: row.pmRowSpan ? 1 : 0 }
  if (row.isTotalRow) {
    if (columnIndex === 2) return { rowspan: 1, colspan: 5 }
    if (columnIndex > 2) return { rowspan: 0, colspan: 0 }
    return { rowspan: 1, colspan: 1 }
  }
  const span = columnIndex === 2 ? row.versionRowSpan : columnIndex === 3 ? row.requirementRowSpan : 1
  return { rowspan: span, colspan: span ? 1 : 0 }
}
function rowClassName({ row }) {
  return [row.isTotalRow ? 'dt-total-row total-row' : 'dt-real-row real-row',
    selectedGroup.value === row.groupKey ? 'dt-row-selected' : ''].filter(Boolean).join(' ')
}
</script>

<template>
  <section class="dt-grouped-records" data-testid="stats-grouped-record-table">
    <div v-if="displayRows.length" class="dt-grouped-sort-toolbar">
      <span>AI产品经理内数据排序：</span>
      <ElRadioGroup :model-value="orderPreset" size="small" aria-label="AI产品经理内数据排序" @change="changePreset">
        <ElRadioButton value="">按新增顺序</ElRadioButton>
        <ElRadioButton value="desc">工时降序 ↓</ElRadioButton>
        <ElRadioButton value="asc">工时升序 ↑</ElRadioButton>
      </ElRadioGroup>
    </div>
    <ElTable ref="tableRef" :data="displayRows" row-key="tableRowKey" :span-method="spanMethod"
      :row-class-name="rowClassName" :max-height="maxHeight"
      border class="dt-grouped-record-table" empty-text="所选周期暂无统计数据" @sort-change="changeSort">
      <ElTableColumn label="序号" width="60" align="center">
        <template #default="{ row }">
          <span :data-testid="row.isTotalRow ? 'total-row' : 'real-row'" :data-row-type="row.isTotalRow ? 'total-row' : 'real-row'"
            :data-record-id="row.isTotalRow ? undefined : row.id" :data-source="row.isTotalRow ? undefined : recordSource(row)"
            :data-hours="row.isTotalRow ? undefined : row.hours" :data-group-key="row.groupKey"
          >{{ row.isTotalRow ? '' : row.sequence }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="pmName" label="AI产品经理" width="145" align="center" sortable="custom">
        <template #default="{ row }">
          <button type="button" class="dt-grouped-pm-button" :aria-pressed="selectedGroup === row.groupKey"
            :title="row.managerTooltip" :aria-label="`高亮${row.pmName}的工时记录`"
            @click="selectedGroup = selectedGroup === row.groupKey ? '' : row.groupKey">{{ row.pmName }}</button>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="version" label="版本号" width="120" sortable="custom">
        <template #default="{ row }">
          <div v-if="row.isTotalRow" class="dt-grouped-total" :data-total-hours="row.pmTotal" :data-group-key="row.groupKey">
            <span>合计</span><strong>{{ numericText(row.pmTotal) }}小时</strong>
          </div>
          <span v-else class="dt-grouped-version">{{ row.version }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="requirement_title" label="需求名称" min-width="240" align="left" header-align="center" sortable="custom">
        <template #default="{ row }"><span class="dt-grouped-requirement" :title="row.managerTooltip">{{ row.requirement_title }}</span></template>
      </ElTableColumn>
      <ElTableColumn prop="staffName" label="人员" width="110" align="center" sortable="custom" />
      <ElTableColumn prop="roleLabel" label="角色" width="100" align="center" sortable="custom">
        <template #default="{ row }"><span class="dt-grouped-role" :style="roleTagStyle(row.roleRaw)">{{ row.roleLabel || '-' }}</span></template>
      </ElTableColumn>
      <ElTableColumn prop="hours" label="工时/小时" width="125" align="center" sortable="custom">
        <template #default="{ row }">
          <div class="hours-cell" :class="medalClasses[row.medalRank] || ''">
            <span class="hours-val">{{ numericText(row.hours) }}</span>
            <span v-if="row.medalRank >= 0" class="medal-badge" :aria-label="`组内工时第${row.medalRank + 1}名`">{{ medals[row.medalRank] }}</span>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>
  </section>
</template>

<style scoped>
.dt-grouped-records { min-width: 0; width: 100%; }
.dt-grouped-sort-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 12px 16px; color: var(--color-text-2, #4E5969); font-size: 13px; }
.dt-grouped-record-table { width: 100%; }
.dt-grouped-pm-button { max-width: 100%; padding: 4px; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-weight: 600; line-height: 1.6; white-space: normal; overflow-wrap: anywhere; }
.dt-grouped-pm-button:hover, .dt-grouped-pm-button[aria-pressed="true"] { color: var(--color-primary, #165DFF); }
.dt-grouped-pm-button:focus-visible { outline: 2px solid var(--color-primary, #165DFF); outline-offset: 2px; }
.dt-grouped-version { font-family: var(--font-mono, monospace); overflow-wrap: anywhere; }
.dt-grouped-requirement { display: block; font-weight: 500; white-space: normal; overflow-wrap: anywhere; }
.dt-grouped-role { display: inline-block; padding: 2px 5px; border: 1px solid; border-radius: 4px; font-size: 12px; }
.dt-grouped-total { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; font-weight: 700; }
.dt-grouped-total strong { color: var(--color-primary, #165DFF); font-size: 15px; }
.dt-grouped-record-table :deep(.dt-total-row) { --el-table-tr-bg-color: #F7F9FC; }
.dt-grouped-record-table :deep(.dt-row-selected) { --el-table-tr-bg-color: #E8F3FF; --el-table-row-hover-bg-color: #DCEBFF; }
.hours-cell { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 48px; padding: 3px 6px; border-radius: 5px; }
.hours-val { color: #165DFF; font-weight: 700; font-variant-numeric: tabular-nums; }
.medal-badge { font-size: 14px; }
.medal-gold { background: #FFF4CC; }
.medal-silver { background: #EEF1F5; }
.medal-bronze { background: #FFEADB; }
</style>
