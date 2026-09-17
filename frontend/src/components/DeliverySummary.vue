<script setup>
import { deliveryMetricTip, weightedRateText } from '../utils/deliverySummary'
defineProps({
  metric: { type: Object, default: null }, unversioned: Boolean,
  showExpectedHours: Boolean, showWeighted: Boolean, showProgress: Boolean, allPeriods: Boolean,
  periodLabel: { type: String, default: '' }, deliveredLabel: { type: String, default: '有效已交付' }, compactLabels: Boolean
})
const number = value => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
</script>

<template>
  <div class="delivery-summary" :class="{ 'has-expected-hours': showExpectedHours, 'has-compact-labels': compactLabels, 'has-weighted': showWeighted }" data-testid="delivery-summary">
    <div v-if="showExpectedHours && !unversioned" class="delivery-metric" :title="deliveryMetricTip(metric, 'standardHours')">
      <span>{{ compactLabels ? '应交付' : `${periodLabel || (allPeriods ? '全部周期' : '当前周期')}应交付工时` }}</span>
      <strong data-testid="expected-hours">{{ metric && metric.calendarStatus !== 'invalid_period' ? number(metric.standardHours) : '—' }}<small>h</small></strong>
    </div>
    <div class="delivery-metric" :title="deliveryMetricTip(metric, unversioned ? 'unversionedHours' : 'deliveredHours')">
      <span>{{ unversioned ? '记录工时' : deliveredLabel }}</span>
      <strong data-testid="delivered-hours">{{ metric ? number(unversioned ? metric.unversionedHours : metric.deliveredHours) : '—' }}<small>h</small></strong>
    </div>
    <div v-if="!unversioned" class="delivery-metric" :title="deliveryMetricTip(metric, 'deliveryRate')">
      <span>有效交付率</span>
      <strong data-testid="delivery-rate" :class="{ 'is-complete': metric?.deliveryRate != null && metric.deliveryRate >= 100 }">{{ metric?.deliveryRate == null ? '—' : `${number(metric.deliveryRate)}%` }}</strong>
    </div>
    <div v-if="showWeighted && !unversioned" class="delivery-metric" :title="deliveryMetricTip(metric, 'weightedDeliveryRate')">
      <span>加权交付率</span>
      <strong data-testid="weighted-delivery-rate" :class="{ 'is-complete': metric?.weightedDeliveryRate != null && metric.weightedDeliveryRate >= 100, 'is-pending': metric?.missingProgressHours > 0 }">{{ weightedRateText(metric) }}</strong>
    </div>
    <span v-if="unversioned" class="delivery-record-only">仅记录，不计交付率</span>
    <div v-if="showProgress && !unversioned" class="delivery-progress-foot">
      <span :title="deliveryMetricTip(metric, 'requirementProgress')">需求填报进度 <b data-testid="requirement-progress" :class="{ 'is-complete': metric?.requirementProgress === 100 }">{{ metric?.requirementProgress == null ? '—' : `${number(metric.requirementProgress)}%` }}</b></span>
      <span :title="deliveryMetricTip(metric, 'progressCoverage')">覆盖 <b data-testid="progress-coverage">{{ metric?.progressCoverage == null ? '—' : `${number(metric.progressCoverage)}%` }}</b></span>
    </div>
  </div>
</template>

<style scoped>
.delivery-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 18px; min-width: 0; }
.delivery-summary.has-expected-hours { gap: 8px 16px; max-width: 100%; }
.delivery-summary.has-compact-labels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.delivery-summary.has-compact-labels.has-weighted { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 10px; }
.delivery-summary.has-compact-labels .delivery-metric > span { font-size: 10px; white-space: normal; }
.delivery-summary.has-compact-labels .delivery-metric strong small { margin-left: 1px; font-size: 10px; }
.delivery-metric { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.delivery-metric > span { color: #667085; font-size: 11px; white-space: nowrap; }
.delivery-metric strong { color: var(--delivery-color, #165dff); font-size: 21px; line-height: 1.3; font-weight: 700; white-space: nowrap; }
.delivery-metric strong small { color: #86909c; font-size: 11px; margin-left: 3px; font-weight: 400; }
.is-complete { color: #146c2e !important; background: #e8f7ee; border-radius: 4px; padding: 0 4px; }
.delivery-metric strong.is-pending { font-size: 13px; color: #a66b13; }
.delivery-record-only { color: #86909c; font-size: 12px; }
.delivery-progress-foot { display: flex; flex-wrap: wrap; gap: 3px 10px; flex-basis: 100%; grid-column: 1 / -1; color: #667085; font-size: 11px; border-top: 1px solid #e8edf3; padding-top: 5px; }
.delivery-progress-foot b { color: #475467; font-weight: 600; white-space: nowrap; }
</style>
