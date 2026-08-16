/**
 * EL-1 Tests: External anchoring + four-state verify
 *
 * DoD: A test that recomputes the whole chain and then gets
 * HISTORY_REWRITTEN from verify when anchors exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { Ledger } from '../src/ledger.js';
import {
  anchorToGit, listGitAnchors, verifyWithAnchors,
  VERDICT, shouldAutoAnchor, DEFAULT_ANCHOR_INTERVAL,
} from '../src/anchor.js';

function initGitRepo(dir) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  // Need at least one commit for notes to attach to
  writeFileSync(join(dir, 'README.md'), '# test');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
}

test('VERDICT constants are defined', () => {
  assert.equal(VERDICT.CHAIN_BROKEN, 'CHAIN_BROKEN');
  assert.equal(VERDICT.HISTORY_REWRITTEN, 'HISTORY_REWRITTEN');
  assert.equal(VERDICT.VERIFIED_ANCHORED, 'VERIFIED_ANCHORED');
  assert.equal(VERDICT.VERIFIED_LOCAL_ONLY, 'VERIFIED_LOCAL_ONLY');
});

test('shouldAutoAnchor triggers at multiples of interval', () => {
  assert.equal(shouldAutoAnchor(0), false);
  assert.equal(shouldAutoAnchor(10), true);
  assert.equal(shouldAutoAnchor(20), true);
  assert.equal(shouldAutoAnchor(15), false);
  assert.equal(shouldAutoAnchor(5, 5), true);
  assert.equal(shouldAutoAnchor(3, 5), false);
});

test('VERIFIED_LOCAL_ONLY when chain ok but no anchors', () => {
  const L = new Ledger(null);
  L.append({ type: 'note', title: 'hello' });
  L.append({ type: 'note', title: 'world' });

  // Use a dir with no git repo (will fail to read anchors → empty)
  const tmpDir = mkdtempSync(join(tmpdir(), 'eledger-noanchor-'));
  try {
    const result = verifyWithAnchors(L, tmpDir);
    assert.equal(result.verdict, VERDICT.VERIFIED_LOCAL_ONLY);
    assert.equal(result.ok, true);
    assert.equal(result.anchors.length, 0);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('CHAIN_BROKEN when entries are tampered', () => {
  const L = new Ledger(null);
  L.append({ type: 'note', title: 'a' });
  L.append({ type: 'note', title: 'b' });
  L.entries[0].title = 'tampered';  // break the chain

  const result = verifyWithAnchors(L, process.cwd());
  assert.equal(result.verdict, VERDICT.CHAIN_BROKEN);
  assert.equal(result.ok, false);
});

test('HISTORY_REWRITTEN: recomputed chain does not match anchor (DoD)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'eledger-rewrite-'));
  const ledgerPath = join(tmpDir, 'ledger.jsonl');

  try {
    initGitRepo(tmpDir);

    // Build initial ledger
    const L = new Ledger(null);
    L.append({ type: 'note', title: 'first' });
    L.append({ type: 'change', title: 'prompt tweak', change: { kind: 'prompt', path: 'SOUL.md' } });
    L.append({ type: 'eval', title: 'evaluation', eval: { metric: 'tokens', passed: true } });
    writeFileSync(ledgerPath, L.toJSONL());

    // Anchor the current chain head (Layer 1)
    const anchorResult = anchorToGit(L.tipHash, ledgerPath, tmpDir);
    assert.equal(anchorResult.ok, true, 'git anchor should succeed: ' + (anchorResult.error || ''));

    // Now "rewrite" history: build a DIFFERENT chain from scratch
    const L2 = new Ledger(null);
    L2.append({ type: 'note', title: 'first — rewritten' });
    L2.append({ type: 'change', title: 'prompt tweak FORGED', change: { kind: 'prompt', path: 'SOUL.md' } });
    L2.append({ type: 'eval', title: 'evaluation forged', eval: { metric: 'tokens', passed: true } });
    // Overwrite the ledger file with the forged chain
    writeFileSync(ledgerPath, L2.toJSONL());

    // Verify the forged ledger — should get HISTORY_REWRITTEN
    const verifyResult = verifyWithAnchors(L2, tmpDir);

    assert.equal(verifyResult.verdict, VERDICT.HISTORY_REWRITTEN,
      `Expected HISTORY_REWRITTEN, got ${verifyResult.verdict}. Original tip: ${L.tipHash.slice(0,12)}, forged tip: ${L2.tipHash.slice(0,12)}`);
    assert.equal(verifyResult.ok, false);
    assert.ok(verifyResult.issues.length > 0, 'should have issues');
    assert.ok(
      verifyResult.issues[0].error.includes('anchor hash not in chain'),
      `Expected 'anchor hash not in chain' error, got: ${verifyResult.issues[0].error}`
    );

  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('VERIFIED_ANCHORED when chain matches anchor', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'eledger-anchored-'));
  const ledgerPath = join(tmpDir, 'ledger.jsonl');

  try {
    initGitRepo(tmpDir);

    const L = new Ledger(null);
    L.append({ type: 'note', title: 'entry1' });
    L.append({ type: 'note', title: 'entry2' });
    writeFileSync(ledgerPath, L.toJSONL());

    const anchorResult = anchorToGit(L.tipHash, ledgerPath, tmpDir);
    assert.equal(anchorResult.ok, true, 'anchor should succeed');

    // Now verify — chain matches the anchor
    const L2 = Ledger.fromJSONL(readFileSync(ledgerPath, 'utf8'));
    const result = verifyWithAnchors(L2, tmpDir);
    assert.equal(result.verdict, VERDICT.VERIFIED_ANCHORED);
    assert.equal(result.ok, true);
    assert.ok(result.anchors.length > 0);

  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('listGitAnchors returns empty array in non-git dir', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'eledger-noanchors-'));
  try {
    const anchors = listGitAnchors(tmpDir);
    assert.deepEqual(anchors, []);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});
