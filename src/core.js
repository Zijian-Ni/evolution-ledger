/**
 * Evolution Ledger — append-only audit log for agent self-evolution
 *
 * Pain points this actually solves:
 * 1. Agents "improve" themselves with no record → can't debug regressions
 * 2. Prompt/skill drift is invisible until production breaks
 * 3. No rollback point when a self-edit makes things worse
 * 4. Hiring managers / you can't SEE how an agent was trained
 *
 * Model: each entry is immutable. "Rollback" creates a NEW compensating entry
 * that points at a prior good hash — never rewrites history.
 */

import { sha256Hex, uuid } from './hash.js';

export const ENTRY_TYPES = [
  'hypothesis',   // what we believe will improve the agent
  'change',       // actual mutation (prompt, skill, tool, config)
  'eval',         // measurement after change
  'decision',     // keep / revert / iterate
  'rollback',     // compensating entry restoring prior state pointer
  'note',         // human annotation
  'checkpoint',   // EL-A1: signed Merkle checkpoint
];

export const CHANGE_KINDS = [
  'prompt',
  'skill',
  'tool',
  'config',
  'memory',
  'model',
  'policy',
  'other',
];

function sha256(s) {
  return sha256Hex(s);
}

export function canonicalize(entry) {
  // stable JSON for hashing (exclude hash field)
  const { hash, ...rest } = entry;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

export function hashEntry(entry) {
  return sha256(canonicalize(entry));
}

export function createEntry(partial, prevHash = null) {
  const now = new Date().toISOString();
  const entry = {
    id: partial.id || uuid(),
    ts: partial.ts || now,
    type: partial.type,
    agent: partial.agent || 'xiaoluo',
    title: partial.title || '',
    body: partial.body || '',
    // structured fields
    hypothesis: partial.hypothesis || null,
    change: partial.change || null, // { kind, path, before, after, diff }
    eval: partial.eval || null,     // { metric, before, after, unit, passed, evidence }
    decision: partial.decision || null, // keep|revert|iterate + reason
    rollbackOf: partial.rollbackOf || null,
    restoresHash: partial.restoresHash || null,
    tags: partial.tags || [],
    meta: partial.meta || {},
    prevHash: prevHash,
  };
  if (!ENTRY_TYPES.includes(entry.type)) {
    throw new Error(`Invalid type: ${entry.type}. Use: ${ENTRY_TYPES.join(', ')}`);
  }
  entry.hash = hashEntry(entry);
  return entry;
}

export class Ledger {
  constructor(filePath) {
    this.filePath = filePath || null;
    this.entries = [];
  }

  toJSONL() {
    return this.entries.map(e => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : '');
  }

  get tip() {
    return this.entries.at(-1) || null;
  }

  get tipHash() {
    return this.tip?.hash || null;
  }

  /** Verify full chain integrity */
  verify() {
    const issues = [];
    let prev = null;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.prevHash !== prev) {
        issues.push({ index: i, id: e.id, error: 'prevHash mismatch', expected: prev, got: e.prevHash });
      }
      const { hash, ...rest } = e;
      const recalced = hashEntry({ ...rest, hash: undefined });
      // hashEntry strips hash via canonicalize
      const expect = hashEntry(e);
      if (e.hash !== expect) {
        issues.push({ index: i, id: e.id, error: 'content hash mismatch' });
      }
      prev = e.hash;
    }
    return { ok: issues.length === 0, count: this.entries.length, issues };
  }

  append(partial) {
    const entry = createEntry(partial, this.tipHash);
    // immutability: never mutate past entries
    this.entries.push(entry);
    return entry;
  }

  /** Record a measured self-evolution cycle in one helper */
  recordCycle({
    agent = 'xiaoluo',
    hypothesis,
    change,
    eval: evaluation,
    decision = 'iterate',
    decisionReason = '',
    tags = [],
  }) {
    const h = this.append({
      type: 'hypothesis',
      agent,
      title: hypothesis?.title || 'Hypothesis',
      body: hypothesis?.body || hypothesis || '',
      hypothesis: typeof hypothesis === 'object' ? hypothesis : { body: hypothesis },
      tags,
    });
    const c = this.append({
      type: 'change',
      agent,
      title: change?.title || `Change · ${change?.kind || 'other'}`,
      body: change?.summary || '',
      change,
      tags,
      meta: { follows: h.hash },
    });
    const ev = this.append({
      type: 'eval',
      agent,
      title: evaluation?.title || `Eval · ${evaluation?.metric || 'metric'}`,
      body: evaluation?.notes || '',
      eval: evaluation,
      tags,
      meta: { follows: c.hash },
    });
    const passed = evaluation?.passed;
    const dec = this.append({
      type: 'decision',
      agent,
      title: `Decision · ${decision}`,
      body: decisionReason,
      decision: { action: decision, reason: decisionReason, passed },
      tags,
      meta: { follows: ev.hash, changeHash: c.hash },
    });
    let rollbackEntry = null;
    if (decision === 'revert') {
      rollbackEntry = this.rollback(c.hash, {
        agent,
        reason: decisionReason || 'decision: revert',
      });
    }

    return { hypothesis: h, change: c, eval: ev, decision: dec, rollback: rollbackEntry };
  }

  /**
   * Rollback: does NOT delete. Appends compensating entry + optional restore snapshot.
   * If change entry has change.before, we surface it as restore payload.
   */
  rollback(targetHash, { agent = 'xiaoluo', reason = '' } = {}) {
    const target = this.entries.find(e => e.hash === targetHash);
    if (!target) throw new Error(`Unknown hash: ${targetHash}`);
    // find last good state before target if target is a change
    const idx = this.entries.findIndex(e => e.hash === targetHash);
    let restores = null;
    if (target.type === 'change' && target.change?.before != null) {
      restores = {
        kind: target.change.kind,
        path: target.change.path,
        content: target.change.before,
      };
    }
    return this.append({
      type: 'rollback',
      agent,
      title: `Rollback → ${target.title || target.id.slice(0, 8)}`,
      body: reason || `Compensating entry for ${targetHash.slice(0, 12)}`,
      rollbackOf: targetHash,
      restoresHash: idx > 0 ? this.entries[idx - 1].hash : null,
      change: restores
        ? { kind: restores.kind, path: restores.path, after: restores.content, before: target.change?.after, summary: 'restore previous content' }
        : null,
      tags: ['rollback'],
      meta: { targetType: target.type },
    });
  }

  /** Current effective pointer: last non-reverted change */
  headState() {
    const rolled = new Set(
      this.entries.filter(e => e.type === 'rollback' && e.rollbackOf).map(e => e.rollbackOf)
    );
    const changes = this.entries.filter(e => e.type === 'change' && !rolled.has(e.hash));
    return {
      tipHash: this.tipHash,
      activeChanges: changes.length,
      lastChange: changes.at(-1) || null,
      rolledBack: rolled.size,
      totalEntries: this.entries.length,
    };
  }

  stats() {
    const byType = Object.fromEntries(ENTRY_TYPES.map(t => [t, 0]));
    for (const e of this.entries) byType[e.type] = (byType[e.type] || 0) + 1;
    const evals = this.entries.filter(e => e.type === 'eval' && e.eval);
    const passed = evals.filter(e => e.eval.passed).length;
    const failed = evals.filter(e => e.eval.passed === false).length;
    return {
      ...this.headState(),
      byType,
      evals: evals.length,
      evalPassed: passed,
      evalFailed: failed,
      passRate: evals.length ? Math.round((passed / evals.length) * 100) : null,
    };
  }

  toJSON() {
    return {
      version: 1,
      file: this.filePath,
      verify: this.verify(),
      stats: this.stats(),
      entries: this.entries,
    };
  }

  static fromJSONL(text) {
    const L = new Ledger(null);
    L.entries = parseJSONL(text);
    return L;
  }

}

/**
 * Fields every entry must carry for the ledger to be renderable and
 * verifiable. `hash` and `prevHash` are what make it a chain; the rest is what
 * the UI unconditionally reads.
 */
const REQUIRED_FIELDS = ['id', 'ts', 'type', 'hash'];

/** Shown when the file is a Traceboard trace, which has its own viewer. */
const FOREIGN_TRACE_MESSAGE =
  'This looks like a Traceboard trace (phase/agent/tool events), not an Evolution Ledger. ' +
  'Traces record what an agent DID; a ledger records what was CHANGED and whether it helped. ' +
  'Open this file at https://zijian-ni.github.io/traceboard/ instead.';

/**
 * Parse JSONL into entries, refusing malformed input with a message that says
 * WHICH line and WHAT is wrong.
 *
 * Why this exists: the UI used to hand raw `JSON.parse` output straight to the
 * renderer, which does `e.hash.slice(0, 12)`. A file that parsed as JSON but
 * wasn't a ledger (an exported array, a pretty-printed object, a log of some
 * other shape) therefore failed with "Cannot read properties of undefined
 * (reading 'slice')" — an error that names no line, no field, and no file, and
 * sends you looking in the renderer instead of at your input.
 *
 * Validation belongs here, at the boundary, where we still know the line
 * number.
 */
export function parseJSONL(text) {
  // An empty ledger is legitimate, not malformed: `init` writes an empty file
  // and then appends the genesis entry into it. The parser's job is to reject
  // data it cannot trust — deciding whether "zero entries" is interesting is
  // the caller's call (the web UI does warn about it).
  if (typeof text !== 'string' || !text.trim()) return [];

  // A common mistake: exporting a JSON array instead of JSONL. That is
  // recoverable and worth accepting rather than lecturing the user about.
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    let arr;
    try {
      arr = JSON.parse(trimmed);
    } catch {
      throw new Error('This looks like a JSON array but it is not valid JSON.');
    }
    if (!Array.isArray(arr)) throw new Error('Expected JSONL (one JSON object per line).');
    if (looksLikeTrace(arr)) throw new Error(FOREIGN_TRACE_MESSAGE);
    return arr.map((entry, i) => validateEntry(entry, i + 1));
  }

  const lines = text.split(/\r?\n/);
  const parsedObjects = [];
  for (const raw of lines.slice(0, 10)) {
    const t = raw.trim();
    if (!t) continue;
    try { parsedObjects.push(JSON.parse(t)); } catch { /* handled below */ }
  }
  if (looksLikeTrace(parsedObjects)) throw new Error(FOREIGN_TRACE_MESSAGE);

  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      // Pretty-printed JSON is the other common mistake — one object spread
      // over many lines. Say so instead of "unexpected token".
      const hint = raw === '{' || raw.endsWith(',')
        ? ' (JSONL needs one complete JSON object per line — this file looks pretty-printed)'
        : '';
      throw new Error(`Line ${i + 1} is not valid JSON${hint}.`);
    }
    entries.push(validateEntry(obj, i + 1));
  }

  return entries;
}

/**
 * Event types emitted by Traceboard / trace-kit. Reported 2026-08-21: a user
 * uploaded a `trace.jsonl` here and was told to add `id` and `hash` to it —
 * technically true, useless advice, because that file was never meant to be a
 * ledger. Recognising a sibling tool's format and pointing at the right tool
 * is far more helpful than listing the fields it "lacks".
 */
const TRACE_EVENT_TYPES = new Set([
  'phase_start', 'phase_end', 'agent_call', 'agent_result',
  'tool_call', 'tool_result', 'llm_call', 'llm_result',
]);

/**
 * Does this look like a Traceboard trace rather than a ledger? Deliberately
 * conservative: only claims a match when entries carry trace event types AND
 * lack the ledger's identity fields, so a real ledger is never misdiagnosed.
 */
function looksLikeTrace(entries) {
  if (!entries.length) return false;
  const sample = entries.slice(0, 10);
  const traceish = sample.filter(
    e => e && typeof e === 'object' && TRACE_EVENT_TYPES.has(e.type)
  ).length;
  const hasLedgerIdentity = sample.some(e => e && (e.id !== undefined || e.hash !== undefined));
  return traceish >= Math.ceil(sample.length / 2) && !hasLedgerIdentity;
}

/** Check one entry, naming the line and the exact missing/!wrong field. */
function validateEntry(entry, line) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Line ${line}: expected a JSON object.`);
  }
  const missing = REQUIRED_FIELDS.filter(f => entry[f] === undefined || entry[f] === null);
  if (missing.length) {
    throw new Error(
      `Line ${line} is missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
      `Every entry needs ${REQUIRED_FIELDS.join(', ')}.`
    );
  }
  for (const f of REQUIRED_FIELDS) {
    if (typeof entry[f] !== 'string') {
      throw new Error(`Line ${line}: "${f}" must be a string, got ${typeof entry[f]}.`);
    }
  }
  if (!ENTRY_TYPES.includes(entry.type)) {
    throw new Error(
      `Line ${line}: unknown type "${entry.type}". Expected one of: ${ENTRY_TYPES.join(', ')}.`
    );
  }
  return entry;
}

export function formatMarkdown(ledger) {
  const s = ledger.stats();
  const v = ledger.verify();
  let md = `# Evolution Ledger\n\n`;
  md += `**Entries:** ${s.totalEntries} · **Active changes:** ${s.activeChanges} · **Rollbacks:** ${s.rolledBack}\n`;
  md += `**Chain:** ${v.ok ? '✅ intact' : '❌ BROKEN'} · **Eval pass rate:** ${s.passRate ?? 'n/a'}%\n\n`;
  for (const e of ledger.entries) {
    const icon = {
      hypothesis: '💡', change: '🔧', eval: '📊', decision: '⚖️', rollback: '↩️', note: '📝',
    }[e.type] || '•';
    md += `## ${icon} ${e.type} · ${e.title}\n`;
    md += `- **id:** \`${e.id}\`\n`;
    md += `- **hash:** \`${String(e.hash ?? '').slice(0, 16)}…\`\n`;
    md += `- **time:** ${e.ts} · **agent:** ${e.agent}\n`;
    if (e.body) md += `\n${e.body}\n`;
    if (e.change) md += `\n\`\`\`\nkind: ${e.change.kind}\npath: ${e.change.path || ''}\n${e.change.summary || ''}\n\`\`\`\n`;
    if (e.eval) md += `\n> metric \`${e.eval.metric}\`: ${e.eval.before} → ${e.eval.after} ${e.eval.unit || ''} · ${e.eval.passed ? 'PASS' : 'FAIL'}\n`;
    if (e.decision) md += `\n**Decision:** ${e.decision.action} — ${e.decision.reason || ''}\n`;
    if (e.rollbackOf) md += `\n**Rolls back:** \`${e.rollbackOf.slice(0, 16)}…\`\n`;
    md += `\n---\n\n`;
  }
  return md;
}
