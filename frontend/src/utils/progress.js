/** 统一的工时加权进度口径，所有展示位置复用同一公式与说明。 */
export const WEIGHTED_PROGRESS_TIP = '工时加权进度 = Σ(有效工时 × 任务进度) ÷ Σ(有效工时)。历史无进度记录不进入分母；示例：10小时×100% + 2小时×50% ÷ 12小时 = 91.67%。'

export function weightedProgress(records = []) {
  let hoursTotal = 0
  let weightedTotal = 0
  for (const record of records) {
    const hours = Number(record?.hours || 0)
    const progress = Number(record?.delivery_progress)
    if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(progress)) continue
    hoursTotal += hours
    weightedTotal += hours * progress
  }
  return hoursTotal > 0 ? Number((weightedTotal / hoursTotal).toFixed(2)) : null
}
