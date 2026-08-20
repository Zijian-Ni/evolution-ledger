/**
 * Reported 2026-08-21 (follow-up): a user uploaded `trace.jsonl` and got
 *
 *   "Line 1 is missing required fields: id, hash.
 *    Every entry needs id, ts, type, hash."
 *
 * That message was accurate and useless. The file was a Traceboard trace —
 * it was never meant to be a ledger — so telling the user to bolt `id` and
 * `hash` onto every line points them at a fix that makes no sense.
 *
 * A validator that recognises a sibling format and names the right tool is
 * worth far more than one that lists the fields the file "lacks".
 *
 * The risk of that heuristic is misdiagnosing a REAL ledger, which would be a
 * worse bug than the one being fixed. Most of these tests exist to pin that
 * down.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, parseJSONL, createEntry } from '../src/core.js';

/** The exact shape the user uploaded (Traceboard / trace-kit events). */
const TRACE_LINES = [
  { ts: '2026-08-15T18:35:00Z', type: 'phase_start',  phase: 'plan', agent: 'xiaoluo', message: 'Plan demo' },
  { ts: '2026-08-15T18:35:05Z', type: 'agent_result', phase: 'plan', agent: 'xiaoluo', message: 'Route decided' },
  { ts: '2026-08-15T18:35:10Z', type: 'phase_end',    phase: 'plan', agent: 'xiaoluo', message: 'Plan complete' },
  { ts: '2026-08-15T18:36:00Z', type: 'agent_call',   phase: 'explore', agent: 'hermes', message: 'Explore' },
];
const jsonl = (objs) => objs.map((o) => JSON.stringify(o)).join('\n');

test('THE REPORTED FILE: a Traceboard trace is identified, not nagged about fields', () => {
  assert.throws(
    () => parseJSONL(jsonl(TRACE_LINES)),
    (err) => {
      assert.match(err.message, /Traceboard/i, 'must name the tool that DOES read this');
      assert.match(err.message, /traceboard/i, 'must link somewhere useful');
      // the old unhelpful advice must be gone
      assert.doesNotMatch(err.message, /missing required field/i);
      assert.doesNotMatch(err.message, /Every entry needs/i);
      return true;
    }
  );
});

test('the same detection works when the trace was exported as a JSON array', () => {
  assert.throws(() => parseJSONL(JSON.stringify(TRACE_LINES)), /Traceboard/i);
});

test('the message explains the DIFFERENCE, so the user learns which tool to use', () => {
  try {
    parseJSONL(jsonl(TRACE_LINES));
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /did/i);      // traces record what happened
    assert.match(err.message, /changed/i);  // ledgers record what changed
  }
});

// ─── the important half: never misdiagnose a real ledger ───────────────────

test('a REAL ledger is never mistaken for a trace', () => {
  const L = new Ledger(null);
  L.append({ type: 'note',   agent: 'me', title: 'opened' });
  L.append({ type: 'change', agent: 'me', title: 'tweak prompt', change: { kind: 'prompt' } });
  L.append({ type: 'eval',   agent: 'me', title: 'measured', eval: { metric: 'pass', passed: true } });
  const reloaded = Ledger.fromJSONL(L.toJSONL());
  assert.equal(reloaded.entries.length, 3);
  assert.equal(reloaded.verify().ok, true);
});

test('a ledger entry that merely LOOKS trace-ish still parses, because it has identity', () => {
  // Defensive: if a ledger ever gained a type resembling a trace event, the
  // presence of id/hash must win. Identity is the real discriminator.
  const entry = {
    id: 'x1', ts: '2026-08-21T00:00:00Z', type: 'note',
    agent: 'me', title: 'phase_start mentioned in a title', hash: 'abc123def456',
  };
  assert.doesNotThrow(() => parseJSONL(JSON.stringify(entry)));
});

test('a genuinely broken LEDGER still gets the field-level message, not the trace one', () => {
  // Missing hash, but clearly a ledger entry (has id + ledger type).
  const almost = { id: 'x1', ts: '2026-08-21T00:00:00Z', type: 'note', agent: 'me', title: 't' };
  assert.throws(
    () => parseJSONL(JSON.stringify(almost)),
    (err) => {
      assert.match(err.message, /hash/);
      assert.doesNotMatch(err.message, /Traceboard/i, 'must not blame the wrong tool');
      return true;
    }
  );
});

test('a single stray trace-typed line does not hijack a valid ledger', () => {
  const L = new Ledger(null);
  L.append({ type: 'note', agent: 'me', title: 'a' });
  L.append({ type: 'note', agent: 'me', title: 'b' });
  const good = L.toJSONL().trim().split('\n');
  // majority is a real ledger; detection must not fire
  const mixed = [...good, JSON.stringify(TRACE_LINES[0])].join('\n');
  assert.throws(() => parseJSONL(mixed), (err) => {
    assert.doesNotMatch(err.message, /Traceboard/i);
    return true;
  });
});

test('entries produced by the library never trip the trace heuristic', () => {
  for (const type of ['hypothesis', 'change', 'eval', 'decision', 'note']) {
    const e = createEntry({ type, agent: 'me', title: type }, null);
    assert.doesNotThrow(() => parseJSONL(JSON.stringify(e)), `${type} must parse`);
  }
});

test('an empty file is still valid and never reported as a trace', () => {
  assert.deepEqual(parseJSONL(''), []);
});
