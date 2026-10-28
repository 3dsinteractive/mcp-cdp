import { getDb } from './db.js';

// Delete child rows before their parents so foreign keys remain enabled.
const TABLES = [
  'journey_step_logs',
  'journey_enrollments',
  'campaign_logs',
  'segment_members',
  'consent_logs',
  'customer_consents',
  'customer_links',
  'events',
  'journeys',
  'campaigns',
  'segments',
  'customers'
];

export function resetDatabase(db = getDb()) {
  const deleted = {};
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const table of TABLES) {
      deleted[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
      db.exec(`DELETE FROM ${table};`);
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
  return deleted;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const deleted = resetDatabase();
  const total = Object.values(deleted).reduce((sum, count) => sum + count, 0);
  console.log(`Reset complete: deleted ${total} rows from ${TABLES.length} CDP tables.`);
}
