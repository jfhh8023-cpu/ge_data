/** Read-only: list work_records touched since a given date (default today), to explain fingerprint drift. */
const { sequelize } = require('../src/models');
const since = process.argv[2] || '2026-09-20';
(async () => {
  const [rows] = await sequelize.query(
    'SELECT id, requirement_title, staff_id, task_id, version, delivery_progress, hours, created_at, updated_at FROM work_records WHERE updated_at >= :since OR created_at >= :since ORDER BY updated_at DESC LIMIT 20',
    { replacements: { since } });
  console.log(`rows touched since ${since}: ${rows.length}`);
  for (const row of rows) console.log(JSON.stringify(row));
  const [[max]] = await sequelize.query('SELECT MAX(updated_at) mx, MAX(created_at) mc FROM work_records');
  console.log('max:', JSON.stringify(max));
  await sequelize.close();
})().catch(error => { console.error(error.message); process.exit(1); });
