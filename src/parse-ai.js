/**
 * Parse free-form AI / agent text into Evolution Ledger structured drafts.
 *
 * Problem this fixes:
 * - People paste a whole AI monologue into a note, which is not auditable.
 * - We want hypothesis → change → eval → decision, not a wall of prose.
 *
 * Heuristic only (offline). User always reviews before append.
 */

const TYPE_HINTS = [
  { type: 'hypothesis', re: /\b(hypothesis|we believe|i believe|假设|我们认为|如果\s*.+?\s*那么|if we|proposal|propose)\b/i },
  { type: 'change', re: /\b(change|changed|modified|edit|patch|update|改动|修改|更新|before\s*→\s*after|diff)\b/i },
  { type: 'eval', re: /\b(eval|evaluation|metric|benchmark|measure|result|latency|pass rate|评测|指标|测量|通过率|结果)\b/i },
  { type: 'decision', re: /\b(decision|decide|keep|revert|rollback|iterate|ship|决定|保留|回滚|迭代)\b/i },
  { type: 'rollback', re: /\b(rollback|revert|undo|回滚|撤销)\b/i },
  { type: 'note', re: /\b(note|观察|备注|context)\b/i },
];

const DECISION_RE = /\b(keep|revert|iterate|ship|reject|保留|回滚|迭代|上线|拒绝)\b/i;
const KIND_RE = /\b(prompt|skill|tool|config|memory|model|policy|other)\b/i;
const PATH_RE = /(?:path|file|文件|路径)\s*[:=]\s*([^\s,;]+)|`([^`]+\.[a-zA-Z0-9]+)`|((?:[\w.-]+\/)+[\w.-]+(?:\.[a-zA-Z0-9]+)?(?:#[\w.-]+)?)/;
const METRIC_RE = /(?:metric|指标)\s*[:=]\s*([a-zA-Z0-9_./%-]+)|([a-zA-Z_][\w./%-]{2,})\s*[:=]\s*([-+]?\d+(?:\.\d+)?)\s*(%|ms|s|tok|tokens|days?)?/i;
const ARROW_RE = /([^\n→\-]{1,120}?)\s*(?:→|->|=>|➡|—>)\s*([^\n]{1,120})/;
const NUM_PAIR_RE = /([-+]?\d+(?:\.\d+)?)\s*(%|ms|s|tok|days?)?\s*(?:→|->|=>)\s*([-+]?\d+(?:\.\d+)?)\s*(%|ms|s|tok|days?)?/i;

function splitBlocks(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];

  // Prefer markdown headings / numbered / bullets as block starts
  const lines = raw.split('\n');
  const blocks = [];
  let buf = [];

  const flush = () => {
    const t = buf.join('\n').trim();
    if (t) blocks.push(t);
    buf = [];
  };

  for (const line of lines) {
    if (/^\s*$/.test(line) && buf.length) {
      flush();
      continue;
    }
    if (/^(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|#{1,6}.+(假设|改动|评测|决策|Hypothesis|Change|Eval|Decision))/i.test(line) && buf.length) {
      flush();
    }
    buf.push(line);
  }
  flush();

  // fallback: sentence groups if still one giant block
  if (blocks.length === 1 && blocks[0].length > 400) {
    return blocks[0]
      .split(/(?<=[。！？.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 12);
  }
  return blocks;
}

function guessType(block) {
  for (const h of TYPE_HINTS) {
    if (h.re.test(block)) return h.type;
  }
  if (NUM_PAIR_RE.test(block) || /pass(?:ed)?|fail(?:ed)?|通过|失败/i.test(block)) return 'eval';
  if (ARROW_RE.test(block) && /prompt|skill|config|policy|path|文件/i.test(block)) return 'change';
  if (DECISION_RE.test(block)) return 'decision';
  return 'note';
}

function firstLine(block) {
  return block.split('\n').map(l => l.replace(/^[#>*\-\d.)\s]+/, '').trim()).find(Boolean) || 'Untitled';
}

function parseChange(block) {
  const kind = (block.match(KIND_RE)?.[1] || 'other').toLowerCase();
  const pathMatch = block.match(PATH_RE);
  const path = pathMatch?.[1] || pathMatch?.[2] || pathMatch?.[3] || '';
  const arrow = block.match(ARROW_RE);
  let before = arrow?.[1]?.trim() || '';
  let after = arrow?.[2]?.trim() || '';
  // strip labels
  before = before.replace(/^(before|改前)\s*[:=]\s*/i, '').slice(0, 500);
  after = after.replace(/^(after|改后)\s*[:=]\s*/i, '').slice(0, 500);
  return {
    kind,
    path,
    before: before || null,
    after: after || null,
    summary: firstLine(block).slice(0, 160),
  };
}

function parseEval(block) {
  const pair = block.match(NUM_PAIR_RE);
  const metricMatch = block.match(METRIC_RE);
  let metric = 'metric';
  let before = null;
  let after = null;
  let unit = '';

  if (pair) {
    before = Number(pair[1]);
    after = Number(pair[3]);
    unit = pair[4] || pair[2] || '';
  }
  if (metricMatch) {
    if (metricMatch[1]) metric = metricMatch[1];
    else if (metricMatch[2]) {
      metric = metricMatch[2];
      if (before == null && metricMatch[3] != null) after = Number(metricMatch[3]);
      unit = metricMatch[4] || unit;
    }
  }

  const passed = /\bpass(?:ed)?\b|通过|✅/i.test(block)
    ? true
    : (/\bfail(?:ed)?\b|失败|❌/i.test(block) ? false : null);

  return {
    metric,
    before,
    after,
    unit,
    passed,
    notes: firstLine(block).slice(0, 240),
    title: `Eval · ${metric}`,
  };
}

function parseDecision(block) {
  const m = block.match(DECISION_RE);
  let action = (m?.[1] || 'iterate').toLowerCase();
  const map = {
    保留: 'keep', 回滚: 'revert', 迭代: 'iterate', 上线: 'keep', 拒绝: 'revert', ship: 'keep', reject: 'revert',
  };
  action = map[action] || action;
  if (!['keep', 'revert', 'iterate'].includes(action)) action = 'iterate';
  return { action, reason: block.slice(0, 400) };
}

/**
 * @returns {{ cycles: Array, orphans: Array, warnings: string[] }}
 */
export function parseAITextToDrafts(text, { agent = 'xiaoluo' } = {}) {
  const blocks = splitBlocks(text);
  const warnings = [];
  if (!blocks.length) {
    return { cycles: [], orphans: [], warnings: ['Empty input'] };
  }

  const items = blocks.map((body, i) => {
    const type = guessType(body);
    const title = firstLine(body).slice(0, 120);
    const base = { type, agent, title, body, tags: ['from-ai-paste'] };
    if (type === 'change') base.change = parseChange(body);
    if (type === 'eval') base.eval = parseEval(body);
    if (type === 'decision') base.decision = parseDecision(body);
    if (type === 'hypothesis') base.hypothesis = { title, body };
    return { ...base, _i: i };
  });

  // Group into cycles: hypothesis + following change/eval/decision until next hypothesis/note-break
  const cycles = [];
  const orphans = [];
  let cur = null;

  const pushCur = () => {
    if (!cur) return;
    // fill missing pieces with placeholders so user sees the gap
    if (!cur.hypothesis) {
      warnings.push(`Cycle ${cycles.length + 1}: missing hypothesis — using first text as hypothesis`);
      cur.hypothesis = {
        title: cur.change?.title || cur.eval?.title || 'Hypothesis (inferred)',
        body: cur.change?.body || cur.eval?.body || cur.decision?.reason || 'Inferred from pasted AI text',
      };
    }
    if (!cur.change) {
      warnings.push(`Cycle ${cycles.length + 1}: missing change — placeholder added`);
      cur.change = {
        kind: 'other',
        path: '',
        before: null,
        after: null,
        summary: 'TODO: fill actual change',
        title: 'Change · TODO',
      };
    }
    if (!cur.eval) {
      warnings.push(`Cycle ${cycles.length + 1}: missing eval — placeholder added`);
      cur.eval = {
        metric: 'unmeasured',
        before: null,
        after: null,
        unit: '',
        passed: null,
        notes: 'TODO: add metric before/after',
        title: 'Eval · unmeasured',
      };
    }
    if (!cur.decision) {
      cur.decision = { action: 'iterate', reason: 'No explicit decision in paste — default iterate' };
    }
    cycles.push(cur);
    cur = null;
  };

  for (const item of items) {
    if (item.type === 'note' && !cur) {
      orphans.push(item);
      continue;
    }
    if (item.type === 'hypothesis' || (item.type === 'note' && cur)) {
      if (item.type === 'hypothesis') {
        pushCur();
        cur = {
          agent,
          hypothesis: { title: item.title, body: item.body },
          change: null,
          eval: null,
          decision: null,
          tags: ['from-ai-paste'],
        };
        continue;
      }
    }
    if (!cur) {
      // start cycle from non-hypothesis
      cur = { agent, hypothesis: null, change: null, eval: null, decision: null, tags: ['from-ai-paste'] };
    }
    if (item.type === 'change') {
      cur.change = { ...item.change, title: item.title, body: item.body };
    } else if (item.type === 'eval') {
      cur.eval = { ...item.eval, title: item.title };
    } else if (item.type === 'decision' || item.type === 'rollback') {
      const d = item.decision || { action: 'revert', reason: item.body };
      cur.decision = d;
      cur.decisionReason = d.reason;
    } else if (item.type === 'hypothesis') {
      pushCur();
      cur = {
        agent,
        hypothesis: { title: item.title, body: item.body },
        change: null,
        eval: null,
        decision: null,
        tags: ['from-ai-paste'],
      };
    } else {
      // attach leftover text to hypothesis body
      if (cur.hypothesis) cur.hypothesis.body += `\n\n${item.body}`;
      else cur.hypothesis = { title: item.title, body: item.body };
    }
  }
  pushCur();

  if (!cycles.length && orphans.length) {
    // Free-form monologue → one draft cycle so paste is never a dead-end note dump
    warnings.push('Free-form text detected — converted into a draft cycle. Fill change/eval before trusting it.');
    const body = orphans.map(o => o.body).join('\n\n');
    const title = orphans[0].title || 'Pasted AI answer';
    cycles.push({
      agent,
      hypothesis: { title, body },
      change: {
        kind: 'other', path: '', before: null, after: null,
        summary: 'TODO: extract actual change from paste', title: 'Change · TODO',
      },
      eval: {
        metric: 'unmeasured', before: null, after: null, unit: '', passed: null,
        notes: 'TODO: add metric before/after', title: 'Eval · unmeasured',
      },
      decision: { action: 'iterate', reason: 'No explicit decision in paste — default iterate' },
      decisionReason: 'No explicit decision in paste — default iterate',
      tags: ['from-ai-paste', 'needs-review'],
    });
    orphans.length = 0;
  }

  return { cycles, orphans, warnings };
}

/** Apply drafts onto a Ledger instance (mutates). */
export function applyDraftsToLedger(ledger, drafts, { agent = 'xiaoluo' } = {}) {
  const created = [];
  for (const note of drafts.orphans || []) {
    created.push(ledger.append({
      type: 'note',
      agent: note.agent || agent,
      title: note.title,
      body: note.body,
      tags: note.tags || ['from-ai-paste'],
    }));
  }
  for (const c of drafts.cycles || []) {
    const decision = c.decision?.action || c.decision || 'iterate';
    const decisionReason = c.decisionReason || c.decision?.reason || '';
    const r = ledger.recordCycle({
      agent: c.agent || agent,
      hypothesis: c.hypothesis,
      change: {
        kind: c.change?.kind || 'other',
        path: c.change?.path || '',
        before: c.change?.before,
        after: c.change?.after,
        summary: c.change?.summary || c.change?.title || '',
        title: c.change?.title,
      },
      eval: {
        metric: c.eval?.metric || 'unmeasured',
        before: c.eval?.before,
        after: c.eval?.after,
        unit: c.eval?.unit || '',
        passed: c.eval?.passed,
        notes: c.eval?.notes || '',
        title: c.eval?.title,
      },
      decision,
      decisionReason,
      tags: c.tags || ['from-ai-paste'],
    });
    created.push(r);
  }
  return created;
}
