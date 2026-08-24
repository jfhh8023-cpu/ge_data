const assert = require('assert');
const {
  applyOfficialHolidayAmendments,
  discoverOfficialHolidayDocument,
  discoverOfficialHolidayAmendments,
  isAllowedOfficialUrl,
  normalizeSnapshot,
  parseOfficialHolidayDocument,
  __internals
} = require('../src/services/OfficialHolidaySyncService');

const EXPECTATIONS = {
  2007: { minHoliday: 20, minAdjusted: 4 },
  2008: { minHoliday: 20, minAdjusted: 4 },
  2020: { minHoliday: 29, minAdjusted: 5 },
  2023: { minHoliday: 20, minAdjusted: 5 },
  2025: { minHoliday: 20, minAdjusted: 4 },
  2026: { minHoliday: 25, minAdjusted: 5 }
};

async function fetchOfficialHtml(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'DevTracker-HolidaySync-Test/1.0' }
  });
  assert.strictEqual(response.ok, true, `official source failed: ${url}`);
  assert.strictEqual(isAllowedOfficialUrl(response.url || url), true, 'redirect left gov.cn allowlist');
  return response.text();
}

async function verifyYear(year) {
  const source = await discoverOfficialHolidayDocument(year);
  assert.ok(source, `${year} official notice was not discovered`);
  assert.strictEqual(isAllowedOfficialUrl(source.url), true);
  const annual = parseOfficialHolidayDocument({
    year,
    html: await fetchOfficialHtml(source.url),
    source
  });
  const snapshot = await applyOfficialHolidayAmendments(annual);
  const holidays = snapshot.days.filter(day => day.is_holiday);
  const adjusted = snapshot.days.filter(day => day.is_adjusted_workday);
  const dates = new Set(snapshot.days.map(day => day.date));
  assert.strictEqual(dates.size, snapshot.days.length, `${year} has duplicate dates`);
  assert.ok(holidays.length >= EXPECTATIONS[year].minHoliday, `${year} holiday count is too small`);
  assert.ok(adjusted.length >= EXPECTATIONS[year].minAdjusted, `${year} adjusted workday count is too small`);
  return {
    year,
    source: snapshot.source_url,
    holidays: holidays.length,
    adjusted_workdays: adjusted.length,
    version: snapshot.version
  };
}

async function main() {
  const years = [];
  for (const year of Object.keys(EXPECTATIONS).map(Number)) {
    years.push(await verifyYear(year));
  }

  const source2020 = await discoverOfficialHolidayDocument(2020);
  const annual2020 = parseOfficialHolidayDocument({
    year: 2020,
    html: await fetchOfficialHtml(source2020.url),
    source: source2020
  });
  const amendments2020 = await discoverOfficialHolidayAmendments(2020);
  assert.strictEqual(amendments2020.length, 1);
  const amended2020 = await applyOfficialHolidayAmendments(annual2020);
  for (const date of ['2020-01-31', '2020-02-01', '2020-02-02']) {
    const day = amended2020.days.find(item => item.date === date);
    assert.ok(day, `${date} missing from 2020 extension`);
    assert.strictEqual(day.is_holiday, true);
    assert.strictEqual(day.is_adjusted_workday, false);
  }

  const snapshot2026 = years.find(item => item.year === 2026);
  assert.ok(snapshot2026);
  const source2026 = await discoverOfficialHolidayDocument(2026);
  const node16Source2026 = await discoverOfficialHolidayDocument(2026, __internals.nodeHttpFetch);
  assert.ok(node16Source2026, 'Node 16 HTTP fallback did not discover the 2026 official notice');
  assert.strictEqual(isAllowedOfficialUrl(node16Source2026.url), true);
  const parsed2026 = parseOfficialHolidayDocument({
    year: 2026,
    html: await fetchOfficialHtml(source2026.url),
    source: source2026
  });
  for (const date of ['2026-01-04', '2026-02-14', '2026-02-28', '2026-09-20', '2026-10-10']) {
    assert.strictEqual(parsed2026.days.find(item => item.date === date)?.is_adjusted_workday, true, `${date} must be an adjusted workday`);
  }

  const noResultFetch = async () => ({
    ok: true,
    headers: { get: () => null },
    text: async () => JSON.stringify({ code: 1001 })
  });
  assert.strictEqual(await discoverOfficialHolidayDocument(2027, noResultFetch), null);
  assert.strictEqual(isAllowedOfficialUrl('https://www.gov.cn/zhengce/example.htm'), true);
  assert.strictEqual(isAllowedOfficialUrl('https://www.gov.cn.evil.example/holiday'), false);
  assert.throws(() => normalizeSnapshot({
    year: 2026,
    days: [
      ...Array.from({ length: 7 }, (_, index) => ({
        date: `2026-01-${String(index + 1).padStart(2, '0')}`,
        holiday_name: 'test',
        range_id: 'test',
        is_holiday: true,
        is_adjusted_workday: false
      })),
      {
        date: '2026-01-01',
        holiday_name: 'conflict',
        range_id: 'conflict',
        is_holiday: false,
        is_adjusted_workday: true
      }
    ]
  }), /同时被标记为放假和补班/);

  process.stdout.write(JSON.stringify({
    ok: true,
    verified_years: years,
    amendment_2020: {
      source: amendments2020[0].url,
      extended_days: ['2020-01-31', '2020-02-01', '2020-02-02']
    },
    future_unpublished: 'pending_without_fabrication',
    node16_http_fallback: 'passed',
    allowlist_and_conflict_validation: 'passed'
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
