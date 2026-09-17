// REQ-064 pure frontend rules: no API, database or business-data writes.
import assert from 'node:assert/strict'
import { FULL_CREDIT_TITLES, POSITIVE_PROGRESS_OPTIONS, isValidSubmittedProgress, isFullCreditRecord, dateVersion, initializeSpecialRow, syncSpecialRow, summarizeDraftWeightedHours } from '../../frontend/src/utils/effectiveHours.js'

let checked = 0
function check(name, fn) { fn(); checked++; console.log(`PASS ${name}`) }
const now = new Date('2026-09-16T17:00:00Z')
check('five exact trimmed titles; similar ordinary titles remain ordinary', () => {
  for (const title of FULL_CREDIT_TITLES) assert.equal(isFullCreditRecord({ requirement_title: ` ${title} ` }), true)
  for (const title of ['培训系统开发', '公司会议纪要', '请假申请开发', '出差报销', '团建活动平台', '']) assert.equal(isFullCreditRecord(title), false)
})
check('China date version and historical special versions are stable', () => {
  assert.equal(dateVersion(now), 'v260917')
  assert.equal(dateVersion('2026-01-02'), 'v260102')
  assert.equal(initializeSpecialRow({ requirement_title: '请假', version: 'v260101', hours: 2 }, now).version, 'v260101')
  assert.equal(initializeSpecialRow({ requirement_title: '请假', created_at: '2026-05-01T00:00:00Z', hours: null }, now).version, 'v260501')
  const imported = initializeSpecialRow({ requirement_title: '培训', version: 'v250101', automatic_version_date: '2025-01-01', hours: 3.5 }, now, { newRow: true })
  assert.equal(imported.version, 'v260917'); assert.equal(imported.automatic_version_date, '2026-09-17'); assert.equal(imported.hours, 3.5)
})
check('ordinary-special transitions never change manual hours or normal drafts', () => {
  for (const hours of [null, 0, 3.5, 48]) {
    const row = initializeSpecialRow({ requirement_title: '普通', version: 'v4.0', delivery_progress: 0, hours, product_managers: ['甲'], demand_sources: ['客户需求'], demand_source_weights: { 客户需求: 100 } }, now)
    for (const title of FULL_CREDIT_TITLES) {
      row.requirement_title = title; syncSpecialRow(row, now)
      assert.equal(row.hours, hours); assert.equal(row.version, 'v260917'); assert.equal(row.delivery_progress, null)
      assert.deepEqual(row.product_managers, []); assert.deepEqual(row.demand_sources, [])
    }
    row.requirement_title = '普通'; syncSpecialRow(row, now)
    assert.equal(row.hours, hours); assert.equal(row.version, 'v4.0'); assert.equal(row.delivery_progress, 0)
    assert.deepEqual(row.product_managers, ['甲']); assert.deepEqual(row.demand_sources, ['客户需求'])
  }
  const empty = initializeSpecialRow({ requirement_title: '普通', hours: null, delivery_progress: null }, now)
  empty.requirement_title = '培训'; syncSpecialRow(empty, now)
  empty.requirement_title = '培训系统'; syncSpecialRow(empty, now)
  assert.equal(empty.version, ''); assert.equal(empty.delivery_progress, null); assert.equal(empty.hours, null)
})
check('weighted estimate includes special once, excludes ordinary unversioned', () => {
  const rows = [{ requirement_title: '普通', version: 'v1', hours: 16, delivery_progress: 50 },
    ...FULL_CREDIT_TITLES.map(requirement_title => ({ requirement_title, version: 'v260917', hours: 2, delivery_progress: null })),
    { requirement_title: '无版本', hours: 12, delivery_progress: 100 }, { version: '-', hours: 8, delivery_progress: 100 }]
  const result = summarizeDraftWeightedHours(rows, 40)
  assert.equal(result.fullCreditHours, 10); assert.equal(result.weightedDeliveredHours, 18); assert.equal(result.weightedDeliveryRate, 45)
})
check('unknown progress differs from 0, invalid capacity and overfill remain explicit', () => {
  const unknown = summarizeDraftWeightedHours([{ version: 'v1', hours: 8, delivery_progress: null }, { requirement_title: '培训', hours: 2 }], 40)
  assert.equal(unknown.weightedDeliveryRate, null); assert.equal(unknown.weightedDeliveredHours, null); assert.equal(unknown.knownWeightedDeliveredHours, 2)
  assert.equal(summarizeDraftWeightedHours([{ version: 'v1', hours: 8, delivery_progress: 0 }], 40).weightedDeliveryRate, 0)
  assert.equal(summarizeDraftWeightedHours([{ requirement_title: '请假', hours: 48 }], 40).weightedDeliveryRate, 120)
  assert.equal(summarizeDraftWeightedHours([{ requirement_title: '请假', hours: 48 }], 0).weightedDeliveryRate, null)
  assert.equal(summarizeDraftWeightedHours([{ version: 'v1', hours: 0, delivery_progress: null }], 40).missingProgressHours, 0)
})
check('REQ065 historic null defaults to100 in preview while standard hours remain denominator and stored null stays unchanged', () => {
  const historical = { existing_record_id: 'old-row', _original_progress_missing: true, version: 'v1', hours: 8, delivery_progress: null }
  const current = { version: 'v2', hours: 8, delivery_progress: 50 }
  const result = summarizeDraftWeightedHours([historical, current], 40)
  assert.equal(result.weightedDeliveredHours, 12); assert.equal(result.weightedDeliveryRate, 30)
  assert.equal(result.historicalDefaultHours, 8); assert.equal(result.knownWeightedDeliveredHours, 4)
  assert.equal(historical.delivery_progress, null)
  assert.equal(summarizeDraftWeightedHours([{ ...historical, delivery_progress: 0 }], 40).weightedDeliveryRate, 0)
  assert.equal(summarizeDraftWeightedHours([{ ...historical, existing_record_id: '' }], 40).weightedDeliveryRate, null)
  assert.equal(summarizeDraftWeightedHours([{ ...historical, _original_progress_missing: false }], 40).weightedDeliveryRate, null)
  assert.equal(summarizeDraftWeightedHours([{ version: 'v1', hours: 8, delivery_progress: null, existing_record_id: 'fake-old-id' }], 40).weightedDeliveryRate, null)
})
check('REQ065 ordinary explicit submissions require10..100; saved null and special categories retain exceptions', () => {
  assert.deepEqual([...POSITIVE_PROGRESS_OPTIONS], [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  for (const value of [null, undefined, '', ' ', 0, -10, 5, 101, false, true]) assert.equal(isValidSubmittedProgress({ delivery_progress: value }), false)
  for (const value of POSITIVE_PROGRESS_OPTIONS) assert.equal(isValidSubmittedProgress({ delivery_progress: value }), true)
  assert.equal(isValidSubmittedProgress({ existing_record_id: 'old', _original_progress_missing: true, delivery_progress: null }), true)
  assert.equal(isValidSubmittedProgress({ existing_record_id: 'old', _original_progress_missing: false, delivery_progress: null }), false)
  assert.equal(isValidSubmittedProgress({ existing_record_id: 'fake-old-id', delivery_progress: null }), false)
  assert.equal(isValidSubmittedProgress({ existing_record_id: 'old', delivery_progress: 0 }), false)
  assert.equal(isValidSubmittedProgress({ existing_record_id: 'old', delivery_progress: 101 }), false)
  for (const requirement_title of FULL_CREDIT_TITLES) assert.equal(isValidSubmittedProgress({ requirement_title, delivery_progress: null }), true)
})
console.log(`${checked} checks passed`)
