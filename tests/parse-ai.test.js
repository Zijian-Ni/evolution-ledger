import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAITextToDrafts, applyDraftsToLedger } from '../src/parse-ai.js';
import { Ledger } from '../src/core.js';

test('parse structured AI paste into one cycle', () => {
  const text = `## Hypothesis
If we add a health probe, silent failures become visible.

## Change
policy path: AGENTS.md#Reflex-7
before → after: no check → Reflex 7 health probe

## Eval
metric silent_failure_days: 8 → 0 days PASS

## Decision
keep — detected within one heartbeat`;

  const d = parseAITextToDrafts(text);
  assert.equal(d.cycles.length, 1);
  assert.match(d.cycles[0].hypothesis.body, /health probe/i);
  assert.equal(d.cycles[0].change.kind, 'policy');
  assert.equal(d.cycles[0].eval.passed, true);
  assert.equal(d.cycles[0].decision.action, 'keep');
});

test('missing pieces produce warnings and placeholders', () => {
  const d = parseAITextToDrafts('We should shorten the system prompt to cut tokens.');
  assert.ok(d.cycles.length >= 1);
  assert.ok(d.warnings.length >= 1);
  assert.ok(d.cycles[0].change);
  assert.ok(d.cycles[0].eval);
});

test('applyDraftsToLedger writes hash-chained entries', () => {
  const L = new Ledger(null);
  const d = parseAITextToDrafts(`## Hypothesis
H
## Change
prompt SOUL.md: long → short
## Eval
tokens: 1200 → 800 tok PASS
## Decision
keep`);
  applyDraftsToLedger(L, d);
  assert.ok(L.entries.length >= 4);
  assert.equal(L.verify().ok, true);
  assert.equal(L.stats().byType.hypothesis >= 1, true);
});
