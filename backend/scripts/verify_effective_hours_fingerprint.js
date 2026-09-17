/* Read-only local DB fingerprint. Secret/token fields are excluded before SELECT. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
require('dotenv').config({ quiet: true });
assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST), 'Fingerprint is restricted to the local database');
const sequelize = require('../src/config/database');
const { QueryTypes, Transaction } = require('sequelize');
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8) || 'before';
assert.ok(['before', 'after'].includes(phase));
const OUT = path.resolve(__dirname, '../../docs/@test/effective_hours_20260917');
const tables = ['collection_tasks', 'staff', 'product_managers', 'work_records', 'product_manager_work_records', 'match_groups', 'staff_status_history', 'product_manager_status_history'];
const quote = value => '`' + value.replaceAll('`', '``') + '`';
const safeColumn = column => !/token|pass(word)?|secret|credential|webhook|url/i.test(column);
async function main() {
  const snapshot = { capturedAt: new Date().toISOString(), phase, localOnly: true, mode: 'SELECT only; secret/token columns excluded', tables: {} };
  await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
    for (const table of tables) {
      const metadata = await sequelize.query(`SHOW COLUMNS FROM ${quote(table)}`, { type: QueryTypes.SELECT, transaction });
      const columns = metadata.map(row => row.Field).filter(safeColumn).sort();
      const rows = await sequelize.query(`SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)}`, { type: QueryTypes.SELECT, transaction });
      const canonical = rows.map(row => JSON.stringify(columns.map(column => row[column]))).sort();
      const info = { count: rows.length, sha256: crypto.createHash('sha256').update(canonical.join('\n')).digest('hex'), columnCount: columns.length };
      if (columns.includes('hours')) info.hours = Number(rows.reduce((sum, row) => sum + Number(row.hours || 0), 0).toFixed(2));
      if (columns.includes('delivery_progress')) {
        info.nullProgress = rows.filter(row => row.delivery_progress === null || row.delivery_progress === undefined).length;
        info.zeroProgress = rows.filter(row => row.delivery_progress !== null && row.delivery_progress !== undefined && Number(row.delivery_progress) === 0).length;
      }
      snapshot.tables[table] = info;
    }
  });
  fs.mkdirSync(OUT, { recursive: true });
  const target = path.join(OUT, `db-${phase}.json`); fs.writeFileSync(target, JSON.stringify(snapshot, null, 2));
  if (phase === 'after') {
    const before = JSON.parse(fs.readFileSync(path.join(OUT, 'db-before.json'), 'utf8'));
    assert.deepEqual(snapshot.tables, before.tables, 'Local business rows changed between fingerprints');
    snapshot.comparison = 'PASS: all selected business counts, raw-row hashes, hours and null/zero progress unchanged';
    fs.writeFileSync(target, JSON.stringify(snapshot, null, 2));
  }
  console.log(JSON.stringify(snapshot));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => sequelize.close());
