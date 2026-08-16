/**
 * EL-3 DoD: server starts, tools/list returns four tools,
 * scripted stdio round-trip appends a real entry.
 *
 * Note: This MCP SDK uses newline-delimited JSON (NDJSON), NOT Content-Length framing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '../src/server.js');

function sendLine(proc, msg) {
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

function readNextLine(proc, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => {
      proc.stdout.off('data', onData);
      reject(new Error(`Timeout waiting for NDJSON line (${timeoutMs}ms). Buffer so far: ${buf.slice(0, 200)}`));
    }, timeoutMs);

    const onData = (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(t);
        proc.stdout.off('data', onData);
        const line = buf.slice(0, nl).trim();
        try {
          resolve(JSON.parse(line));
        } catch (e) {
          reject(new Error(`Invalid JSON line: ${line}`));
        }
      }
    };
    proc.stdout.on('data', onData);
  });
}

test('MCP server: tools/list returns four tools and record appends entry', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'eledger-mcp-test-'));
  const ledgerPath = join(tmpDir, 'test.jsonl');

  const proc = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, ELEDGER_PATH: ledgerPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stderr.on('data', d => {/* suppress */});

  try {
    // 1. Initialize
    sendLine(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.1' },
      },
    });

    const initResp = await readNextLine(proc);
    assert.equal(initResp.id, 1, 'initialize should return id 1');
    assert.ok(initResp.result, `initialize should succeed, got: ${JSON.stringify(initResp)}`);

    // Send initialized notification (no response expected)
    sendLine(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });

    // 2. List tools
    sendLine(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' });

    const listResp = await readNextLine(proc);
    assert.equal(listResp.id, 2, 'tools/list should return id 2');
    assert.ok(listResp.result?.tools, `should have tools array, got: ${JSON.stringify(listResp)}`);

    const toolNames = listResp.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('ledger_record'), `should have ledger_record, tools: ${toolNames}`);
    assert.ok(toolNames.includes('ledger_verify'), 'should have ledger_verify');
    assert.ok(toolNames.includes('ledger_stat'), 'should have ledger_stat');
    assert.ok(toolNames.includes('ledger_last_good'), 'should have ledger_last_good');
    assert.equal(listResp.result.tools.length, 4, `should have exactly 4 tools, got: ${toolNames}`);

    // 3. Call ledger_record
    sendLine(proc, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'ledger_record',
        arguments: {
          type: 'eval',
          title: 'MCP round-trip test',
          eval: { metric: 'latency', before: 500, after: 120, unit: 'ms', passed: true },
        },
      },
    });

    const recordResp = await readNextLine(proc);
    assert.equal(recordResp.id, 3, 'ledger_record should return id 3');
    assert.ok(recordResp.result, `record call should succeed, got: ${JSON.stringify(recordResp)}`);
    const recordData = JSON.parse(recordResp.result.content[0].text);
    assert.equal(recordData.ok, true, `record should succeed, got: ${JSON.stringify(recordData)}`);
    assert.ok(recordData.id, 'should have entry id');
    assert.ok(recordData.hash, 'should have entry hash');
    assert.equal(recordData.type, 'eval', 'type should be eval');

    // 4. Verify chain
    sendLine(proc, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'ledger_verify', arguments: {} },
    });

    const verifyResp = await readNextLine(proc);
    assert.equal(verifyResp.id, 4, 'ledger_verify should return id 4');
    const verifyData = JSON.parse(verifyResp.result.content[0].text);
    assert.ok(
      verifyData.verdict === 'VERIFIED_LOCAL_ONLY' || verifyData.verdict === 'VERIFIED_ANCHORED',
      `Expected VERIFIED_*, got ${verifyData.verdict}`
    );

    // 5. Stat
    sendLine(proc, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'ledger_stat', arguments: {} },
    });

    const statResp = await readNextLine(proc);
    const statData = JSON.parse(statResp.result.content[0].text);
    assert.ok(statData.totalEntries >= 1, `should have entries, got: ${JSON.stringify(statData)}`);

  } finally {
    proc.stdin.end();
    proc.kill();
    rmSync(tmpDir, { recursive: true });
  }
});
