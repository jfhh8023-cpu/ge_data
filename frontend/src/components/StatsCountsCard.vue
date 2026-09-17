<script setup>
defineProps({ items: { type: Array, default: () => [] }, caption: { type: String, default: '' } })
defineEmits(['select'])
</script>

<template>
  <section class="stats-counts-card" :class="{ 'has-caption': caption }" data-testid="stats-counts-card" aria-label="周期数量统计">
    <div v-if="caption" class="stats-count-caption" :title="caption">{{ caption }}</div>
    <component v-for="item in items" :key="item.key" :is="item.action ? 'button' : 'div'"
      :type="item.action ? 'button' : undefined" class="stats-count-item" :class="{ 'is-clickable': item.action }"
      :data-count="item.key" :title="item.tip || item.label" @click="item.action && $emit('select', item.action)">
      <span>{{ item.label }}<span v-if="item.action" class="stats-count-detail" aria-hidden="true"> ↗</span></span>
      <strong :style="{ color: item.color }">{{ item.value ?? 0 }}</strong>
    </component>
  </section>
</template>

<style scoped>
.stats-count-caption { grid-column: 1 / -1; font-size: 10px; line-height: 12px; color: #667085; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats-counts-card { box-sizing: border-box; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 2px 8px; min-width: 0; align-self: stretch; height: 100%; padding: 6px 8px; border: 1px solid #e8edf3; border-radius: 8px; background: #fff; }
.stats-counts-card.has-caption { grid-template-rows: 12px repeat(2, minmax(0, 1fr)); }
.stats-count-item { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 0; min-width: 0; padding: 0 3px; border: 0; border-radius: 4px; background: transparent; font: inherit; text-align: left; color: #667085; }
.stats-count-item > span { max-width: 100%; font-size: 10px; line-height: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats-count-item strong { font-size: 20px; line-height: 22px; font-weight: 700; }
.stats-count-detail { color: #98a2b3; }
.is-clickable { cursor: pointer; }
.is-clickable:hover { background: #f3f7ff; }
.is-clickable:focus-visible { outline: 2px solid #165dff; outline-offset: 2px; }
</style>
