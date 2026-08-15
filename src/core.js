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
    L.entries = text.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
    return L;
  }

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
    md += `- **hash:** \`${e.hash.slice(0, 16)}…\`\n`;
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
