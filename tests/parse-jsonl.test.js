/**
 * Regression tests for uploading a JSONL file in the web UI.
 *
 * Reported 2026-08-21: uploading a file produced
 *   "Invalid ledger: Cannot read properties of undefined (reading 'slice')"
 *
 * That message came from the RENDERER — `e.hash.slice(0, 12)` — not from the
 * parser, because `fromJSONL` was a bare `JSON.parse` per line with no
 * validation. So any file that was valid JSON but not a valid ledger sailed
 * through parsing and then exploded during render, naming neither the line,
 * the field, nor the file.
 *
 * These tests pin two things:
 *   1. bad input is rejected AT THE PARSER, with a message that says where
 *   2. the specific "undefined.slice" crash can never come back
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, parseJSONL, createEntry } from '../src/core.js';

const good = {
  id: 'a1',
  ts: '2026-08-21T00:00:00.000Z',
  type: 'note',
  agent: 'me',
  title: 'hello',
  hash: 'abcdef0123456789',
};
const line = (o) => JSON.stringify(o);

test('THE REPORTED BUG: an entry with no hash is refused, not rendered', () => {
  const { hash, ...noHash } = good;
  assert.throws(
    () => parseJSONL(line(noHash)),
    (err) => {
      // must not be the old cryptic renderer crash
      assert.doesNotMatch(err.message, /reading 'slice'/);
      // must name the line and the field
      assert.match(err.message, /Line 1/);
      assert.match(err.message, /hash/);
      return true;
    }
  );
});

test('every required field is checked, and named when missing', () => {
  for (const field of ['id', 'ts', 'type', 'hash']) {
    const entry = { ...good };
    delete entry[field];
    assert.throws(() => parseJSONL(line(entry)), new RegExp(field),
      `missing "${field}" should be reported by name`);
  }
});

test('the offending LINE NUMBER is reported, not just "invalid"', () => {
  const { hash, ...noHash } = good;
  const text = [line(good), line(good), line(noHash)].join('\n');
  assert.throws(() => parseJSONL(text), /Line 3/);
});

test('a wrong-typed required field is rejected with its type', () => {
  assert.throws(() => parseJSONL(line({ ...good, hash: 12345 })), /hash.*string.*number/s);
});

test('an unknown entry type is rejected and the valid ones are listed', () => {
  assert.throws(
    () => parseJSONL(line({ ...good, type: 'banana' })),
    (err) => {
      assert.match(err.message, /banana/);
      assert.match(err.message, /note/); // lists the accepted types
      return true;
    }
  );
});

test('a valid ledger still parses', () => {
  const entries = parseJSONL([line(good), line({ ...good, id: 'a2' })].join('\n'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].hash, good.hash);
});

test('blank lines, trailing newline and CRLF are tolerated', () => {
  const entries = parseJSONL(`${line(good)}\r\n\r\n${line({ ...good, id: 'a2' })}\r\n`);
  assert.equal(entries.length, 2);
});

test('an exported JSON array is accepted rather than rejected on a technicality', () => {
  // Users export arrays by mistake constantly; it is unambiguous, so take it.
  const entries = parseJSONL(JSON.stringify([good, { ...good, id: 'a2' }]));
  assert.equal(entries.length, 2);
});

test('an array of INVALID entries is still rejected', () => {
  const { hash, ...noHash } = good;
  assert.throws(() => parseJSONL(JSON.stringify([noHash])), /hash/);
});

test('pretty-printed JSON gets an explanation, not "unexpected token"', () => {
  assert.throws(
    () => parseJSONL(JSON.stringify(good, null, 2)),
    (err) => {
      assert.match(err.message, /pretty-printed|one complete JSON object per line/i);
      return true;
    }
  );
});

test('an empty file is VALID (init writes one before the genesis entry)', () => {
  // Regression: an earlier version of this fix threw here, which broke
  // `ledger init` — it creates an empty file and then appends into it.
  assert.deepEqual(parseJSONL(''), []);
  assert.deepEqual(parseJSONL('   \n  \n'), []);
  assert.equal(Ledger.fromJSONL('').entries.length, 0);
});

test('non-JSON text names the line', () => {
  assert.throws(() => parseJSONL('hello world'), /Line 1/);
});

test('a JSON scalar per line is rejected (not an object)', () => {
  assert.throws(() => parseJSONL('42'), /expected a JSON object/i);
  assert.throws(() => parseJSONL('"a string"'), /expected a JSON object/i);
});

test('Ledger.fromJSONL surfaces the same validation', () => {
  const { hash, ...noHash } = good;
  assert.throws(() => Ledger.fromJSONL(line(noHash)), /hash/);
});

test('round trip: a real appended ledger reloads cleanly', () => {
  const L = new Ledger(null);
  L.append({ type: 'note', agent: 'me', title: 'one' });
  L.append({ type: 'note', agent: 'me', title: 'two' });
  const reloaded = Ledger.fromJSONL(L.toJSONL());
  assert.equal(reloaded.entries.length, 2);
  assert.equal(reloaded.verify().ok, true, 'chain must still verify after a round trip');
});

test('entries created by the library always satisfy the validator', () => {
  // Guards against the validator drifting stricter than the writer.
  const e = createEntry({ type: 'note', agent: 'me', title: 't' }, null);
  assert.doesNotThrow(() => parseJSONL(JSON.stringify(e)));
});
