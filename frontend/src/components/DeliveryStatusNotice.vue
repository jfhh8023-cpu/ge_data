<script setup>
import { computed } from 'vue'
import { deliveryStatus } from '../utils/deliveryStatus'
const props = defineProps({ metric: { type: Object, default: null } })
defineEmits(['view-incomplete'])
const status = computed(() => deliveryStatus(props.metric))
const tip = computed(() => status.value.state === 'complete'
  ? '按卡片有效交付率与加权交付率一致判定；历史未填进度在加权计算中按100%兼容，原记录仍为空。此提示不代表周期应交付工时已全部填满。'
  : status.value.state === 'partial' ? '加权交付率小于有效交付率。查看当前统计范围内，同一人员、版本、需求的最新周期进度低于100%的需求。'
    : status.value.state === 'warning' ? '加权交付率大于有效交付率，请核实统计数据。' : '当前范围没有有效工时或无法取得完整的应交付工时基准。')
</script>

<template>
  <div class="delivery-status-notice" :class="`is-${status.state}`" :title="tip" data-testid="delivery-status-notice">
    <span>{{ status.text }}</span>
    <button v-if="status.canView" type="button" data-testid="view-incomplete" aria-label="查看跨周期未完成需求" @click.stop="$emit('view-incomplete')">查看</button>
  </div>
</template>

<style scoped>
.delivery-status-notice { display: flex; flex-wrap: wrap; align-items: center; gap: 0 3px; border-top: 1px solid #e8edf3; padding: 5px 0 0; font-size: 11px; line-height: 17px; color: #667085; }
.is-complete > span { color: #146c2e; background: #e8f7ee; padding: 0 4px; border-radius: 4px; }
.is-partial { color: #8b5a00; }
.is-warning { color: #c43b33; }
button { border: 0; background: none; padding: 0; font: inherit; line-height: inherit; color: #165dff; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
button:focus-visible { outline: 2px solid #165dff; outline-offset: 2px; border-radius: 2px; }
</style>
