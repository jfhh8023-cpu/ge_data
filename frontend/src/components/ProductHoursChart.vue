<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  sources: { type: Array, default: () => [] },
  hideZero: { type: Boolean, default: true },
  selectedKey: { type: String, default: '' },
  barWidth: { type: Number, default: 18 },
  barGap: { type: Number, default: 8 },
  ariaLabel: { type: String, default: '产品经理工时分布' },
  emptyText: { type: String, default: '当前范围暂无AI产品经理工时' },
  expandable: { type: Boolean, default: false }
})
const emit = defineEmits(['select'])

const TOTAL_COLOR = '#F53F3F'
const expanded = ref(false)
watch(() => props.expandable, value => { if (!value) expanded.value = false })
const chartGroupsRef = ref(null)
const chartWidth = ref(0)
let chartResizeObserver
watch(chartGroupsRef, element => {
  chartResizeObserver?.disconnect()
  if (!element) return
  chartWidth.value = element.clientWidth
  chartResizeObserver = new ResizeObserver(() => { chartWidth.value = element.clientWidth })
  chartResizeObserver.observe(element)
}, { flush: 'post' })
onUnmounted(() => chartResizeObserver?.disconnect())
const hours = value => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}
const number = value => String(Number(hours(value).toFixed(1)))
const fixedBarWidth = computed(() => Number.isFinite(props.barWidth) && props.barWidth > 0 ? props.barWidth : 18)
// 10px labels need up to 6px per character plus breathing room.
const labelGap = computed(() => Math.max(8, Number(props.barGap) || 8, ...props.rows.flatMap(row =>
  props.sources.map(source => row.sourceValues?.[source.id])
    .map(value => number(value).length * 6 + 4 - fixedBarWidth.value)
)))
const groups = computed(() => props.rows.map(row => {
  const series = props.sources.map(source => ({
    id: source.id,
    name: source.name,
    color: source.color || '#165DFF',
    value: hours(row.sourceValues?.[source.id])
  }))
  const visibleSeries = props.hideZero ? series.filter(item => item.value > 0) : series
  return {
    ...row,
    staffName: row.staffName || '-',
    total: hours(row.total),
    series: visibleSeries,
    width: Math.max(76, number(row.total).length * 7 + 16,
      visibleSeries.length * fixedBarWidth.value + Math.max(0, visibleSeries.length - 1) * labelGap.value + 16)
  }
}))
// Balance the rows (for example 5 + 4 people, rather than 8 + 1), keeping every series visible.
const columnCount = computed(() => {
  const count = Math.max(1, groups.value.length)
  if (!chartWidth.value) return count
  const groupWidth = Math.max(76, ...groups.value.map(group => group.width))
  const capacity = Math.max(1, Math.floor((chartWidth.value + 8) / (groupWidth + 8)))
  return Math.ceil(count / Math.ceil(count / capacity))
})
const rowCount = computed(() => Math.max(1, Math.ceil(groups.value.length / columnCount.value)))
const plotHeight = computed(() => rowCount.value === 1 ? 220 : rowCount.value === 2 ? 136 : 104)
const chartStyle = computed(() => ({
  '--product-bar-width': `${fixedBarWidth.value}px`,
  '--product-bar-gap': `${labelGap.value}px`,
  '--product-column-count': columnCount.value,
  '--product-plot-height': `${plotHeight.value}px`
}))
const maximum = computed(() => groups.value.reduce((max, row) => row.series.reduce((value, series) => Math.max(value, series.value), Math.max(max, row.total)), 1))
// Bars and total points use exactly the same scale and baseline. Extra top space separates their labels.
const valueHeight = value => hours(value) / maximum.value * (plotHeight.value - 44)
const barStyle = series => ({
  height: `${valueHeight(series.value)}px`,
  backgroundColor: series.color
})
const barLabel = (row, series) => `${row.staffName} · ${series.name}：${number(series.value)} 小时`
const totalLabel = row => `${row.staffName} · 总计：${number(row.total)} 小时`
const chartRows = computed(() => {
  const rows = []
  const columnWidth = (chartWidth.value - Math.max(0, columnCount.value - 1) * 8) / columnCount.value
  for (let offset = 0; offset < groups.value.length; offset += columnCount.value) {
    const people = groups.value.slice(offset, offset + columnCount.value)
    const points = []
    const segments = []
    let segment = []
    people.forEach((person, index) => {
      if (props.hideZero && person.total === 0) {
        if (segment.length > 1) segments.push(segment)
        segment = []
        return
      }
      const point = {
        ...person,
        x: columnWidth / 2 + index * (columnWidth + 8),
        y: plotHeight.value - 1 - valueHeight(person.total)
      }
      points.push(point)
      segment.push(point)
    })
    if (segment.length > 1) segments.push(segment)
    rows.push({ people, points, segments })
  }
  return rows
})
const linePoints = points => points.map(point => `${point.x},${point.y}`).join(' ')
</script>

<template>
  <section
    class="dt-product-manager-chart"
    :style="chartStyle"
    data-testid="product-hours-chart"
    :aria-label="ariaLabel"
  >
    <div class="dt-product-manager-legend" aria-label="工时来源图例">
      <button
        v-if="expandable"
        type="button"
        class="dt-product-chart-size-button dt-product-chart-expand-button"
        :aria-label="`放大${ariaLabel}`"
        :aria-expanded="expanded"
        aria-haspopup="dialog"
        data-testid="product-chart-expand"
        @click="expanded = true"
      >放大</button>
      <span v-for="source in sources" :key="source.id" class="dt-product-manager-legend-item">
        <i :style="{ backgroundColor: source.color || '#165DFF' }" aria-hidden="true"></i>
        <span class="dt-product-manager-legend-name">{{ source.name }}</span>
      </span>
      <span class="dt-product-manager-legend-item">
        <i class="dt-total-line-icon" :style="{ backgroundColor: TOTAL_COLOR, color: TOTAL_COLOR }" aria-hidden="true"></i>
        <span class="dt-product-manager-legend-name">总计（折线）</span>
      </span>
    </div>

    <div
      v-if="groups.length"
      class="dt-product-manager-chart-content"
      role="region"
      aria-label="全部人员工时柱状图和总计折线，按可用宽度自动换行"
    >
      <div ref="chartGroupsRef" class="dt-product-manager-chart-groups" :data-row-count="rowCount">
        <div
          v-for="(chartRow, rowIndex) in chartRows"
          :key="rowIndex"
          class="dt-product-manager-chart-row"
          :data-row-index="rowIndex"
        >
          <div
            v-for="row in chartRow.people"
            :key="row.staffId"
            class="dt-product-manager-group"
            :class="{ 'is-selected': String(selectedKey) === String(row.staffId) }"
            :data-staff-id="row.staffId"
            role="group"
            :aria-label="`${row.staffName}的工时`"
          >
            <div class="dt-product-manager-bars">
              <div
                v-for="series in row.series"
                :key="series.id"
                class="dt-product-manager-bar"
                :style="barStyle(series)"
                :data-series="series.id"
                :data-source="series.id"
                :data-value="series.value"
                :title="barLabel(row, series)"
                role="img"
                :aria-label="barLabel(row, series)"
              >
                <span aria-hidden="true">{{ number(series.value) }}</span>
              </div>
            </div>
            <button
              type="button"
              class="dt-product-manager-label"
              :aria-label="`查看${row.staffName}的工时记录`"
              :aria-pressed="String(selectedKey) === String(row.staffId)"
              :title="row.staffName"
              @click="emit('select', row.staffId)"
            >{{ row.staffName }}</button>
          </div>
          <svg
            v-if="chartWidth > 0"
            class="dt-product-total-line"
            :viewBox="`0 0 ${chartWidth} ${plotHeight}`"
            :height="plotHeight"
            data-testid="product-total-line"
            :data-row-index="rowIndex"
            :aria-label="`第${rowIndex + 1}行总计折线`"
          >
            <polyline
              v-for="(segment, segmentIndex) in chartRow.segments"
              :key="segmentIndex"
              :points="linePoints(segment)"
              fill="none"
              :stroke="TOTAL_COLOR"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
              aria-hidden="true"
            />
            <g v-for="point in chartRow.points" :key="point.staffId">
              <circle
                class="dt-product-manager-total-point"
                :cx="point.x"
                :cy="point.y"
                r="3.5"
                :stroke="TOTAL_COLOR"
                stroke-width="2"
                data-testid="product-total-point"
                data-series="total"
                :data-staff-id="point.staffId"
                :data-value="point.total"
                role="img"
                :aria-label="totalLabel(point)"
              ><title>{{ totalLabel(point) }}</title></circle>
              <text
                class="dt-product-manager-total-value"
                :x="point.x"
                :y="point.y - 28"
                text-anchor="middle"
                :fill="TOTAL_COLOR"
                data-testid="product-total-value"
                :data-staff-id="point.staffId"
                :data-value="point.total"
                aria-hidden="true"
              >{{ number(point.total) }}</text>
            </g>
          </svg>
        </div>
      </div>
    </div>
    <div v-else class="dt-product-manager-empty" role="status">{{ emptyText }}</div>

    <ElDialog
      v-if="expandable"
      v-model="expanded"
      :title="ariaLabel"
      width="min(1440px, calc(100vw - 32px))"
      top="5vh"
      :show-close="false"
      :close-on-press-escape="true"
      append-to-body
      destroy-on-close
    >
      <template #header="{ titleId, titleClass, close }">
        <div class="dt-product-chart-dialog-header">
          <h3 :id="titleId" :class="titleClass">{{ ariaLabel }}</h3>
          <button
            type="button"
            class="dt-product-chart-size-button"
            :aria-label="`缩小${ariaLabel}`"
            data-testid="product-chart-shrink"
            @click="close"
          >缩小</button>
        </div>
      </template>
      <div class="dt-product-chart-expanded-content" data-testid="product-chart-expanded">
        <ProductHoursChart
          :rows="rows"
          :sources="sources"
          :hide-zero="hideZero"
          :selected-key="selectedKey"
          :bar-width="barWidth"
          :bar-gap="barGap"
          :aria-label="ariaLabel"
          :empty-text="emptyText"
          :expandable="false"
          @select="emit('select', $event)"
        />
      </div>
    </ElDialog>
  </section>
</template>

<style scoped>
.dt-product-manager-chart {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 8px 4px 12px;
}
.dt-product-manager-legend {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 14px;
  min-height: 40px;
  margin-bottom: 8px;
  color: var(--color-text-2, #4E5969);
  font-size: 12px;
  line-height: 1.5;
}
.dt-product-manager-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
}
.dt-product-manager-legend i {
  flex: 0 0 10px;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.dt-product-manager-legend-name { min-width: 0; overflow-wrap: anywhere; }
.dt-product-manager-legend .dt-total-line-icon { position: relative; flex-basis: 20px; width: 20px; height: 2px; border-radius: 0; }
.dt-total-line-icon::after { position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; border: 2px solid currentColor; border-radius: 50%; background: #FFFFFF; content: ''; transform: translate(-50%, -50%); }
.dt-product-chart-size-button {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 4px 12px;
  border: 1px solid var(--color-border, #E5E6EB);
  border-radius: 4px;
  background: var(--color-bg-2, #FFFFFF);
  color: var(--color-primary, #165DFF);
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}
.dt-product-chart-size-button:hover { background: var(--color-primary-light, #E8F3FF); }
.dt-product-chart-size-button:focus-visible { outline: 2px solid var(--color-primary, #165DFF); outline-offset: 2px; }
.dt-product-chart-expand-button { margin-right: auto; }
.dt-product-chart-dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dt-product-chart-dialog-header h3 { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
.dt-product-chart-expanded-content { min-width: 0; max-height: calc(90dvh - 104px); overflow-y: auto; }
.dt-product-manager-chart-content {
  width: 100%;
  max-width: 100%;
}
.dt-product-manager-chart-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  padding-bottom: 4px;
}
.dt-product-manager-chart-row { position: relative; display: grid; grid-template-columns: repeat(var(--product-column-count), minmax(0, 1fr)); align-items: start; gap: 8px; min-width: 0; }
.dt-product-total-line { position: absolute; top: 8px; left: 0; z-index: 1; width: 100%; overflow: visible; pointer-events: none; }
.dt-product-manager-total-point { fill: #FFFFFF; pointer-events: auto; }
.dt-product-manager-total-value { font-size: 11px; font-weight: 700; paint-order: stroke; stroke: #FFFFFF; stroke-width: 3px; stroke-linejoin: round; }
.dt-product-manager-group {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  padding: 8px 8px 0;
  border-radius: 6px;
  text-align: center;
  transition: background-color .2s ease;
}
.dt-product-manager-group:hover,
.dt-product-manager-group.is-selected { background: var(--color-primary-light, #E8F3FF); }
.dt-product-manager-bars {
  box-sizing: border-box;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: var(--product-bar-gap);
  height: var(--product-plot-height);
  border-bottom: 1px solid var(--color-border, #E5E6EB);
}
.dt-product-manager-bar {
  position: relative;
  flex: 0 0 var(--product-bar-width);
  width: var(--product-bar-width);
  min-width: var(--product-bar-width);
  max-width: var(--product-bar-width);
  min-height: 0;
  border-radius: 3px 3px 0 0;
  transition: height .2s ease;
}
.dt-product-manager-bar span {
  position: absolute;
  left: 50%;
  top: -20px;
  transform: translateX(-50%);
  color: var(--color-text-1, #1D2129);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  white-space: nowrap;
}
.dt-product-manager-label {
  box-sizing: border-box;
  max-width: 100%;
  min-width: 44px;
  min-height: 36px;
  padding: 6px 2px;
  border: 0;
  background: transparent;
  color: var(--color-text-2, #4E5969);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.dt-product-manager-label:hover { color: var(--color-primary, #165DFF); text-decoration: underline; }
.dt-product-manager-label:focus-visible { outline: 2px solid var(--color-primary, #165DFF); outline-offset: -2px; }
.dt-product-manager-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 276px;
  color: var(--color-text-3, #86909C);
  font-size: 13px;
}
@media (max-width: 600px) {
  .dt-product-manager-chart { padding-right: 4px; padding-left: 4px; }
  .dt-product-manager-legend { justify-content: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .dt-product-manager-group, .dt-product-manager-bar { transition: none; }
}
</style>
