<script setup>
import { computed } from 'vue'
import DeliverySummary from './DeliverySummary.vue'
import { deliveryMetricTip } from '../utils/deliverySummary'

const props = defineProps({
  label: { type: String, required: true },
  hours: { type: [Number, String], default: 0 },
  metric: { type: Object, default: null },
  color: { type: String, default: '#165DFF' },
  backgroundColor: { type: String, default: '#fff' },
  hoverBackgroundColor: { type: String, default: '#fafcff' }
})
defineEmits(['select'])
const total = computed(() => Number(props.hours || 0).toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
</script>

<template>
  <section class="dt-delivery-card" :style="{ '--delivery-color': color, '--delivery-background': backgroundColor, '--delivery-hover-background': hoverBackgroundColor }" @click="$emit('select')">
    <button type="button" class="stats-hours-heading" :aria-label="`${label}，查看人员交付明细`" @click.stop="$emit('select')">
      <span class="dt-delivery-card-title">{{ label }}</span>
      <span class="stats-hours-total" :title="deliveryMetricTip(metric, 'recordedHours')">
        <small>总工时</small>
        <strong data-testid="recorded-hours">{{ total }}<span>h</span></strong>
      </span>
    </button>
    <DeliverySummary :metric="metric" show-expected-hours show-weighted show-progress compact-labels />
  </section>
</template>

<style scoped>
.dt-delivery-card { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px 10px; border: 1px solid #e8edf3; border-radius: 8px; background: var(--delivery-background); text-align: left; cursor: pointer; font: inherit; container: delivery-card / inline-size; }
.dt-delivery-card:hover { border-color: #b2ccff; background: var(--delivery-hover-background); }
.stats-hours-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; min-width: 0; width: 100%; padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer; font: inherit; border-radius: 3px; }
.stats-hours-heading:focus-visible { outline: 2px solid #165dff; outline-offset: 2px; }
.dt-delivery-card-title { color: #475467; font-size: 12px; line-height: 18px; font-weight: 600; min-width: 0; padding-top: 3px; overflow-wrap: anywhere; }
.stats-hours-total { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; }
.stats-hours-total small { color: #667085; font-size: 10px; line-height: 13px; }
.stats-hours-total strong { color: var(--delivery-color); font-size: 25px; font-weight: 700; line-height: 29px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.stats-hours-total strong > span { margin-left: 2px; font-size: 11px; color: #86909c; font-weight: 400; }
.dt-delivery-card :deep(.delivery-summary) { gap: 4px; }
.dt-delivery-card :deep(.delivery-metric) { gap: 1px; }
.dt-delivery-card :deep(.delivery-metric strong) { font-size: 15px; }
@container delivery-card (max-width: 215px) {
  .dt-delivery-card :deep(.delivery-summary.has-compact-labels .delivery-metric > span) { font-size: 9px; white-space: nowrap; }
  .dt-delivery-card :deep(.delivery-summary .delivery-metric strong) { font-size: 12px; }
  .dt-delivery-card :deep(.delivery-summary .delivery-metric strong small) { font-size: 8px; }
  .dt-delivery-card :deep(.delivery-summary .is-complete) { padding: 0 2px; }
}
@media (max-width: 600px) {
  .dt-delivery-card { padding: 8px; }
  .stats-hours-total strong { font-size: 23px; }
  .dt-delivery-card :deep(.delivery-summary) { gap: 3px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
</style>
