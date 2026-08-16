/**
 * EL-2 Tests: JSON record validator + stdin pipe
 *
 * DoD: 100 piped writes then verify passes; invalid JSON gives a clear error
 * and does not corrupt the ledger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateJsonRecord } from '../src/record.js';
import { Ledger } from '../src/ledger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '../src/cli.js');

// ─── validateJsonRecord unit tests ────────────────────────────────────────

test('validateJsonRecord accepts minimal valid record', () => {
  const result = validateJsonRecord('{"type":"note","title":"hello"}');
  assert.equal(result.ok, true);
  assert.equal(result.data.type, 'note');
  assert.equal(result.data.title, 'hello');
});

test('validateJsonRecord strips id/ts/prevHash/hash', () => {
  const raw = JSON.stringify({
    type: 'note', title: 'x',
    id: 'abc', ts: '2020-01-01T00:00:00Z',
    prevHash: 'deadbeef', hash: '123456',
  });
  const result = validateJsonRecord(raw);
  assert.equal(result.ok, true);
  assert.equal(result.data.id, undefined);
  assert.equal(result.data.ts, undefined);
  assert.equal(result.data.hash, undefined);
});

test('validateJsonRecord rejects missing type', () => {
  const result = validateJsonRecord('{"title":"hello"}');
  assert.equal(result.ok, false);
  assert.match(result.error, /type/i);
});

test('validateJsonRecord rejects invalid type', () => {
  const result = validateJsonRecord('{"type":"invalid","title":"x"}');
  assert.equal(result.ok, false);
  assert.match(result.error, /type/i);
});

test('validateJsonRecord rejects missing title', () => {
  const result = validateJsonRecord('{"type":"note"}');
  assert.equal(result.ok, false);
  assert.match(result.error, /title/i);
});

test('validateJsonRecord rejects empty string', () => {
  const result = validateJsonRecord('');
  assert.equal(result.ok, false);
  assert.match(result.error, /empty/i);
});

test('validateJsonRecord rejects invalid JSON', () => {
  const result = validateJsonRecord('{not json}');
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid JSON/i);
});

test('validateJsonRecord rejects array input', () => {
  const result = validateJsonRecord('[{"type":"note","title":"x"}]');
  assert.equal(result.ok, false);
});

test('validateJsonRecord accepts full eval entry', () => {
  const raw = JSON.stringify({
    type: 'eval',
    title: 'trim SOUL.md',
    eval: { metric: 'tokens', before: 1200, after: 800, passed: true },
  });
  const result = validateJsonRecord(raw);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.eval, { metric: 'tokens', before: 1200, after: 800, passed: true });
});

test('validateJsonRecord rejects tags as non-array', () => {
  const raw = JSON.stringify({ type: 'note', title: 'x', tags: 'not-an-array' });
  const result = validateJsonRecord(raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /tags/i);
});

// ─── CLI pipe test (100 writes) ───────────────────────────────────────────

test('100 piped writes via CLI then verify passes', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'eledger-record-'));
  const ledgerPath = join(tmpDir, 'ledger.jsonl');

  try {
    // Initialize ledger
    const initResult = spawnSync(process.execPath, [CLI, 'init', ledgerPath], {
      env: process.env, encoding: 'utf8',
    });
    assert.equal(initResult.status, 0, `init failed: ${initResult.stderr}`);

    // Pipe 100 eval records
    for (let i = 0; i < 100; i++) {
      const record = JSON.stringify({
        type: 'eval',
        title: `eval-${i}`,
        eval: { metric: 'tokens', before: 1000, after: 900 - i, passed: i % 7 !== 0 },
      });
      const result = spawnSync(process.execPath, [CLI, 'record', '--json', '--ledger', ledgerPath], {
        input: record,
        env: process.env,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0,
        `Record ${i} failed with status ${result.status}: ${result.stderr}`);
      const out = JSON.parse(result.stdout.trim());
      assert.equal(out.ok, true, `Record ${i} returned ok=false: ${JSON.stringify(out)}`);
    }

    // Verify chain
    const L = Ledger.fromJSONL(readFileSync(ledgerPath, 'utf8'));
    const v = L.verify();
    assert.equal(v.ok, true, `Chain broken after 100 writes: ${JSON.stringify(v.issues)}`);
    // +1 for genesis note
    assert.equal(L.entries.length, 101, `Expected 101 entries, got ${L.entries.length}`);

  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('invalid JSON to CLI record --json gives machine-readable error and does not corrupt', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'eledger-invalid-'));
  const ledgerPath = join(tmpDir, 'ledger.jsonl');

  try {
    // Initialize
    spawnSync(process.execPath, [CLI, 'init', ledgerPath], { env: process.env });

    // Send invalid JSON
    const result = spawnSync(process.execPath, [CLI, 'record', '--json', '--ledger', ledgerPath], {
      input: '{bad json',
      env: process.env,
      encoding: 'utf8',
    });

    // Should fail with exit code 2
    assert.equal(result.status, 2, `Expected exit 2, got ${result.status}`);

    // Stderr should have machine-readable error
    const errObj = JSON.parse(result.stderr.trim());
    assert.equal(errObj.ok, false);
    assert.ok(errObj.error, 'should have error message');

    // Ledger should still be intact (only genesis entry)
    const L = Ledger.fromJSONL(readFileSync(ledgerPath, 'utf8'));
    assert.equal(L.verify().ok, true, 'Ledger corrupted after failed write');
    assert.equal(L.entries.length, 1, 'Should have only genesis entry');

  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('invalid type to CLI record --json gives clear error', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'eledger-badtype-'));
  const ledgerPath = join(tmpDir, 'ledger.jsonl');

  try {
    spawnSync(process.execPath, [CLI, 'init', ledgerPath], { env: process.env });

    const result = spawnSync(process.execPath, [CLI, 'record', '--json', '--ledger', ledgerPath], {
      input: JSON.stringify({ type: 'bogus', title: 'x' }),
      env: process.env,
      encoding: 'utf8',
    });

    assert.equal(result.status, 2);
    const errObj = JSON.parse(result.stderr.trim());
    assert.equal(errObj.ok, false);
    assert.match(errObj.error, /type/i);

  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});
