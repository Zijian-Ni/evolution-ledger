#!/usr/bin/env node
/** Seed a realistic Xiaoluo self-evolution ledger for the demo UI */
import fs from 'node:fs';
import path from 'node:path';
import { Ledger } from '../src/ledger.js';

const out = path.resolve('public/demo/ledger.jsonl');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '');
const L = new Ledger(out);

L.append({
  type: 'note', agent: 'xiaoluo', title: 'Ledger opened',
  body: 'Aurora Xiaoluo begins recording every self-modification. History is append-only.',
  tags: ['genesis'],
});

L.recordCycle({
  agent: 'xiaoluo',
  hypothesis: { title: 'Tool-liveness reflex', body: 'memory_search silently failed for 8 days. If we add a health probe reflex, silent degradation becomes visible within one heartbeat.' },
  change: { kind: 'policy', path: 'AGENTS.md#Reflex-7', before: 'no tool liveness check', after: 'Reflex 7: 2 consecutive provider errors → run healthcheck → report to owner', summary: 'Add tool-liveness reflex' },
  eval: { metric: 'silent_failure_days', before: 8, after: 0, unit: 'days', passed: true, evidence: 'tools/memory-healthcheck.sh returns MEMORY_OK' },
  decision: 'keep',
  decisionReason: 'Detected ollama not enabled at boot within first heartbeat',
  tags: ['reliability'],
});

L.recordCycle({
  agent: 'xiaoluo',
  hypothesis: { title: 'Index everything = better recall', body: 'Adding 72k crawled articles to memory index should improve answers.' },
  change: { kind: 'memory', path: 'memorySearch.extraPaths', before: '19 personal paths', after: '59 paths incl. 72,931 crawled docs', summary: 'Index the entire knowledge base' },
  eval: { metric: 'query_latency', before: 0.3, after: 180, unit: 's', passed: false, evidence: 'cold KNN 11.2s; CLI query 3 min; recall diluted by noise' },
  decision: 'revert',
  decisionReason: 'Signal drowned by external corpus; personal recall degraded',
  tags: ['memory', 'regression'],
});

L.recordCycle({
  agent: 'xiaoluo',
  hypothesis: { title: 'Delegate exploratory work to subagents', body: 'Long tool-call chains poison the main context for every later turn.' },
  change: { kind: 'policy', path: 'AGENTS.md#delegation', before: 'run everything in main session', after: '≥5 exploratory calls → sessions_spawn isolated child', summary: 'Subagent delegation rule' },
  eval: { metric: 'main_context_carry', before: 33, after: 4, unit: 'M tokens', passed: true, evidence: 'cache-read growth flattened after rule' },
  decision: 'keep',
  decisionReason: 'Same single-task cost, far cheaper subsequent turns',
  tags: ['cost'],
});

L.recordCycle({
  agent: 'hermes',
  hypothesis: { title: 'Auto-migrate OpenClaw identity', body: 'Importing SOUL/memory/keys would make Hermes instantly useful.' },
  change: { kind: 'config', path: 'hermes claw migrate', before: 'isolated setup', after: 'full identity import', summary: 'Cross-harness identity migration' },
  eval: { metric: 'secret_blast_radius', before: 1, after: 2, unit: 'runtimes', passed: false, evidence: 'both runtimes would hold all keys' },
  decision: 'revert',
  decisionReason: 'Owner policy: no default two-way full trust between harnesses',
  tags: ['security'],
});

L.append({
  type: 'note', agent: 'xiaoluo', title: 'Why this ledger exists',
  body: 'Self-evolving agents usually mutate prompts and skills with zero audit trail. When quality regresses weeks later, nobody can answer: what changed, what did we measure, and where is the rollback point?',
  tags: ['manifesto'],
});

L.save();
const v = L.verify();
console.log('seeded', out, 'entries', L.entries.length, 'chain ok', v.ok);
console.log(JSON.stringify(L.stats(), null, 2));
