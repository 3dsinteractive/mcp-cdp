import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tempDir = mkdtempSync(path.join(tmpdir(), 'mcp-cdp-reset-'));
const dbPath = path.join(tempDir, 'cdp.sqlite');
const env = { ...process.env, CDP_DB_PATH: dbPath };

function run(script) {
  const result = spawnSync(process.execPath, ['--no-warnings', script], {
    cwd: path.resolve(import.meta.dirname, '..'), env, encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${script} failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

try {
  run('src/seed.js');
  const db = new DatabaseSync(dbPath);
  assert.ok(db.prepare('SELECT COUNT(*) AS count FROM customers').get().count > 0);
  db.close();

  assert.match(run('src/reset.js'), /Reset complete/);
  const resetDb = new DatabaseSync(dbPath);
  const tables = resetDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  assert.equal(tables.length, 12);
  for (const { name } of tables) {
    assert.equal(resetDb.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count, 0, `${name} is not empty`);
  }
  resetDb.prepare("INSERT INTO customers (id, first_name) VALUES ('after_reset', 'Test')").run();
  assert.equal(resetDb.prepare('SELECT COUNT(*) AS count FROM customers').get().count, 1);
  resetDb.close();
  console.log('[PASS] Reset clears all CDP data in an isolated SQLite database and keeps the schema');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
