/** 统一的工时加权进度口径，所有展示位置复用同一公式与说明。 */
export const WEIGHTED_PROGRESS_TIP = '普通需求新录入进度选择10%–100%；历史明确0%按0%，原始空进度保持为空。需求填报进度按同人、同版本、同标题累计普通版本工时与范围内最新已知进度加权，另显示真实填报覆盖。有效交付率＝有效已交付÷工作日应交付工时；加权交付率＝Σ(有效工时×进度)÷有效工时，历史空进度仅在此计算中按100%。部门、岗位合并工时加权，个人仅算本人。请假、培训、公司会议、出差、团建全额计入有效及加权交付，不参与需求进度平均。'

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
