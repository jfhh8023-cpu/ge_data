/* Replay the real frontend store action with deferred in-memory API responses.
 * No server, database, network, notifications or business-data writes.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/stores/stats.js'), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace('export const useStatsStore', 'const useStatsStore');

function fixture() {
  const waiting = [];
  const api = {
    get: (_url, config) => new Promise((resolve, reject) => waiting.push({ config, resolve, reject }))
  };
  const options = new Function(
    'defineStore', 'api', 'ROLE_AI_DEV', 'ROLE_AI_QUALITY', 'getRoleDefinitions',
    `${source}\nreturn useStatsStore;`
  )((_id, definition) => definition, api, 'ai_dev', 'ai_quality', () => []);
  const store = options.state();
  return { waiting, store, action: options.actions.fetchProgressDetails.bind(store) };
}

const response = role => ({
  data: { data: { role, workHours: { standardHours: role === 'ai_pm' ? 40 : 80 } } }
});

async function main() {
  let test = fixture();
  test.store.progressDetails = { role: 'old-cache' };
  const older = test.action({ scope: 'all', role: 'ai_dev' });
  assert.equal(test.store.progressDetails, null);
  const newer = test.action({ scope: 'all', role: 'ai_pm' });
  test.waiting[1].resolve(response('ai_pm'));
  assert.equal((await newer).role, 'ai_pm');
  test.waiting[0].resolve(response('ai_dev'));
  assert.equal(await older, null);
  assert.equal(test.store.progressDetails.role, 'ai_pm');
  assert.equal(test.store.progressDetails.workHours.standardHours, 40);
  assert.equal(test.store.progressDetailsLoading, false);
  console.log('PASS late older success cannot replace latest scope or capacity');

  test = fixture();
  const firstFailure = test.action({ role: 'ai_dev' });
  const newestPending = test.action({ role: 'ai_pm' });
  test.waiting[0].reject(new Error('old failure'));
  assert.equal(await firstFailure, null);
  assert.equal(test.store.progressDetails, null);
  assert.equal(test.store.progressDetailsLoading, true);
  test.waiting[1].resolve(response('ai_pm'));
  await newestPending;
  assert.equal(test.store.progressDetails.role, 'ai_pm');
  assert.equal(test.store.progressDetailsLoading, false);
  console.log('PASS older failure preserves latest in-flight loading and data state');

  test = fixture();
  const firstSuccess = test.action({ role: 'ai_dev' });
  const laterPending = test.action({ role: 'ai_pm' });
  test.waiting[0].resolve(response('ai_dev'));
  assert.equal(await firstSuccess, null);
  assert.equal(test.store.progressDetailsLoading, true);
  assert.equal(test.store.progressDetails, null);
  const expectedError = new Error('latest failure');
  test.waiting[1].reject(expectedError);
  await assert.rejects(laterPending, error => error === expectedError);
  assert.equal(test.store.progressDetails, null);
  assert.equal(test.store.progressDetailsLoading, false);
  console.log('PASS latest failure clears cache, rejects original error, and closes loading');

  test = fixture();
  const stale = test.action({ role: 'ai_dev' });
  const failedLatest = test.action({ role: 'ai_pm' });
  test.waiting[1].reject(new Error('latest failed first'));
  await assert.rejects(failedLatest);
  test.waiting[0].resolve(response('ai_dev'));
  assert.equal(await stale, null);
  assert.equal(test.store.progressDetails, null);
  assert.equal(test.store.progressDetailsLoading, false);
  console.log('PASS late stale success cannot resurrect data after latest failure');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
