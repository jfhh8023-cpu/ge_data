/** 统一的工时加权进度口径，所有展示位置复用同一公式与说明。 */
export const WEIGHTED_PROGRESS_TIP = '需求进度按本人真实填写的0%–100%计算，缺失保持未知，不因历史周期已结束而置为100%。周期统计按同人、同版本、同标题累计普通工时与范围内最新进度加权，另显示进度覆盖；请假、培训、公司会议、出差、团建不参与需求进度平均。有效交付率与加权交付率分别以所属周期工作日每天8小时为基准。'

export function normalizeProgress(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const progress = Number(value)
  return Number.isFinite(progress) && progress >= 0 && progress <= 100 ? progress : null
}

export function weightedProgress(records = []) {
  let hoursTotal = 0
  let weightedTotal = 0
  for (const record of records) {
    const hours = Number(record?.hours || 0)
    const progress = normalizeProgress(record?.delivery_progress)
    if (!Number.isFinite(hours) || hours <= 0 || progress === null) continue
    hoursTotal += hours
    weightedTotal += hours * progress
  }
  return hoursTotal > 0 ? Number((weightedTotal / hoursTotal).toFixed(2)) : null
}
