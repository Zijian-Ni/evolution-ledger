/**
 * EL-2: Zero-dependency JSON record validator.
 * Validates JSON piped via stdin for `eledger record --json`.
 *
 * Required fields: type, title
 * Optional: body, agent, hypothesis, change, eval, decision,
 *           rollbackOf, restoresHash, tags, meta
 *
 * id, ts, prevHash, hash are filled by the Ledger.append() call.
 *
 * Returns { ok: true, data } or { ok: false, error: string }
 */

const VALID_TYPES = [
  'hypothesis', 'change', 'eval', 'decision', 'rollback', 'note', 'checkpoint',
];

/**
 * Parse and validate raw JSON string.
 * @param {string} raw
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
export function validateJsonRecord(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Empty input — expected JSON on stdin' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err.message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'JSON must be a single object (not array or primitive)' };
  }

  // Required fields
  const { type, title } = parsed;

  if (!type) {
    return { ok: false, error: `Missing required field: type. Valid types: ${VALID_TYPES.join(', ')}` };
  }
  if (!VALID_TYPES.includes(type)) {
    return { ok: false, error: `Invalid type "${type}". Valid types: ${VALID_TYPES.join(', ')}` };
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return { ok: false, error: 'Missing required field: title (non-empty string)' };
  }

  // Optional field type validation (shallow)
  if (parsed.tags !== undefined && !Array.isArray(parsed.tags)) {
    return { ok: false, error: 'Field "tags" must be an array of strings' };
  }
  if (parsed.eval !== undefined && typeof parsed.eval !== 'object') {
    return { ok: false, error: 'Field "eval" must be an object' };
  }
  if (parsed.change !== undefined && typeof parsed.change !== 'object') {
    return { ok: false, error: 'Field "change" must be an object' };
  }
  if (parsed.hypothesis !== undefined &&
      typeof parsed.hypothesis !== 'object' &&
      typeof parsed.hypothesis !== 'string') {
    return { ok: false, error: 'Field "hypothesis" must be an object or string' };
  }

  // Strip any client-supplied id/ts/prevHash/hash (we fill these)
  const { id: _id, ts: _ts, prevHash: _prev, hash: _hash, ...data } = parsed;

  return { ok: true, data };
}
