/**
 * REQ-074: 系统启用开关。
 *  - 默认启用；关闭时必须填写内容；关闭后 buildDisabledPayload / assertSystemEnabled 生效。
 *  - 脚本结束时恢复脚本运行前的状态，不残留数据。
 *
 *   node backend/scripts/verify_req074_system_access.js
 */
const assert = require('assert');
const { sequelize } = require('../src/models');
const svc = require('../src/services/SystemAccessService');

async function main() {
  await sequelize.authenticate();
  await svc.ensureSystemSettingTable();
  const before = await svc.getSystemAccess();
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(`PASS ${name}`); } catch (err) { results.push(`FAIL ${name}: ${err.message}`); }
  };

  check('normalizeAccess default enabled', () => {
    assert.deepStrictEqual(svc.normalizeAccess(null), { enabled: true, message: '' });
    assert.deepStrictEqual(svc.normalizeAccess('not json'), { enabled: true, message: '' });
    assert.deepStrictEqual(svc.normalizeAccess('{"enabled":false,"message":"维护"}'), { enabled: false, message: '维护' });
  });

  try {
    let rejected = null;
    try { await svc.updateSystemAccess({ enabled: false, message: '  ' }); } catch (err) { rejected = err; }
    check('disable without message -> 400', () => {
      assert.ok(rejected, 'should reject');
      assert.strictEqual(rejected.status, 400);
    });

    const disabled = await svc.updateSystemAccess({ enabled: false, message: ' 系统维护中\n预计 10:00 恢复 ' });
    check('disable persists trimmed message', () => {
      assert.strictEqual(disabled.enabled, false);
      assert.strictEqual(disabled.message, '系统维护中\n预计 10:00 恢复');
    });
    check('buildDisabledPayload', () => {
      assert.deepStrictEqual(svc.buildDisabledPayload(disabled), {
        blocked: true, reason: 'system_disabled', message: '系统维护中\n预计 10:00 恢复'
      });
      assert.strictEqual(svc.buildDisabledPayload({ enabled: false, message: '' }).message, svc.DEFAULT_DISABLED_MESSAGE);
    });

    let blocked = null;
    try { await svc.assertSystemEnabled(); } catch (err) { blocked = err; }
    check('assertSystemEnabled throws 403 when disabled', () => {
      assert.ok(blocked);
      assert.strictEqual(blocked.status, 403);
      assert.strictEqual(blocked.reason, 'system_disabled');
    });

    const enabled = await svc.updateSystemAccess({ enabled: true, message: '保留内容' });
    check('re-enable keeps message for later edit', () => {
      assert.strictEqual(enabled.enabled, true);
      assert.strictEqual(enabled.message, '保留内容');
    });
    const ok = await svc.assertSystemEnabled();
    check('assertSystemEnabled passes when enabled', () => assert.strictEqual(ok.enabled, true));
  } finally {
    await svc.updateSystemAccess({ enabled: before.enabled, message: before.message || (before.enabled ? '' : svc.DEFAULT_DISABLED_MESSAGE) });
  }

  const after = await svc.getSystemAccess();
  check('state restored', () => {
    assert.strictEqual(after.enabled, before.enabled);
    assert.strictEqual(after.message, before.message);
  });

  results.forEach(line => console.log(line));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await sequelize.close();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
