<script setup>
import { computed } from 'vue'
import { normalizeRole, roleLabel, ROLE_AI_PM } from '../utils/roles'

const props = defineProps({
  modelValue: Boolean,
  people: { type: Array, default: () => [] },
  scopeLabel: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])
const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})
const title = computed(() => `部门人员${props.scopeLabel ? ` · ${props.scopeLabel}` : ''}`)
const peopleRows = computed(() => {
  const uniquePeople = new Map()
  for (const person of props.people) {
    if (!person || person.staffId === null || person.staffId === undefined) continue
    const key = String(person.staffId)
    if (!key || uniquePeople.has(key)) continue
    const role = normalizeRole(person.role, '')
    uniquePeople.set(key, {
      staffId: key,
      staffName: person.staffName || '-',
      role,
      roleLabel: roleLabel(role)
    })
  }
  return [...uniquePeople.values()]
})
const groups = computed(() => [
  { key: 'engineering', label: '研发人员', rows: peopleRows.value.filter(person => person.role !== ROLE_AI_PM) },
  { key: 'product', label: '产品人员', rows: peopleRows.value.filter(person => person.role === ROLE_AI_PM) }
])
const total = computed(() => groups.value.reduce((sum, group) => sum + group.rows.length, 0))
const compareNames = (a, b) => a.staffName.localeCompare(b.staffName, 'zh-CN')
const compareRoles = (a, b) => a.roleLabel.localeCompare(b.roleLabel, 'zh-CN') || compareNames(a, b)
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="min(900px, calc(100vw - 32px))" top="6vh" append-to-body class="department-people-dialog">
    <div class="department-people-total" data-testid="department-people-total">
      总人数 <strong>{{ total }}</strong> 人
      <span>＝研发 {{ groups[0].rows.length }} 人＋产品 {{ groups[1].rows.length }} 人</span>
    </div>
    <div class="department-people-columns">
      <section v-for="group in groups" :key="group.key" class="department-people-group" :data-people-group="group.key" :aria-label="group.label">
        <h3>{{ group.label }}<span>{{ group.rows.length }} 人</span></h3>
        <el-table :data="group.rows" row-key="staffId" size="small" border :max-height="'min(48vh, 440px)'" :empty-text="`当前范围暂无${group.label}`">
          <el-table-column prop="staffName" label="姓名" min-width="95" sortable :sort-method="compareNames" show-overflow-tooltip />
          <el-table-column prop="roleLabel" label="岗位" min-width="135" sortable :sort-method="compareRoles" show-overflow-tooltip />
        </el-table>
      </section>
    </div>
  </el-dialog>
</template>

<style scoped>
.department-people-total { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; margin-bottom: 12px; color: #475467; font-size: 13px; }
.department-people-total strong { color: #165dff; font-size: 22px; }
.department-people-total > span { color: #86909c; font-size: 12px; }
.department-people-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; min-width: 0; }
.department-people-group { min-width: 0; }
.department-people-group h3 { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 8px; color: #344054; font-size: 14px; }
.department-people-group h3 > span { color: #667085; font-size: 12px; font-weight: 400; }
:global(.el-dialog.department-people-dialog) { display: flex; flex-direction: column; max-height: 88dvh; overflow: hidden; border-radius: 10px; }
:global(.department-people-dialog > .el-dialog__header) { flex-shrink: 0; }
:global(.department-people-dialog > .el-dialog__body) { min-height: 0; overflow-y: auto; }
@media (max-width: 600px) {
  .department-people-columns { grid-template-columns: minmax(0, 1fr); gap: 14px; }
}
</style>
