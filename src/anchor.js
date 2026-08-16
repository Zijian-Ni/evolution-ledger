/**
 * EL-1: External anchoring — three layers
 *
 * Layer 1: git notes (always available, no external dependency)
 * Layer 2: GitHub Gist (optional, requires `gh` CLI)
 * Layer 3: OpenTimestamps (optional, requires `ots` CLI)
 *
 * Threat model:
 * - LOCAL_ONLY: hash chain is tamper-evident WITHIN the file, but an
 *   attacker with file access can recompute the whole chain.
 * - GIT_ANCHORED: the chain head is recorded in git notes.
 *   If notes are pushed to a remote, rewriting the whole chain would
 *   require also rewriting the git note history — detectable.
 * - GIST/OTS: third-party-verifiable timestamp; even the author
 *   cannot backdate a rewrite.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const GIT_NOTES_REF = 'eledger';

// ─── Layer 1: git notes ────────────────────────────────────────────────────

/**
 * Write an anchor note at the current HEAD commit.
 * @param {string} headHash  – SHA-256 tip of the ledger chain
 * @param {string} ledgerPath – absolute/relative path to the .jsonl file
 * @param {string} [cwd]     – git repository root (default: process.cwd())
 * @returns {{ ok: boolean, note: string, error?: string }}
 */
export function anchorToGit(headHash, ledgerPath, cwd = process.cwd()) {
  const ts = new Date().toISOString();
  const note = `eledger-anchor ${ts} ${ledgerPath} ${headHash}`;
  try {
    execFileSync('git', ['notes', `--ref=${GIT_NOTES_REF}`, 'append', '-m', note], {
      cwd, stdio: 'pipe',
    });
    return { ok: true, note };
  } catch (err) {
    return { ok: false, note, error: String(err.stderr || err.message) };
  }
}

/**
 * Read all git-note anchors for this repository.
 * @param {string} [cwd]
 * @returns {Array<{ts:string, path:string, headHash:string, raw:string}>}
 */
export function listGitAnchors(cwd = process.cwd()) {
  try {
    // List all notes objects in the eledger ref
    const out = execFileSync('git', ['notes', `--ref=${GIT_NOTES_REF}`, 'list'], {
      cwd, stdio: 'pipe',
    }).toString().trim();
    if (!out) return [];

    const anchors = [];
    const lines = out.split('\n').filter(Boolean);
    for (const line of lines) {
      const [noteSha] = line.split(' ');
      if (!noteSha) continue;
      try {
        const content = execFileSync('git', ['cat-file', 'blob', noteSha], {
          cwd, stdio: 'pipe',
        }).toString().trim();
        for (const noteLine of content.split('\n')) {
          const m = noteLine.match(/^eledger-anchor\s+(\S+)\s+(\S+)\s+([0-9a-f]{64})$/);
          if (m) {
            anchors.push({ ts: m[1], path: m[2], headHash: m[3], raw: noteLine });
          }
        }
      } catch {
        // skip malformed note blobs
      }
    }
    return anchors;
  } catch {
    return [];
  }
}

// ─── Layer 2: GitHub Gist (optional) ──────────────────────────────────────

/**
 * Append {ts, headHash} to a public Gist via the `gh` CLI.
 * @param {string} headHash
 * @param {string} [gistId]   – existing gist ID, or omit to create a new one
 * @param {string} [cwd]
 * @returns {{ ok: boolean, gistId?: string, error?: string }}
 */
export function anchorToGist(headHash, gistId, cwd = process.cwd()) {
  if (!isCommandAvailable('gh')) {
    return { ok: false, error: 'gh CLI not found — install from https://cli.github.com' };
  }
  const ts = new Date().toISOString();
  const payload = JSON.stringify({ ts, headHash });

  try {
    if (!gistId) {
      // create new gist
      const result = execFileSync(
        'gh', ['gist', 'create', '--public', '--filename', 'eledger-anchors.json', '--'],
        { input: payload, cwd, stdio: 'pipe' },
      ).toString().trim();
      const m = result.match(/gist\.github\.com\/[^/]+\/([0-9a-f]+)/);
      return { ok: true, gistId: m?.[1] || result };
    } else {
      // append to existing gist file
      execFileSync(
        'gh', ['gist', 'edit', gistId, '--filename', 'eledger-anchors.json'],
        { input: payload, cwd, stdio: 'pipe' },
      );
      return { ok: true, gistId };
    }
  } catch (err) {
    return { ok: false, error: String(err.stderr || err.message) };
  }
}

// ─── Layer 3: OpenTimestamps (optional) ───────────────────────────────────

/**
 * Stamp headHash with OpenTimestamps using the `ots` CLI.
 * @param {string} headHash
 * @param {string} [cwd]
 * @returns {{ ok: boolean, stampFile?: string, error?: string }}
 */
export function anchorToOTSSync(headHash, cwd = process.cwd()) {
  if (!isCommandAvailable('ots')) {
    return { ok: false, error: 'ots CLI not found — install from https://opentimestamps.org' };
  }
  try {
    const tmpFile = path.join(cwd, `.eledger-ots-${Date.now()}.hex`);
    writeFileSync(tmpFile, headHash + '\n', 'utf8');
    execFileSync('ots', ['stamp', tmpFile], { cwd, stdio: 'pipe' });
    return { ok: true, stampFile: tmpFile + '.ots' };
  } catch (err) {
    return { ok: false, error: String(err.stderr || err.message) };
  }
}

// ─── Verify with anchors → four-state verdict ─────────────────────────────

export const VERDICT = {
  CHAIN_BROKEN:        'CHAIN_BROKEN',
  HISTORY_REWRITTEN:   'HISTORY_REWRITTEN',
  VERIFIED_ANCHORED:   'VERIFIED_ANCHORED',
  VERIFIED_LOCAL_ONLY: 'VERIFIED_LOCAL_ONLY',
};

/**
 * Four-state verification.
 *
 * CHAIN_BROKEN        – prevHash mismatch or content hash mismatch
 * HISTORY_REWRITTEN   – a git anchor points at a hash not in the current chain
 * VERIFIED_ANCHORED   – chain is intact and at least one anchor matches chain
 * VERIFIED_LOCAL_ONLY – chain is intact but no anchors found
 *
 * @param {import('./core.js').Ledger} ledger
 * @param {string} [cwd]
 * @returns {{ verdict: string, ok: boolean, count: number, issues: any[], anchors: any[] }}
 */
export function verifyWithAnchors(ledger, cwd = process.cwd()) {
  const base = ledger.verify();

  if (!base.ok) {
    return {
      verdict: VERDICT.CHAIN_BROKEN,
      ok: false,
      count: base.count,
      issues: base.issues,
      anchors: [],
    };
  }

  // Build set of all hashes in the current chain
  const chainHashes = new Set(ledger.entries.map(e => e.hash));

  const anchors = listGitAnchors(cwd);

  if (anchors.length === 0) {
    return {
      verdict: VERDICT.VERIFIED_LOCAL_ONLY,
      ok: true,
      count: base.count,
      issues: [],
      anchors: [],
    };
  }

  // Check if any anchor references a hash NOT in the current chain
  const rewrittenAnchors = anchors.filter(a => !chainHashes.has(a.headHash));

  if (rewrittenAnchors.length > 0) {
    return {
      verdict: VERDICT.HISTORY_REWRITTEN,
      ok: false,
      count: base.count,
      issues: rewrittenAnchors.map(a => ({
        error: 'anchor hash not in chain',
        anchorHash: a.headHash,
        anchorTs: a.ts,
      })),
      anchors,
    };
  }

  return {
    verdict: VERDICT.VERIFIED_ANCHORED,
    ok: true,
    count: base.count,
    issues: [],
    anchors,
  };
}

// ─── Auto-anchor every N entries ──────────────────────────────────────────

export const DEFAULT_ANCHOR_INTERVAL = 10;

/**
 * Should we auto-anchor after appending this entry?
 * Returns true when entry count is a multiple of N.
 */
export function shouldAutoAnchor(entryCount, interval = DEFAULT_ANCHOR_INTERVAL) {
  return entryCount > 0 && entryCount % interval === 0;
}

// ─── Helper ───────────────────────────────────────────────────────────────

function isCommandAvailable(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
