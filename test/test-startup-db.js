import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tempDir = mkdtempSync(path.join(tmpdir(), 'mcp-cdp-startup-'));
const projectDir = path.resolve(import.meta.dirname, '..');

function verifyNewDatabase(mode, args) {
  const dbPath = path.join(tempDir, mode, 'nested', 'cdp.sqlite');
  assert.equal(existsSync(dbPath), false);
  const result = spawnSync(process.execPath, ['--no-warnings', ...args], {
    cwd: projectDir,
    env: { ...process.env, CDP_DB_PATH: dbPath },
    input: '',
    encoding: 'utf8',
    timeout: 5000
  });
  assert.equal(result.status, 0, `${mode} startup failed: ${result.stderr}`);
  assert.equal(existsSync(dbPath), true, `${mode} did not create SQLite file`);
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().count, 12);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customers').get().count, 0);
  db.close();
}

try {
  verifyNewDatabase('stdio', ['src/index.js']);
  verifyNewDatabase('http', [
    '--input-type=module', '-e',
    "import { createHttpMcpServer } from './src/http.js'; createHttpMcpServer();"
  ]);
  console.log('[PASS] stdio and HTTP startup create a missing SQLite file and schema');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
