<script setup>
import { computed } from 'vue'
import { deliveryMetricTip, weightedRateText, requirementProgressText } from '../utils/deliverySummary'

const props = defineProps({
  people: { type: Array, default: () => [] },
  compact: Boolean,
  maxRows: { type: Number, default: 3 }
})
const visibleRows = computed(() => Math.max(1, Math.floor(Number(props.maxRows) || 3)))
const number = value => {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—'
}
const name = person => person.staffName || person.name || person.label || '-'
const rate = person => {
  if (person.calendarStatus === 'invalid_period' || !(Number(person.standardHours) > 0)
    || person.deliveryRate === null || person.deliveryRate === undefined || person.deliveryRate === '') return null
  const parsed = Number(person.deliveryRate)
  return Number.isFinite(parsed) ? parsed : null
}
</script>

<template>
  <div class="staff-delivery-list" :class="{ 'is-compact': compact }" :style="{ '--staff-visible-rows': visibleRows }" data-testid="staff-delivery-list">
    <div class="staff-delivery-viewport" tabindex="0" role="region" aria-label="人员交付明细，可上下滚动查看全部人员">
      <table v-if="people.length" class="staff-delivery-table">
        <colgroup><col class="staff-name-col" /><col class="staff-hours-col" /><col class="staff-hours-col" /><col class="staff-rate-col" /><col class="staff-rate-col" /><col class="staff-rate-col" /></colgroup>
        <thead><tr>
          <th scope="col">姓名</th>
          <th scope="col" title="应交付工时（小时）" aria-label="应交付工时，单位小时">应交付</th>
          <th scope="col" class="delivery-hours-heading" aria-label="有效已交付，单位小时">有效已交付</th>
          <th scope="col">有效交付率</th>
          <th scope="col">加权交付率</th>
          <th scope="col">需求进度</th>
        </tr></thead>
        <tbody><tr v-for="(person, index) in people" :key="person.staffId ?? index" :data-staff-id="person.staffId">
          <th scope="row" :title="name(person)">{{ name(person) }}</th>
          <td :title="deliveryMetricTip(person, 'standardHours')">{{ person.calendarStatus === 'invalid_period' ? '—' : number(person.standardHours) }}</td>
          <td :title="deliveryMetricTip(person, 'deliveredHours')">{{ number(person.deliveredHours) }}</td>
          <td :title="deliveryMetricTip(person, 'deliveryRate')"><span :class="{ 'is-complete': rate(person) !== null && rate(person) >= 100 }">{{ rate(person) === null ? '—' : `${number(rate(person))}%` }}</span></td>
          <td :title="deliveryMetricTip(person, 'weightedDeliveryRate')"><span :class="{ 'is-complete': person.weightedDeliveryRate != null && person.weightedDeliveryRate >= 100 }">{{ weightedRateText(person) }}</span></td>
          <td :title="deliveryMetricTip(person, 'requirementProgress')"><span :class="{ 'is-complete': person.requirementProgress === 100 }">{{ requirementProgressText(person) }}</span></td>
        </tr></tbody>
      </table>
      <div v-else class="staff-delivery-empty">当前范围暂无应交付人员</div>
    </div>
  </div>
</template>

<style scoped>
.staff-delivery-list { --staff-row-height: 28px; --staff-heading-height: 27px; display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; width: 100%; max-height: calc(var(--staff-heading-height) + var(--staff-row-height) * var(--staff-visible-rows) + 1px); overflow: hidden; }
.staff-delivery-viewport { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.staff-delivery-viewport:focus-visible { outline: 2px solid #165dff; outline-offset: -2px; }
.staff-delivery-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; color: #475467; font-size: 12px; line-height: 1.25; font-variant-numeric: tabular-nums; }
.staff-name-col { width: 17%; }
.staff-delivery-table th, .staff-delivery-table td { box-sizing: border-box; height: var(--staff-row-height); padding: 3px 7px; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid #f0f2f5; }
.staff-delivery-table thead th { position: sticky; top: 0; z-index: 1; height: var(--staff-heading-height); background: #f7f9fc; color: #667085; font-size: 11px; font-weight: 500; }
.staff-delivery-table thead th.delivery-hours-heading { white-space: normal; line-height: 14px; }
.staff-delivery-table thead th { white-space: normal; overflow-wrap: anywhere; }
.delivery-hours-heading span { white-space: nowrap; }
.staff-delivery-table th:first-child { text-align: left; }
.staff-delivery-table tbody th { color: #344054; font-weight: 500; }
.staff-delivery-table tbody tr:last-child > * { border-bottom: 0; }
.is-complete { display: inline-block; color: #146c2e; background: #e8f7ee; border-radius: 3px; padding: 1px 3px; font-weight: 600; }
.staff-delivery-empty { padding: 10px 3px; color: #86909c; font-size: 11px; }
.is-compact { --staff-row-height: 23px; --staff-heading-height: 22px; flex: 0 1 auto; }
.is-compact .staff-name-col { width: 24%; }
.is-compact .staff-hours-col { width: 22%; }
.is-compact .staff-rate-col { width: 32%; }
.is-compact .staff-delivery-table { font-size: 11px; }
.is-compact .staff-delivery-table th, .is-compact .staff-delivery-table td { padding: 3px 2px; }
.is-compact .staff-delivery-table thead th { font-size: 10px; }
.is-compact .is-complete { padding: 1px 2px; }
@media (max-width: 600px) {
  .is-compact .staff-name-col, .is-compact .staff-hours-col { width: 20%; }
  .is-compact .staff-rate-col { width: 40%; }
  .is-compact .staff-delivery-table th, .is-compact .staff-delivery-table td { padding-right: 1px; padding-left: 1px; }
  .is-compact .staff-delivery-table thead th { font-size: 9px; }
}
</style>
