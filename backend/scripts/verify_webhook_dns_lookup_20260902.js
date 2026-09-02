const assert = require('assert');
const dns = require('dns');
const { __internals } = require('../src/services/AutoTaskService');

const originalLookup = dns.lookup;

function runLookup(options, resolved) {
  return new Promise((resolve, reject) => {
    dns.lookup = (_hostname, lookupOptions, callback) => {
      try {
        assert.strictEqual(lookupOptions.all, true);
        assert.strictEqual(lookupOptions.verbatim, true);
        callback(null, resolved);
      } catch (error) {
        callback(error);
      }
    };
    __internals.publicDnsLookup('oapi.dingtalk.com', options, (error, ...values) => {
      if (error) return reject(error);
      resolve(values);
    });
  });
}

async function main() {
  const resolved = [
    { address: '127.0.0.1', family: 4 },
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 }
  ];

  const [address, family] = await runLookup({ all: false }, resolved);
  assert.strictEqual(address, '8.8.8.8');
  assert.strictEqual(family, 4);

  const [addresses] = await runLookup({ all: true }, resolved);
  assert.deepStrictEqual(addresses, [
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 }
  ]);

  await assert.rejects(
    runLookup({ all: true }, [{ address: '127.0.0.1', family: 4 }]),
    /webhook 域名未解析到公网地址/
  );

  console.log('PASS webhook DNS lookup supports single and all-address callbacks');
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    dns.lookup = originalLookup;
  });
