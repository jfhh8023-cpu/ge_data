<script setup>
import { computed } from 'vue'
import { WORK_HOURS_TIP, WORK_HOURS_SCOPE_TIP } from '../utils/workHours'
import { FULL_CREDIT_NOTE, FULL_CREDIT_TITLES } from '../utils/effectiveHours'

const props = defineProps({
  metric: { type: Object, default: null },
  weightedMetric: { type: Object, default: null },
  preview: Boolean,
  compact: Boolean,
  label: { type: String, default: '工时完成度' }
})
const number = value => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const rate = computed(() => props.metric?.completionRate)
const estimated = computed(() => /fallback|missing|partial|estimate/.test(props.metric?.calendarStatus || ''))
const tip = computed(() => [WORK_HOURS_TIP, WORK_HOURS_SCOPE_TIP, props.metric?.scopeNote].filter(Boolean).join('\n'))
const previewTip = computed(() => `预估工时完成度＝当前表单全部已填工时÷所属周应填工时×100%。应填工时＝实际工作日×8h，使用工作日日历，同人同日只计一次。包括普通无版本及${FULL_CREDIT_TITLES.join('、')}工时，仅预估当前表单，不叠加已保存记录。当前 ${number(props.metric?.actualHours)}h÷${number(props.metric?.standardHours)}h${rate.value == null ? '' : `＝${number(rate.value)}%`}。`)
const weightedTip = computed(() => `预估加权工时完成度＝[Σ(普通含版本号工时×本人填写的需求进度)＋${FULL_CREDIT_TITLES.join('、')}工时]÷所属周应填工时×100%。这里只预估当前表单；统计加权交付率按所选完整周期应交付工时计算，缺填周计0工时但保留应交付工时。五类工时按完整值计一次；普通无版本不计分子。已有历史空进度仅在计算时按100%（原值不变），历史明确0仍按0；新行未填显示待补进度，正式提交普通需求须10%至100%。应填为0不计算，超过100%按实际显示。${props.weightedMetric?.missingProgressHours > 0 ? `当前${number(props.weightedMetric.missingProgressHours)}h新普通有版本工时待补进度，加权总工时暂不计算` : `当前加权工时 ${number(props.weightedMetric?.weightedDeliveredHours)}h`}，应填 ${number(props.metric?.standardHours)}h，历史默认100%的工时 ${number(props.weightedMetric?.historicalDefaultHours)}h。`)
const weightedValue = computed(() => props.metric?.calendarStatus === 'invalid_period' ? '待核实' : props.weightedMetric?.missingProgressHours > 0 ? '待补进度' : props.weightedMetric?.weightedDeliveryRate == null ? '不适用' : `${number(props.weightedMetric.weightedDeliveryRate)}%`)
</script>

<template>
  <section class="hours-completion" :class="{ 'is-compact': compact, 'is-preview': preview }" data-testid="hours-completion">
    <template v-if="preview">
      <div class="hours-preview-grid">
        <el-tooltip :content="previewTip" placement="top" :show-after="150">
          <div class="hours-preview-metric" tabindex="0" :aria-label="previewTip">
            <div class="hours-completion-heading">
              <span class="hours-completion-label">预估工时完成度 ⓘ</span>
              <strong :class="{ 'is-complete': metric?.calendarStatus !== 'invalid_period' && rate != null && Number(rate) >= 100 }" data-testid="fill-preview-completion">{{ !metric ? '待计算' : metric.calendarStatus === 'invalid_period' ? '待核实' : rate == null ? '不适用' : `${number(rate)}%` }}</strong>
            </div>
            <div class="hours-completion-basis">已填 {{ number(metric?.actualHours) }}h / 应填 {{ number(metric?.standardHours) }}h<span v-if="Number(metric?.excessRate) > 0"> · 超额 {{ number(metric.excessRate) }}%</span></div>
          </div>
        </el-tooltip>
        <el-tooltip :content="weightedTip" placement="top" :show-after="150">
          <div class="hours-preview-metric" tabindex="0" :aria-label="weightedTip">
            <div class="hours-completion-heading">
              <span class="hours-completion-label">预估加权工时完成度 ⓘ</span>
              <strong :class="{ 'is-complete': metric?.calendarStatus !== 'invalid_period' && weightedMetric?.weightedDeliveryRate != null && Number(weightedMetric.weightedDeliveryRate) >= 100 }" data-testid="fill-preview-weighted">{{ weightedValue }}</strong>
            </div>
            <div class="hours-completion-basis"><template v-if="weightedMetric?.missingProgressHours > 0">缺进度 {{ number(weightedMetric.missingProgressHours) }}h</template><template v-else>加权 {{ number(weightedMetric?.weightedDeliveredHours) }}h</template> / 应填 {{ number(metric?.standardHours) }}h</div>
          </div>
        </el-tooltip>
      </div>
      <p class="hours-preview-note">{{ FULL_CREDIT_NOTE }}<span v-if="estimated"> 日历缺失，按周一至周五估算，待核实。</span><span v-if="metric?.calendarStatus === 'invalid_period'"> 周期日期无效，应填待核实。</span></p>
    </template>
    <template v-else>
    <div class="hours-completion-heading">
      <el-tooltip :content="tip" placement="top" :show-after="150">
        <span class="hours-completion-label" tabindex="0" :aria-label="`${label}。${tip}`">{{ label }} ⓘ</span>
      </el-tooltip>
      <strong :class="{ 'is-complete': metric?.calendarStatus !== 'invalid_period' && rate != null && Number(rate) >= 100, 'is-over': Number(rate) > 100 }" data-testid="hours-completion-rate">{{ !metric ? '待计算' : metric.calendarStatus === 'invalid_period' ? '待核实' : rate == null ? '不适用' : `${number(rate)}%` }}</strong>
      <span v-if="Number(metric?.excessRate) > 0" class="hours-completion-excess">超额 {{ number(metric.excessRate) }}%</span>
    </div>
    <div v-if="metric" class="hours-completion-basis">已填 {{ number(metric.actualHours) }}h / 应填 {{ number(metric.standardHours) }}h</div>
    <div v-if="metric && !compact" class="hours-completion-detail">{{ number(metric.workingDays) }} 人工作日 × 8h<span v-if="metric.standardHours === 0"> · 无应填工时</span></div>
    <div v-if="estimated" class="hours-completion-estimate">日历缺失，按周一至周五估算 · 待核实</div>
    <div v-if="metric?.calendarStatus === 'invalid_period'" class="hours-completion-estimate">周期日期无效，应填工时待核实</div>
    <p v-if="metric?.scopeNote && !compact" class="hours-completion-scope">{{ metric.scopeNote }}</p>
    </template>
  </section>
</template>

<style scoped>
.hours-completion { margin: 10px 0; padding: 12px 14px; border: 1px solid #dbeafe; background: #f8fbff; border-radius: 8px; color: #1d2939; min-width: 0; }
.hours-completion-heading { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; line-height: 1.6; }
.hours-completion-label { font-size: 12px; cursor: help; text-decoration: underline dotted #98a2b3; text-underline-offset: 3px; }
.hours-completion-label:focus-visible { outline: 2px solid #165dff; outline-offset: 3px; }
.hours-completion-heading strong { font-size: 20px; color: #165dff; white-space: nowrap; }
.hours-completion-heading strong.is-complete { color: #16883b; background: #e8f7ee; border-radius: 4px; padding: 0 6px; }
.hours-completion-heading strong.is-over { color: #b54708; }
.hours-completion-excess { color: #b54708; font-size: 11px; white-space: nowrap; }
.hours-completion-basis, .hours-completion-detail, .hours-completion-scope { margin: 3px 0 0; font-size: 12px; line-height: 1.6; color: #475467; overflow-wrap: anywhere; }
.hours-completion-estimate { margin-top: 4px; color: #b54708; font-size: 11px; line-height: 1.5; }
.is-compact { margin: 8px 0 0; padding: 6px 0 0; background: none; border: 0; border-top: 1px solid #eaecf0; border-radius: 0; }
.is-compact .hours-completion-heading { gap: 4px 6px; }
.is-compact .hours-completion-heading strong { font-size: 14px; }
.is-compact .hours-completion-basis { font-size: 11px; }
.is-preview { margin: 0; padding: 7px 12px; }
.hours-preview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; }
.hours-preview-metric { min-width: 0; cursor: help; }
.hours-preview-metric:focus-visible { outline: 2px solid #165dff; outline-offset: 2px; }
.is-preview .hours-completion-heading { gap: 3px 8px; line-height: 1.35; }
.is-preview .hours-completion-basis { margin-top: 2px; font-size: 11px; line-height: 1.35; }
.hours-preview-note { margin: 5px 0 0; font-size: 11px; line-height: 1.45; color: #667085; }
</style>
