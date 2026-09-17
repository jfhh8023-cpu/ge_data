const { isFullCreditRecord, normalizeProgress, FULL_CREDIT_TITLES } = require('./EffectiveHoursService');
const DELIVERY_FORMULA = `有效已交付＝普通含版本号工时＋${FULL_CREDIT_TITLES.join('、')}工时（只计一次）；有效交付率＝有效已交付÷应交付工时×100%。加权交付率＝[Σ(同一人员、版本、标题累计有效工时×所选范围最新周期填报进度)＋五类有效工时]÷当前范围应交付工时×100%。历史空进度仅在加权交付计算中按100%，原值仍为空；明确0%仍按0%，进度覆盖反映真实填报。部门、岗位合并加权工时及应交付工时计算，不平均个人百分比；个人仅算本人。无版本普通记录不计交付。应交付按当前非离职且范围有记录的人员、完整所选周期工作日×8小时计算；缺填周仍计应交付，该周加权工时为0。应交付大于0且日历有效时无加权工时显示0%；应交付为0或日历无效显示“—”；超过100%如实显示。`;

function hasValidVersion(value) {
  const version = String(value ?? '').trim();
  return version !== '' && version !== '-';
}

function versionTypeOf(record) {
  return isFullCreditRecord(record) || hasValidVersion(record?.version) ? 'versioned' : 'no_version';
}

const round = value => Number(value.toFixed(2));
const nonNegativeHours = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const unitKey = (staffId, taskId) => JSON.stringify([String(staffId || ''), String(taskId || '')]);
const groupKey = record => JSON.stringify([String(record.staff_id || record.staff?.id || ''), String(record.version || '').trim(), String(record.requirement_title || '').trim()]);
const emptyTotals = () => ({ deliveredHours: 0, recordedHours: 0, unversionedHours: 0, versionedHours: 0,
  fullCreditHours: 0, weightedDeliveredHours: 0, knownWeightedDeliveredHours: 0, progressKnownHours: 0, missingProgressHours: 0 });
const roundedTotals = totals => Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value)]));
const rate = (deliveredHours, standardHours, calendarStatus) => standardHours > 0 && calendarStatus !== 'invalid_period'
  ? round(deliveredHours * 100 / standardHours) : null;

function isLater(left, right, periodByTask) {
  const order = record => [String(periodByTask.get(String(record.task_id))?.endDate || record.task?.end_date || record.task?.start_date || ''),
    new Date(record.updated_at || record.created_at || 0).getTime() || 0,
    new Date(record.created_at || 0).getTime() || 0, String(record.id || '')];
  const a = order(left), b = order(right);
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}

/** Pure, read-only summary. Five categories take precedence over version classification. */
function buildDeliverySummary(records = [], workHours = {}) {
  const capacityUnits = Array.isArray(workHours.units) ? workHours.units : null;
  const allowedUnits = capacityUnits ? new Set(capacityUnits.map(unit => unitKey(unit.staffId, unit.taskId))) : null;
  const periodByTask = new Map((capacityUnits || []).map(unit => [String(unit.taskId), unit]));
  const selected = [], groups = new Map();
  const seenRecords = new Set();
  for (const value of records) {
    const record = value?.toJSON ? value.toJSON() : value;
    if (!record) continue;
    if (record.hours === null || record.hours === undefined || String(record.hours).trim() === '' || !Number.isFinite(Number(record.hours)) || Number(record.hours) < 0) continue;
    const key = unitKey(record.staff_id || record.staff?.id, record.task_id);
    if (allowedUnits && !allowedUnits.has(key)) continue;
    const source = record.source_type || (record.is_product_manager_record || record.demand_sources !== undefined ? 'product_manager' : 'engineering');
    const identity = record.id ? `${source}:${record.id}` : null;
    if (identity && seenRecords.has(identity)) continue;
    if (identity) seenRecords.add(identity);
    selected.push(record);
    if (!isFullCreditRecord(record) && hasValidVersion(record.version)) {
      const current = groups.get(groupKey(record));
      if (!current || isLater(record, current, periodByTask)) groups.set(groupKey(record), record);
    }
  }
  const totals = emptyTotals(), perUnit = new Map(), missing = new Set(), perUnitMissing = new Map();
  for (const record of selected) {
    const key = unitKey(record.staff_id || record.staff?.id, record.task_id);
    if (!perUnit.has(key)) perUnit.set(key, emptyTotals());
    const hours = nonNegativeHours(record.hours), unit = perUnit.get(key), additions = { recordedHours: hours };
    if (isFullCreditRecord(record)) Object.assign(additions, { deliveredHours: hours, fullCreditHours: hours, weightedDeliveredHours: hours, knownWeightedDeliveredHours: hours });
    else if (hasValidVersion(record.version)) {
      Object.assign(additions, { deliveredHours: hours, versionedHours: hours });
      const progress = normalizeProgress(groups.get(groupKey(record))?.delivery_progress);
      additions.weightedDeliveredHours = hours * (progress ?? 100) / 100;
      if (progress === null && hours > 0) {
        additions.missingProgressHours = hours;
        missing.add(groupKey(record));
        if (!perUnitMissing.has(key)) perUnitMissing.set(key, new Set());
        perUnitMissing.get(key).add(groupKey(record));
      } else if (progress !== null) {
        additions.progressKnownHours = hours;
        additions.knownWeightedDeliveredHours = hours * progress / 100;
      }
    } else additions.unversionedHours = hours;
    for (const [name, value] of Object.entries(additions)) { totals[name] += value; unit[name] += value; }
  }
  function finish(values, standardHours, calendarStatus, missingCount) {
    return { ...roundedTotals(values), standardHours,
      deliveryRate: rate(values.deliveredHours, standardHours, calendarStatus),
      weightedDeliveryRate: rate(values.weightedDeliveredHours, standardHours, calendarStatus),
      missingProgressCount: missingCount,
      requirementProgress: values.progressKnownHours > 0 ? round((values.knownWeightedDeliveredHours - values.fullCreditHours) * 100 / values.progressKnownHours) : null,
      progressCoverage: values.versionedHours > 0 ? round(values.progressKnownHours * 100 / values.versionedHours) : null };
  }
  const standardHours = nonNegativeHours(workHours.standardHours);
  const calendarStatus = workHours.calendarStatus || 'empty';
  return {
    ...finish(totals, standardHours, calendarStatus, missing.size),
    calendarStatus,
    calendarNote: String(workHours.calendarNote || '').replaceAll('完成度', '交付率'),
    workingDays: Number(workHours.workingDays || 0),
    formula: DELIVERY_FORMULA,
    scopeNote: workHours.scopeNote || '当前非离职且范围有记录的人员按完整所选周期计算应交付工时。',
    units: (capacityUnits || []).map(unit => {
      const { actualHours, completionRate, excessRate, ...capacity } = unit;
      const key = unitKey(unit.staffId, unit.taskId);
      const unitTotals = perUnit.get(key) || emptyTotals();
      const unitStandardHours = nonNegativeHours(unit.standardHours);
      return { ...capacity, ...finish(unitTotals, unitStandardHours, unit.calendarStatus, perUnitMissing.get(key)?.size || 0) };
    })
  };
}

module.exports = { DELIVERY_FORMULA, hasValidVersion, versionTypeOf, buildDeliverySummary };
