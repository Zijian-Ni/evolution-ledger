#!/usr/bin/env node
/**
 * EL-3: Evolution Ledger MCP Server
 *
 * Exposes four tools to AI agents via MCP stdio transport:
 *   ledger_record     – append a structured entry
 *   ledger_verify     – four-state chain verification
 *   ledger_stat       – stats snapshot
 *   ledger_last_good  – walk back to most recent kept change for a path
 *
 * Usage:
 *   ELEDGER_PATH=/path/to/ledger.jsonl eledger-mcp
 *   claude mcp add eledger -- npx eledger-mcp
 *
 * Recommended CLAUDE.md snippet:
 *   ---
 *   # Evolution Ledger (OpenClaw self-evolution audit)
 *   Before modifying your own prompt/config, record a hypothesis:
 *     ledger_record({ type: "hypothesis", title: "...", body: "..." })
 *   After the change, record an eval with numbers:
 *     ledger_record({ type: "eval", title: "...", eval: { metric: "tokens", before: 1200, after: 800, passed: true } })
 *   Use ledger_last_good(path) to find the last known-good state for a file.
 *   ---
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Path resolution ───────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
// The ledger library lives in the root package; we use a relative path.
const LEDGER_ROOT = resolve(__dirname, '../../../');

// Dynamic import from root src (avoids duplicating code)
const { Ledger } = await import(resolve(LEDGER_ROOT, 'src/ledger.js'));
const { ENTRY_TYPES } = await import(resolve(LEDGER_ROOT, 'src/core.js'));
const { validateJsonRecord } = await import(resolve(LEDGER_ROOT, 'src/record.js'));
const { verifyWithAnchors } = await import(resolve(LEDGER_ROOT, 'src/anchor.js'));

const LEDGER_PATH = resolve(process.env.ELEDGER_PATH || 'ledger.jsonl');

function loadLedger() {
  if (!existsSync(LEDGER_PATH)) {
    // Auto-init if missing
    mkdirSync(dirname(LEDGER_PATH), { recursive: true });
    writeFileSync(LEDGER_PATH, '');
    const L = new Ledger(LEDGER_PATH);
    L.append({
      type: 'note',
      agent: 'eledger-mcp',
      title: 'Ledger opened via MCP',
      body: 'Auto-initialized by eledger-mcp server.',
      tags: ['genesis'],
    });
    L.save();
    return L;
  }
  return new Ledger(LEDGER_PATH);
}

// ─── Server setup ─────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'eledger',
  version: '0.1.0',
});

// ─── Tool: ledger_record ──────────────────────────────────────────────────

server.tool(
  'ledger_record',
  'Append a structured entry to the Evolution Ledger. Required: type, title. Optional: body, agent, eval, change, hypothesis, decision, tags, meta.',
  {
    type: z.enum(['hypothesis', 'change', 'eval', 'decision', 'rollback', 'note'])
      .describe('Entry type'),
    title: z.string().min(1).describe('Short title for the entry'),
    body: z.string().optional().describe('Longer description'),
    agent: z.string().optional().describe('Agent name (default: from ELEDGER_AGENT env or "agent")'),
    hypothesis: z.object({
      body: z.string().optional(),
      title: z.string().optional(),
    }).optional().describe('Hypothesis details (for type=hypothesis)'),
    change: z.object({
      kind: z.enum(['prompt', 'skill', 'tool', 'config', 'memory', 'model', 'policy', 'other']).optional(),
      path: z.string().optional(),
      before: z.any().optional(),
      after: z.any().optional(),
      summary: z.string().optional(),
    }).optional().describe('Change details (for type=change)'),
    eval: z.object({
      metric: z.string(),
      before: z.any().optional(),
      after: z.any().optional(),
      unit: z.string().optional(),
      passed: z.boolean().optional(),
      evidence: z.string().optional(),
    }).optional().describe('Eval details (for type=eval)'),
    decision: z.object({
      action: z.enum(['keep', 'revert', 'iterate']),
      reason: z.string().optional(),
    }).or(z.string()).optional().describe('Decision details (for type=decision)'),
    tags: z.array(z.string()).optional(),
  },
  async (input) => {
    const jsonRaw = JSON.stringify(input);
    const validation = validateJsonRecord(jsonRaw);
    if (!validation.ok) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: validation.error }) }],
        isError: true,
      };
    }

    try {
      const L = loadLedger();
      const entry = L.append({
        ...validation.data,
        agent: validation.data.agent || process.env.ELEDGER_AGENT || 'agent',
      });
      L.save();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            id: entry.id,
            hash: entry.hash,
            type: entry.type,
            count: L.entries.length,
          }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool: ledger_verify ──────────────────────────────────────────────────

server.tool(
  'ledger_verify',
  'Verify the ledger chain. Returns a four-state verdict: CHAIN_BROKEN, HISTORY_REWRITTEN, VERIFIED_ANCHORED, or VERIFIED_LOCAL_ONLY.',
  {},
  async () => {
    try {
      const L = loadLedger();
      const result = verifyWithAnchors(L, dirname(LEDGER_PATH));
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            verdict: result.verdict,
            ok: result.ok,
            count: result.count,
            anchors: result.anchors.length,
            issues: result.issues,
          }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool: ledger_stat ────────────────────────────────────────────────────

server.tool(
  'ledger_stat',
  'Get statistics snapshot of the ledger: entry counts by type, eval pass rate, active changes, rollbacks.',
  {},
  async () => {
    try {
      const L = loadLedger();
      const stats = L.stats();
      return {
        content: [{ type: 'text', text: JSON.stringify(stats) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool: ledger_last_good ───────────────────────────────────────────────

server.tool(
  'ledger_last_good',
  'Walk back to the most recent non-reverted "keep" change entry for a given file path. Returns the entry or null if none found.',
  {
    path: z.string().describe('File path to search for (e.g. "SOUL.md" or "AGENTS.md#Reflex-7")'),
  },
  async ({ path: targetPath }) => {
    try {
      const L = loadLedger();

      // Collect all hashes that were rolled back
      const rolledBack = new Set(
        L.entries
          .filter(e => e.type === 'rollback' && e.rollbackOf)
          .map(e => e.rollbackOf)
      );

      // Find keep decisions
      const keepDecisions = new Set(
        L.entries
          .filter(e => e.type === 'decision' && e.decision?.action === 'keep' && e.meta?.changeHash)
          .map(e => e.meta.changeHash)
      );

      // Walk backwards through change entries
      let lastGood = null;
      for (let i = L.entries.length - 1; i >= 0; i--) {
        const e = L.entries[i];
        if (e.type !== 'change') continue;
        if (rolledBack.has(e.hash)) continue;
        if (e.change?.path && (
          e.change.path === targetPath ||
          e.change.path.startsWith(targetPath)
        )) {
          lastGood = e;
          break;
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            found: !!lastGood,
            entry: lastGood ? {
              id: lastGood.id,
              hash: lastGood.hash,
              title: lastGood.title,
              ts: lastGood.ts,
              change: lastGood.change,
            } : null,
          }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

// ─── Start server ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
