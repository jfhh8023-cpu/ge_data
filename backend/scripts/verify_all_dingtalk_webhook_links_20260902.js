const assert = require('assert');
const http = require('http');

process.env.ALLOW_LOCAL_WEBHOOK_TEST = '1';

const {
  sendDingTalkWebhook,
  __internals
} = require('../src/services/AutoTaskService');

function startReceiver() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      received.push({ path: req.url, payload: JSON.parse(raw) });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.url.startsWith('/disabled')) {
        res.end(JSON.stringify({ errcode: 400104, errmsg: 'robot template disabled' }));
        return;
      }
      res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, received, port: server.address().port });
    });
  });
}

function webhook(port, path, name) {
  return {
    id: `webhook_${path}`,
    name,
    url: `http://127.0.0.1:${port}/${path}?access_token=test_${path}`
  };
}

async function main() {
  const receiver = await startReceiver();
  const { port, received, server } = receiver;
  const noAt = { enabled: false, atAll: false, mobiles: [], missing: [] };

  try {
    const mainTargets = [
      webhook(port, 'main-a', '主通知连接 A'),
      webhook(port, 'main-b', '主通知连接 B')
    ];
    const mainResult = await sendDingTalkWebhook({
      task_type: 'task_create_notify',
      dingtalk_webhooks: mainTargets,
      dingtalk_message: '主通知多连接验证',
      dingtalk_recipients: { enabled: false }
    });
    assert.deepStrictEqual(mainResult, { total: 2, success: 2 });

    const legacyResult = await sendDingTalkWebhook({
      task_type: 'task_create_notify',
      dingtalk_webhook: webhook(port, 'legacy', '旧版单连接').url,
      dingtalk_message: '旧版字符串连接验证',
      dingtalk_recipients: { enabled: false }
    });
    assert.deepStrictEqual(legacyResult, { total: 1, success: 1 });

    const jsonTargets = [
      webhook(port, 'json-a', 'JSON 连接 A'),
      webhook(port, 'json-b', 'JSON 连接 B')
    ];
    const jsonResult = await sendDingTalkWebhook({
      task_type: 'duty_notify',
      dingtalk_webhook: JSON.stringify(jsonTargets),
      dingtalk_message: '值班通知 JSON 多连接验证',
      dingtalk_recipients: { enabled: false }
    });
    assert.deepStrictEqual(jsonResult, { total: 2, success: 2 });

    await __internals.sendDingTalkCard(
      [webhook(port, 'child', '子通知连接')],
      '子通知连接验证',
      noAt,
      'DevTracker 子通知'
    );
    await __internals.sendDingTalkCard(
      [webhook(port, 'special', '特殊通知连接')],
      '特殊日期通知连接验证',
      noAt,
      'DevTracker 特殊日期通知'
    );

    await assert.rejects(
      __internals.sendDingTalkCard(
        [
          webhook(port, 'partial-ok', '可用连接'),
          webhook(port, 'disabled', '停用连接')
        ],
        '部分失败语义验证',
        noAt,
        'DevTracker 多连接验证'
      ),
      error => /停用连接/.test(error.message) && /errcode=400104/.test(error.message)
    );

    assert.deepStrictEqual(received.map(item => item.path.split('?')[0]), [
      '/main-a',
      '/main-b',
      '/legacy',
      '/json-a',
      '/json-b',
      '/child',
      '/special',
      '/partial-ok',
      '/disabled'
    ]);
    assert.strictEqual(received.length, 9);
    received.forEach(item => {
      assert.strictEqual(item.payload.msgtype, 'markdown');
      assert.strictEqual(typeof item.payload.markdown?.title, 'string');
      assert.strictEqual(typeof item.payload.markdown?.text, 'string');
    });

    assert.throws(
      () => __internals.assertAllowedWebhookUrl(new URL('https://example.com/robot/send?access_token=test')),
      /webhook 仅允许使用钉钉官方/
    );

    console.log(JSON.stringify({
      ok: true,
      request_count: received.length,
      covered: [
        'main_multi_webhook',
        'legacy_string_webhook',
        'json_webhook_config',
        'duty_notification',
        'child_notification',
        'special_notification',
        'partial_failure_reporting',
        'official_domain_allowlist'
      ]
    }, null, 2));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
