#!/usr/bin/env node
/**
 * evolution-ledger CLI
 * eledger init | append | cycle | rollback | verify | stat | export | ui-data
 */
import fs from 'node:fs';
import path from 'node:path';
import { Ledger, formatMarkdown, ENTRY_TYPES } from './ledger.js';

const DEFAULT = process.env.ELEDGER_PATH || path.resolve('ledger.jsonl');

function usage() {
  console.log(`evolution-ledger — append-only audit log for agent self-evolution

Commands:
  init [file]                         Create empty ledger
  append --type T --title S [--body B] [--agent xiaoluo]
  cycle --hypothesis H --kind prompt --path P --before A --after B \\
        --metric M --m-before X --m-after Y [--pass|--fail] --decision keep|revert|iterate
  rollback <hash> [--reason R]
  verify [file]
  stat [file]
  export md|json [file]
  list [file]

Env: ELEDGER_PATH=./ledger.jsonl

Pain fixed: silent self-edits, untraceable regressions, no rollback story.
`);
}

function load(fp = DEFAULT) {
  if (!fs.existsSync(fp)) {
    console.error(`No ledger at ${fp}. Run: eledger init`);
    process.exit(1);
  }
  return Ledger.fromFile(fp);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (!cmd || cmd === '-h' || cmd === '--help') {
  usage();
  process.exit(0);
}

if (cmd === 'init') {
  const fp = args._[1] || DEFAULT;
  if (fs.existsSync(fp) && !args.force) {
    console.error('Exists:', fp, '(use --force)');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(path.resolve(fp)), { recursive: true });
  fs.writeFileSync(fp, '');
  const L = new Ledger(fp);
  L.append({
    type: 'note',
    agent: args.agent || 'xiaoluo',
    title: 'Ledger opened',
    body: 'Append-only evolution audit trail. History is never rewritten.',
    tags: ['genesis'],
  });
  L.save();
  console.log('Initialized', fp, 'tip', L.tipHash.slice(0, 12));
  process.exit(0);
}

if (cmd === 'append') {
  const fp = args.file || DEFAULT;
  const L = load(fp);
  const type = args.type;
  if (!ENTRY_TYPES.includes(type)) {
    console.error('Need --type', ENTRY_TYPES.join('|'));
    process.exit(2);
  }
  const e = L.append({
    type,
    agent: args.agent || 'xiaoluo',
    title: args.title || type,
    body: args.body || '',
    tags: args.tags ? String(args.tags).split(',') : [],
  });
  L.save();
  console.log(JSON.stringify({ id: e.id, hash: e.hash, type: e.type }, null, 2));
  process.exit(0);
}

if (cmd === 'cycle') {
  const fp = args.file || DEFAULT;
  const L = load(fp);
  const passed = args.pass ? true : args.fail ? false : args.passed === 'true';
  const result = L.recordCycle({
    agent: args.agent || 'xiaoluo',
    hypothesis: { title: args['h-title'] || 'Hypothesis', body: args.hypothesis || args.H || '' },
    change: {
      kind: args.kind || 'prompt',
      path: args.path || args.p || '',
      before: args.before ?? '',
      after: args.after ?? '',
      summary: args.summary || '',
      title: args['c-title'],
    },
    eval: {
      metric: args.metric || 'score',
      before: args['m-before'] ?? args.mbefore,
      after: args['m-after'] ?? args.mafter,
      unit: args.unit || '',
      passed,
      evidence: args.evidence || '',
      notes: args.notes || '',
    },
    decision: args.decision || (passed ? 'keep' : 'revert'),
    decisionReason: args.reason || '',
    tags: args.tags ? String(args.tags).split(',') : ['cycle'],
  });
  L.save();
  console.log(JSON.stringify({
    hypothesis: result.hypothesis.hash,
    change: result.change.hash,
    eval: result.eval.hash,
    decision: result.decision.hash,
    tip: L.tipHash,
    stats: L.stats(),
  }, null, 2));
  process.exit(0);
}

if (cmd === 'rollback') {
  const fp = args.file || DEFAULT;
  const hash = args._[1] || args.hash;
  if (!hash) {
    console.error('rollback <hash>');
    process.exit(2);
  }
  const L = load(fp);
  // allow prefix match
  const full = L.entries.find(e => e.hash === hash || e.hash.startsWith(hash));
  if (!full) {
    console.error('hash not found');
    process.exit(1);
  }
  const e = L.rollback(full.hash, { agent: args.agent || 'xiaoluo', reason: args.reason || '' });
  L.save();
  console.log(JSON.stringify({ rollback: e.hash, of: full.hash, tip: L.tipHash }, null, 2));
  process.exit(0);
}

if (cmd === 'verify') {
  const fp = args._[1] || args.file || DEFAULT;
  const L = load(fp);
  const v = L.verify();
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.ok ? 0 : 3);
}

if (cmd === 'stat' || cmd === 'stats') {
  const fp = args._[1] || args.file || DEFAULT;
  const L = load(fp);
  console.log(JSON.stringify(L.stats(), null, 2));
  process.exit(0);
}

if (cmd === 'list') {
  const fp = args._[1] || args.file || DEFAULT;
  const L = load(fp);
  for (const e of L.entries) {
    console.log(`${e.hash.slice(0, 10)}  ${e.ts.slice(0, 19)}  ${e.type.padEnd(10)}  ${e.title}`);
  }
  process.exit(0);
}

if (cmd === 'export') {
  const fmt = args._[1] || 'md';
  const fp = args._[2] || args.file || DEFAULT;
  const L = load(fp);
  if (fmt === 'json') console.log(JSON.stringify(L.toJSON(), null, 2));
  else console.log(formatMarkdown(L));
  process.exit(0);
}

console.error('Unknown command', cmd);
usage();
process.exit(2);
