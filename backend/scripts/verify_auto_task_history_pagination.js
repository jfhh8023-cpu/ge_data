const assert = require('assert');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const {
  sequelize,
  AutoTaskMessage,
  AutoTaskRule,
  AutoTaskRunLog
} = require('../src/models');

const API_BASE = 'http://127.0.0.1:3001';
const TEST_PREFIX = 'CODEX-HISTORY-PAGE-20260901';
const PAGE_SIZES = [10, 20, 50, 100, 200, 300, 500, 1000];

function requestJson(path, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : '';
    const request = http.request(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      } : {}
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch (error) {
          reject(new Error(`接口返回非 JSON：${text.slice(0, 200)}`));
          return;
        }
        resolve({ status: response.statusCode, payload });
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function cleanup(ruleId) {
  if (!ruleId) return;
  await AutoTaskMessage.destroy({ where: { rule_id: ruleId } });
  await AutoTaskRunLog.destroy({ where: { rule_id: ruleId } });
  await AutoTaskRule.destroy({ where: { id: ruleId } });
}

async function main() {
  const ruleId = uuidv4();
  try {
    await AutoTaskRule.create({
      id: ruleId,
      name: `${TEST_PREFIX}-${ruleId.slice(0, 8)}`,
      enabled: false,
      task_type: 'task_create_notify',
      action_mode: 'run_and_notify',
      schedule_type: 'weekly',
      week_days: [1],
      execute_time: '09:00:00',
      notify_enabled: false,
      created_at: new Date('2026-09-01T00:00:00+08:00'),
      updated_at: new Date('2026-09-01T00:00:00+08:00')
    });

    const base = new Date('2026-09-01T01:00:00+08:00').getTime();
    await AutoTaskMessage.bulkCreate(Array.from({ length: 25 }, (_, index) => ({
      id: uuidv4(),
      rule_id: ruleId,
      level: index % 3 === 0 ? 'error' : 'success',
      action: 'history_page_test',
      message: `${TEST_PREFIX} message ${index + 1}`,
      created_at: new Date(base + index * 2 * 60 * 1000)
    })));
    await AutoTaskRunLog.bulkCreate(Array.from({ length: 10 }, (_, index) => ({
      id: uuidv4(),
      rule_id: ruleId,
      scheduled_at: new Date(base + (index * 2 + 1) * 60 * 1000),
      event_type: 'auto_task',
      status: index % 2 === 0 ? 'success' : 'notify_failed',
      message: `${TEST_PREFIX} run ${index + 1}`,
      notify_status: index % 2 === 0 ? 'success' : 'failed',
      attempt_count: index % 2 === 0 ? 1 : 3,
      created_at: new Date(base + (index * 2 + 1) * 60 * 1000)
    })));

    const first = await requestJson(`/api/settings/auto-tasks/${ruleId}/history?page=1&page_size=20`);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.payload.data.total, 35);
    assert.strictEqual(first.payload.data.page, 1);
    assert.strictEqual(first.payload.data.page_size, 20);
    assert.strictEqual(first.payload.data.total_pages, 2);
    assert.strictEqual(first.payload.data.items.length, 20);

    const second = await requestJson(`/api/settings/auto-tasks/${ruleId}/history?page=2&page_size=20`);
    assert.strictEqual(second.payload.data.items.length, 15);
    const combinedIds = [
      ...first.payload.data.items.map(item => item.id),
      ...second.payload.data.items.map(item => item.id)
    ];
    assert.strictEqual(new Set(combinedIds).size, 35, '分页记录不得重复或遗漏');
    const combinedTimes = [
      ...first.payload.data.items,
      ...second.payload.data.items
    ].map(item => new Date(item.created_at).getTime());
    assert.deepStrictEqual(combinedTimes, [...combinedTimes].sort((a, b) => b - a), '历史必须按最新时间倒序');

    const sizeEvidence = {};
    for (const pageSize of PAGE_SIZES) {
      const response = await requestJson(`/api/settings/auto-tasks/${ruleId}/history?page=1&page_size=${pageSize}`);
      assert.strictEqual(response.payload.data.page_size, pageSize);
      assert.strictEqual(response.payload.data.items.length, Math.min(pageSize, 35));
      sizeEvidence[pageSize] = response.payload.data.items.length;
    }

    const invalidSize = await requestJson(`/api/settings/auto-tasks/${ruleId}/history?page=1&page_size=15`);
    assert.strictEqual(invalidSize.payload.data.page_size, 20);
    const mixedSize = await requestJson(`/api/settings/auto-tasks/${ruleId}/history?page=1&page_size=50abc`);
    assert.strictEqual(mixedSize.payload.data.page_size, 20);
    const overflow = await requestJson(`/api/settings/auto-tasks/${ruleId}/history?page=999&page_size=20`);
    assert.strictEqual(overflow.payload.data.page, 2);
    assert.strictEqual(overflow.payload.data.items.length, 15);

    const deleteTarget = first.payload.data.items[0];
    const deleted = await requestJson(`/api/settings/auto-tasks/${ruleId}/messages`, {
      method: 'DELETE',
      body: { ids: [deleteTarget.id] }
    });
    assert.strictEqual(deleted.status, 200);
    const afterDelete = await requestJson(`/api/settings/auto-tasks/${ruleId}/history?page=999&page_size=20`);
    assert.strictEqual(afterDelete.payload.data.total, 34);
    assert.strictEqual(afterDelete.payload.data.page, 2);
    assert.strictEqual(afterDelete.payload.data.items.length, 14);

    const missing = await requestJson(`/api/settings/auto-tasks/${uuidv4()}/history?page=1&page_size=20`);
    assert.strictEqual(missing.status, 404);

    console.log(JSON.stringify({
      ok: true,
      evidence: {
        total_before_delete: 35,
        page_1_items: 20,
        page_2_items: 15,
        total_after_delete: 34,
        overflow_page_clamped_to: 2,
        invalid_page_size_fallback: invalidSize.payload.data.page_size,
        page_sizes: sizeEvidence
      }
    }, null, 2));
  } finally {
    await cleanup(ruleId);
    await sequelize.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
