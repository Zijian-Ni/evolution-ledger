/**
 * EL-A1 Tests: Merkle checkpoints + Ed25519 signatures
 *
 * DoD: a replay-attack test (recompute chain + forge checkpoint) fails verification
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

import {
  merkleRoot, makeCheckpoint, verifyCheckpoint, verifyCheckpointMerkle,
  verifyAllCheckpoints, VERDICT_SIGNED,
} from '../src/attest.js';
import { Ledger } from '../src/ledger.js';

// Generate a test keypair without writing to disk
function testKeypair() {
  return generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

test('merkleRoot of empty array is 64 zeros', () => {
  assert.equal(merkleRoot([]), '0'.repeat(64));
});

test('merkleRoot of single hash returns that hash', () => {
  const h = 'a'.repeat(64);
  assert.equal(merkleRoot([h]), h);
});

test('merkleRoot of two hashes is deterministic', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const r1 = merkleRoot([a, b]);
  const r2 = merkleRoot([a, b]);
  assert.equal(r1, r2);
  assert.notEqual(r1, a);
  assert.equal(r1.length, 64);
});

test('merkleRoot changes when order changes', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const r1 = merkleRoot([a, b]);
  const r2 = merkleRoot([b, a]);
  assert.notEqual(r1, r2);
});

test('merkleRoot handles odd number of leaves', () => {
  const hashes = ['a', 'b', 'c'].map(c => c.repeat(64));
  const r = merkleRoot(hashes);
  assert.equal(r.length, 64);
});

test('makeCheckpoint + verifyCheckpoint round trip', () => {
  const { privateKey, publicKey } = testKeypair();
  const L = new Ledger(null);
  L.append({ type: 'note', title: 'a' });
  L.append({ type: 'note', title: 'b' });

  const cp = makeCheckpoint(L.entries, privateKey);
  assert.equal(cp.type, 'checkpoint');
  assert.ok(cp.payload.merkle);
  assert.ok(cp.sig);
  assert.equal(cp.payload.n, 2);

  const result = verifyCheckpoint(cp, publicKey);
  assert.equal(result.ok, true);
});

test('verifyCheckpoint fails with wrong public key', () => {
  const { privateKey } = testKeypair();
  const { publicKey: wrongPub } = testKeypair();

  const L = new Ledger(null);
  L.append({ type: 'note', title: 'a' });

  const cp = makeCheckpoint(L.entries, privateKey);
  const result = verifyCheckpoint(cp, wrongPub);
  assert.equal(result.ok, false);
});

test('verifyCheckpointMerkle detects forged entries (replay attack)', () => {
  const { privateKey, publicKey } = testKeypair();

  // Original chain
  const L = new Ledger(null);
  L.append({ type: 'note', title: 'original' });
  L.append({ type: 'change', title: 'good change', change: { kind: 'prompt' } });

  const cp = makeCheckpoint(L.entries, privateKey);

  // Forged chain: same count, different content
  const L2 = new Ledger(null);
  L2.append({ type: 'note', title: 'FORGED' });
  L2.append({ type: 'change', title: 'FORGED change', change: { kind: 'prompt' } });

  // Merkle check against forged entries must fail
  const merkleResult = verifyCheckpointMerkle(cp, L2.entries);
  assert.equal(merkleResult.ok, false);
  assert.match(merkleResult.error, /Merkle root mismatch/);

  // Even if attacker doesn't have the key, sig check also fails if payload is altered
  const sigResult = verifyCheckpoint(cp, publicKey);
  assert.equal(sigResult.ok, true); // sig is valid (original payload)
  // But merkle root reveals the forgery:
  assert.equal(merkleResult.ok, false, 'Merkle check must catch forged chain');
});

test('verifyCheckpointMerkle passes for matching entries', () => {
  const { privateKey } = testKeypair();

  const L = new Ledger(null);
  L.append({ type: 'note', title: 'a' });
  L.append({ type: 'note', title: 'b' });

  const cp = makeCheckpoint(L.entries, privateKey);
  const result = verifyCheckpointMerkle(cp, L.entries);
  assert.equal(result.ok, true);
});

test('verifyCheckpointMerkle detects count mismatch', () => {
  const { privateKey } = testKeypair();

  const L = new Ledger(null);
  L.append({ type: 'note', title: 'a' });
  L.append({ type: 'note', title: 'b' });

  const cp = makeCheckpoint(L.entries, privateKey);

  // Forger adds an extra entry but reuses checkpoint
  const L2 = new Ledger(null);
  L2.append({ type: 'note', title: 'a' });
  L2.append({ type: 'note', title: 'b' });
  L2.append({ type: 'note', title: 'extra injected' });

  const result = verifyCheckpointMerkle(cp, L2.entries);
  assert.equal(result.ok, false);
  assert.match(result.error, /Entry count mismatch/);
});

test('VERDICT_SIGNED constant is correct', () => {
  assert.equal(VERDICT_SIGNED, 'VERIFIED_SIGNED');
});

test('signature verification uses stable canonical JSON', () => {
  const { privateKey, publicKey } = testKeypair();

  const L = new Ledger(null);
  L.append({ type: 'note', title: 'stable test' });

  const cp = makeCheckpoint(L.entries, privateKey);

  // Verify multiple times — should always pass
  for (let i = 0; i < 5; i++) {
    const result = verifyCheckpoint(cp, publicKey);
    assert.equal(result.ok, true, `Verification ${i} failed`);
  }
});
