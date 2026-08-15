import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, createEntry, hashEntry, formatMarkdown } from '../src/ledger.js';

test('append builds hash chain', () => {
  const L = new Ledger(null);
  const a = L.append({ type: 'note', title: 'first' });
  const b = L.append({ type: 'note', title: 'second' });
  assert.equal(a.prevHash, null);
  assert.equal(b.prevHash, a.hash);
  assert.ok(a.hash.length === 64);
});

test('verify detects tampering', () => {
  const L = new Ledger(null);
  L.append({ type: 'note', title: 'a' });
  L.append({ type: 'note', title: 'b' });
  assert.equal(L.verify().ok, true);
  L.entries[0].title = 'tampered';
  assert.equal(L.verify().ok, false);
});

test('rollback appends compensating entry and never deletes', () => {
  const L = new Ledger(null);
  const c = L.append({
    type: 'change',
    title: 'prompt tweak',
    change: { kind: 'prompt', path: 'SOUL.md', before: 'old', after: 'new' },
  });
  const before = L.entries.length;
  const r = L.rollback(c.hash, { reason: 'regression' });
  assert.equal(L.entries.length, before + 1);
  assert.equal(r.type, 'rollback');
  assert.equal(r.rollbackOf, c.hash);
  assert.equal(r.change.after, 'old');
  // original still present
  assert.ok(L.entries.find(e => e.hash === c.hash));
});

test('headState excludes rolled back changes', () => {
  const L = new Ledger(null);
  const c1 = L.append({ type: 'change', title: 'c1', change: { kind: 'prompt', before: 'a', after: 'b' } });
  L.append({ type: 'change', title: 'c2', change: { kind: 'skill', before: '', after: 'x' } });
  L.rollback(c1.hash, { reason: 'bad' });
  const s = L.headState();
  assert.equal(s.activeChanges, 1);
  assert.equal(s.rolledBack, 1);
});

test('recordCycle writes 4 linked entries', () => {
  const L = new Ledger(null);
  const r = L.recordCycle({
    hypothesis: { title: 'shorter prompt', body: 'reduce tokens' },
    change: { kind: 'prompt', path: 'SOUL.md', before: 'long', after: 'short', summary: 'trim' },
    eval: { metric: 'tokens', before: 1200, after: 800, unit: 'tok', passed: true },
    decision: 'keep',
  });
  assert.equal(L.entries.length, 4);
  assert.equal(r.change.prevHash, r.hypothesis.hash);
  assert.equal(L.stats().passRate, 100);
});

test('stats counts eval pass rate', () => {
  const L = new Ledger(null);
  L.append({ type: 'eval', title: 'e1', eval: { metric: 'm', passed: true } });
  L.append({ type: 'eval', title: 'e2', eval: { metric: 'm', passed: false } });
  assert.equal(L.stats().passRate, 50);
});

test('markdown export contains chain status', () => {
  const L = new Ledger(null);
  L.append({ type: 'note', title: 'hello' });
  const md = formatMarkdown(L);
  assert.match(md, /Evolution Ledger/);
  assert.match(md, /intact/);
});

test('invalid type rejected', () => {
  assert.throws(() => createEntry({ type: 'nope' }));
});

test('fromJSONL round trip keeps verification', () => {
  const L = new Ledger(null);
  L.append({ type: 'note', title: 'x' });
  L.append({ type: 'note', title: 'y' });
  const text = L.entries.map(e => JSON.stringify(e)).join('\n');
  const L2 = Ledger.fromJSONL(text);
  assert.equal(L2.verify().ok, true);
  assert.equal(L2.entries.length, 2);
});

test('recordCycle with revert auto-appends rollback', () => {
  const L = new Ledger(null);
  const r = L.recordCycle({
    hypothesis: { title: 'risky', body: 'try' },
    change: { kind: 'config', path: 'x', before: 'safe', after: 'risky' },
    eval: { metric: 'latency', before: 1, after: 90, unit: 's', passed: false },
    decision: 'revert',
    decisionReason: 'too slow',
  });
  assert.ok(r.rollback);
  assert.equal(r.rollback.rollbackOf, r.change.hash);
  assert.equal(L.headState().activeChanges, 0);
  assert.equal(L.headState().rolledBack, 1);
});
