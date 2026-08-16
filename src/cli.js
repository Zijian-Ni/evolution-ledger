#!/usr/bin/env node
/**
 * evolution-ledger CLI
 * eledger init | record | append | cycle | rollback | verify | stat | export | anchor | keygen
 */
import fs from 'node:fs';
import path from 'node:path';
import { Ledger, formatMarkdown, ENTRY_TYPES } from './ledger.js';
import {
  anchorToGit, anchorToGist, anchorToOTSSync,
  verifyWithAnchors, VERDICT, shouldAutoAnchor, DEFAULT_ANCHOR_INTERVAL,
} from './anchor.js';
import { validateJsonRecord } from './record.js';

const DEFAULT = process.env.ELEDGER_PATH || path.resolve('ledger.jsonl');
const ANCHOR_INTERVAL = parseInt(process.env.ELEDGER_ANCHOR_INTERVAL || '0', 10) || DEFAULT_ANCHOR_INTERVAL;

function usage() {
  console.log(`evolution-ledger — append-only audit log for agent self-evolution

Commands:
  init [file]                         Create empty ledger
  record --json [--ledger file]       Read JSON from stdin and append (EL-2)
  append --type T --title S [--body B] [--agent xiaoluo]
  cycle --hypothesis H --kind prompt --path P --before A --after B \\
        --metric M --m-before X --m-after Y [--pass|--fail] --decision keep|revert|iterate
  rollback <hash> [--reason R]
  verify [file]                       Four-state verify (EL-1)
  anchor [--publish gist] [--ots]     Anchor chain head externally (EL-1)
  keygen                              Generate Ed25519 keypair (EL-A1)
  stat [file]
  stat --trend [file]                 Weekly trend with sparklines (EL-4)
  export md|json [file]
  list [file]

Env: ELEDGER_PATH=./ledger.jsonl
     ELEDGER_ANCHOR_INTERVAL=10   (auto-anchor every N entries)

EL-2 usage (agent-friendly pipe):
  echo '{"type":"eval","title":"trim SOUL.md","eval":{"metric":"tokens","before":1200,"after":800,"passed":true}}' \\
    | eledger record --json --ledger ledger.jsonl
`);
}

function load(fp = DEFAULT) {
  if (!fs.existsSync(fp)) {
    console.error(`No ledger at ${fp}. Run: eledger init`);
    process.exit(1);
  }
  return Ledger.fromFile(fp);
}

// Boolean flags that never take a value argument
const BOOL_FLAGS = new Set(['json','pass','fail','force','trend','ots']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (BOOL_FLAGS.has(k)) { out[k] = true; continue; }
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

// ─── Trend stats helpers (must be defined before command handlers) ─────────────────

const SPARK_CHARS = ['▁', '▂', '▃', '▅', '▇'];

function weekKey(ts) {
  const d = new Date(ts);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function toSpark(vals) {
  if (!vals.length) return '';
  const max = Math.max(...vals, 1);
  return vals.map(v => SPARK_CHARS[Math.min(4, Math.floor((v / max) * 4))]).join('');
}

function computeTrend(ledger) {
  const weeks = {};
  for (const e of ledger.entries) {
    const w = weekKey(e.ts);
    if (!weeks[w]) weeks[w] = { evals: 0, passed: 0, rollbacks: 0, changes: 0, byKind: {} };
    if (e.type === 'eval' && e.eval) {
      weeks[w].evals++;
      if (e.eval.passed === true) weeks[w].passed++;
    }
    if (e.type === 'rollback') weeks[w].rollbacks++;
    if (e.type === 'change') {
      weeks[w].changes++;
      const k = e.change?.kind || 'other';
      weeks[w].byKind[k] = (weeks[w].byKind[k] || 0) + 1;
    }
  }
  const sortedWeeks = Object.keys(weeks).sort();
  return sortedWeeks.map(w => {
    const d = weeks[w];
    return {
      week: w, evals: d.evals, passed: d.passed,
      passRate: d.evals ? Math.round((d.passed / d.evals) * 100) : null,
      rollbacks: d.rollbacks, changes: d.changes, byKind: d.byKind,
    };
  });
}

function printTrendTable(trend) {
  if (!trend.length) { console.log('No data.'); return; }
  const passRates = trend.map(t => t.passRate ?? 0);
  const rollbacks = trend.map(t => t.rollbacks);
  const changes = trend.map(t => t.changes);
  console.log('\nWeekly Trend');
  console.log('─'.repeat(60));
  console.log('Week       Evals  Pass%  Rollbacks  Changes  PassSpark');
  console.log('─'.repeat(60));
  for (const row of trend) {
    console.log(
      `${row.week}  ` +
      `${String(row.evals).padStart(5)}  ` +
      `${(row.passRate !== null ? row.passRate + '%' : '—').padStart(5)}  ` +
      `${String(row.rollbacks).padStart(9)}  ` +
      `${String(row.changes).padStart(7)}  ` +
      toSpark(passRates.slice(0, trend.indexOf(row) + 1))
    );
  }
  console.log('─'.repeat(60));
  console.log(`Sparklines: PassRate ${toSpark(passRates)}  Rollbacks ${toSpark(rollbacks)}  Changes ${toSpark(changes)}`);
}

// ───────────────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (!cmd || cmd === '-h' || cmd === '--help') {
  usage();
  process.exit(0);
}

// ─── init ─────────────────────────────────────────────────────────────────

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

// ─── record --json (EL-2) ─────────────────────────────────────────────────

if (cmd === 'record' && args.json) {
  const fp = args.ledger || args.file || DEFAULT;

  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;

  const result = validateJsonRecord(raw);
  if (!result.ok) {
    process.stderr.write(JSON.stringify({ ok: false, error: result.error }) + '\n');
    process.exit(2);
  }

  const L = load(fp);
  let entry;
  try {
    entry = L.append({
      ...result.data,
      agent: result.data.agent || args.agent || 'xiaoluo',
    });
  } catch (err) {
    process.stderr.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
    process.exit(2);
  }

  // auto-anchor if interval reached
  if (shouldAutoAnchor(L.entries.length, ANCHOR_INTERVAL)) {
    anchorToGit(L.tipHash, fp, path.dirname(path.resolve(fp)));
  }

  L.save();
  process.stdout.write(JSON.stringify({ ok: true, id: entry.id, hash: entry.hash, type: entry.type }) + '\n');
  process.exit(0);
}

// ─── append ───────────────────────────────────────────────────────────────

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
  if (shouldAutoAnchor(L.entries.length, ANCHOR_INTERVAL)) {
    anchorToGit(L.tipHash, fp, path.dirname(path.resolve(fp)));
  }
  L.save();
  console.log(JSON.stringify({ id: e.id, hash: e.hash, type: e.type }, null, 2));
  process.exit(0);
}

// ─── cycle ────────────────────────────────────────────────────────────────

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
  if (shouldAutoAnchor(L.entries.length, ANCHOR_INTERVAL)) {
    anchorToGit(L.tipHash, fp, path.dirname(path.resolve(fp)));
  }
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

// ─── rollback ─────────────────────────────────────────────────────────────

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

// ─── verify (EL-1: four-state) ────────────────────────────────────────────

if (cmd === 'verify') {
  const fp = args._[1] || args.file || DEFAULT;
  const L = load(fp);
  const cwd = path.dirname(path.resolve(fp));
  const v = verifyWithAnchors(L, cwd);
  console.log(JSON.stringify(v, null, 2));
  // exit 0 for ok states, 3 for broken/rewritten
  const ok = v.verdict === VERDICT.VERIFIED_ANCHORED || v.verdict === VERDICT.VERIFIED_LOCAL_ONLY;
  process.exit(ok ? 0 : 3);
}

// ─── anchor (EL-1) ────────────────────────────────────────────────────────

if (cmd === 'anchor') {
  const fp = args._[1] || args.file || DEFAULT;
  const L = load(fp);
  const cwd = path.dirname(path.resolve(fp));

  if (args.publish === 'gist') {
    const result = anchorToGist(L.tipHash, args['gist-id'], cwd);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (args.ots) {
    const result = anchorToOTSSync(L.tipHash, cwd);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  // default: git anchor
  const result = anchorToGit(L.tipHash, fp, cwd);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

// ─── keygen (EL-A1) ───────────────────────────────────────────────────────

if (cmd === 'keygen') {
  const { keygen } = await import('./attest.js');
  const result = keygen();
  console.log(`Ed25519 keypair generated:`);
  console.log(`  Private key: ${result.keyPath} (mode 0600 — agent must NOT have read access)`);
  console.log(`  Public key:  ${result.pubPath}`);
  console.log(`\nAdd the public key to your ledger repo for third-party verification.`);
  process.exit(0);
}

// ─── stat / stat --trend (EL-4) ───────────────────────────────────────────

if (cmd === 'stat' || cmd === 'stats') {
  const fp = args._[1] || args.file || DEFAULT;
  const L = load(fp);

  if (args.trend) {
    const trend = computeTrend(L);
    printTrendTable(trend);
    process.exit(0);
  }

  console.log(JSON.stringify(L.stats(), null, 2));
  process.exit(0);
}

// ─── list ─────────────────────────────────────────────────────────────────

if (cmd === 'list') {
  const fp = args._[1] || args.file || DEFAULT;
  const L = load(fp);
  for (const e of L.entries) {
    console.log(`${e.hash.slice(0, 10)}  ${e.ts.slice(0, 19)}  ${e.type.padEnd(10)}  ${e.title}`);
  }
  process.exit(0);
}

// ─── export ───────────────────────────────────────────────────────────────

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
