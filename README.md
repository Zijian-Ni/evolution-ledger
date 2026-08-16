# Evolution Ledger

[![CI](https://github.com/Zijian-Ni/evolution-ledger/actions/workflows/ci.yml/badge.svg)](https://github.com/Zijian-Ni/evolution-ledger/actions/workflows/ci.yml)
[![Live Demo](https://img.shields.io/badge/live%20demo-zijian--ni.github.io-brightgreen)](https://zijian-ni.github.io/evolution-ledger/)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Part of Aurora Evidence Suite](https://img.shields.io/badge/aurora--suite-evidence-violet)](https://github.com/Zijian-Ni)

> **The flight recorder + tamper-evident history for self-evolving agents.**
> Every self-modification carries a hypothesis, a metric, and a rollback point.
> The history can be verified by a third party as not having been rewritten.

Part of the **Aurora Evidence Suite** — five local-first, zero-backend tools for AI agents.
MIT · CN/EN bilingual · zero telemetry · local-first.

---

## 30-second quickstart

```bash
# Install
npm install -g evolution-ledger

# Record a cycle (hypothesis → change → eval → decision)
eledger init ledger.jsonl
eledger cycle --hypothesis "shorter SOUL.md saves tokens" \
  --kind prompt --path SOUL.md \
  --before "1200 tok" --after "800 tok" \
  --metric tokens --m-before 1200 --m-after 800 --pass \
  --decision keep

# Agent-friendly pipe (EL-2)
echo '{"type":"eval","title":"trim SOUL.md","eval":{"metric":"tokens","before":1200,"after":800,"passed":true}}' \
  | eledger record --json --ledger ledger.jsonl

# Verify chain integrity (four-state verdict)
eledger verify ledger.jsonl

# Anchor chain head to git notes (Layer 1 external anchor)
eledger anchor ledger.jsonl

# View the live web viewer
open https://zijian-ni.github.io/evolution-ledger/
```

---

## Why this exists

| Pain | What Evolution Ledger does |
|------|---------------------------|
| Silent self-edits | Records every hypothesis + change + measurement immutably |
| Unfalsifiable "improvements" | Forces a metric before/after for every change |
| No rollback point | `rollback` creates a compensating entry; original never deleted |
| Untrustworthy history | SHA-256 hash chain — tampering is structurally visible |
| Chain can be recomputed | External anchors (git notes / Gist / OTS) prove history wasn't rewritten |

---

## MCP Server (EL-3)

Evolution Ledger ships a **Model Context Protocol (MCP)** server so AI agents can log to the ledger natively without shell commands.

OpenClaw (a self-hosted LLM gateway) and Claude Code can use it directly:

```bash
# Add to Claude
claude mcp add eledger -- npx eledger-mcp

# Or with a specific ledger path
ELEDGER_PATH=~/agent.jsonl npx eledger-mcp
```

### Recommended CLAUDE.md snippet

Add this to your agent's `CLAUDE.md` to enforce the audit discipline:

```markdown
## Evolution Ledger (self-evolution audit)
Before modifying your own prompt/config, record a hypothesis:
  ledger_record({ type: "hypothesis", title: "...", body: "..." })
After the change, record an eval with numbers:
  ledger_record({ type: "eval", title: "...", eval: { metric: "tokens", before: 1200, after: 800, passed: true } })
Use ledger_last_good(path) to find the last known-good state for a file.
```

### Four MCP tools

| Tool | Description |
|------|-------------|
| `ledger_record` | Append a structured entry (hypothesis / change / eval / decision / rollback / note) |
| `ledger_verify` | Four-state chain verification |
| `ledger_stat` | Stats snapshot (entry counts, pass rate, rollbacks) |
| `ledger_last_good` | Walk back to most recent non-reverted change for a file path |

---

## CLI reference

```
eledger init [file]
eledger record --json [--ledger file]        # pipe JSON from stdin (EL-2)
eledger append --type T --title S ...
eledger cycle ...                            # full hypothesis → decision cycle
eledger rollback <hash> [--reason R]
eledger verify [file]                        # four-state verdict (EL-1)
eledger anchor [--publish gist] [--ots]      # external anchoring (EL-1)
eledger keygen                               # Ed25519 keypair (EL-A1)
eledger stat [file]
eledger stat --trend [file]                  # weekly sparklines (EL-4)
eledger export md|json [file]
eledger list [file]

Env: ELEDGER_PATH=./ledger.jsonl
     ELEDGER_ANCHOR_INTERVAL=10  # auto-anchor every N entries
```

---

## Threat model

Evolution Ledger provides different guarantees depending on which anchoring layer you use.

| Layer | What it proves | Attacker model | Honest statement |
|-------|---------------|----------------|------------------|
| **None** | File was not silently corrupted | Accidental corruption | Tamper-evident within the file; a motivated attacker with file access can recompute the whole chain |
| **Git notes** (`eledger anchor`) | Chain head was recorded at a specific git commit | Attacker must also rewrite git history | Resists whole-chain rewriting if notes are pushed to a remote; git history rewriting is detectable |
| **GitHub Gist** (`--publish gist`) | Chain head was published to a third-party server at a specific time | Attacker must control GitHub Gist | Third-party verifiable timestamp; even the chain author cannot backdate a rewrite |
| **OpenTimestamps** (`--ots`) | Chain head was committed to Bitcoin blockchain | Attacker must control Bitcoin | Cryptographically timestamped; independent of the author's infrastructure |
| **Ed25519 Merkle checkpoint** (`keygen` + auto) | Full Merkle tree of entries was signed with a key the agent cannot read | Attacker must steal the private key | **Highest assurance**: even an agent that rewrites the whole chain cannot forge the signature without the key |

**Private key location constraint (EL-A1):** The Ed25519 private key lives at `~/.eledger/key.pem` (mode 0600). For the signing guarantee to hold, the agent process must NOT have read access to this file. This is a deployment-time constraint, not enforced by software.

**Verify state machine:**

```
CHAIN_BROKEN        → prevHash mismatch or content hash changed
HISTORY_REWRITTEN   → an external anchor points at a hash no longer in the chain
VERIFIED_LOCAL_ONLY → chain intact, no external anchor
VERIFIED_ANCHORED   → chain intact + matches at least one external anchor
VERIFIED_SIGNED     → chain intact + valid Ed25519 Merkle checkpoint signature
```

---

## Entry types

| Type | When to use |
|------|-------------|
| `hypothesis` | What you believe will improve the agent, before making the change |
| `change` | The actual mutation: prompt, skill, tool, config, memory, model, policy |
| `eval` | Measurement after the change: metric, before, after, unit, passed |
| `decision` | keep / revert / iterate, with reasoning |
| `rollback` | Compensating entry that never deletes; points back at prior state |
| `note` | Human annotation |
| `checkpoint` | Signed Merkle checkpoint (EL-A1, auto-generated) |

---

## One ledger per agent convention

Each agent should maintain its own `ledger.jsonl`. Point to it via `ELEDGER_PATH`:

```bash
# In your agent's shell config
export ELEDGER_PATH=~/.openclaw/workspace/agent-ledger.jsonl
```

The web viewer accepts multiple ledgers at once — drag and drop several files to group entries by agent.

---

## 中文说明

**Evolution Ledger 是 Aurora Evidence Suite 的「黑匣子」工具**，专为会自我进化的 AI Agent 设计。

核心理念：**每次自我改动都必须带着假设、度量指标和回滚点**，历史记录可被第三方验证从未被改写。

### 快速上手

```bash
# 安装
npm install -g evolution-ledger

# 通过管道写入（代理友好）
echo '{"type":"eval","title":"精简提示词","eval":{"metric":"tokens","before":1200,"after":800,"passed":true}}' \
  | eledger record --json --ledger ledger.jsonl

# 校验链完整性
eledger verify ledger.jsonl
```

### 五种校验状态

| 状态 | 含义 |
|------|------|
| `CHAIN_BROKEN` | 哈希链断裂（内容被篡改）|
| `HISTORY_REWRITTEN` | 外部锚点指向链中不存在的哈希（历史被重写）|
| `VERIFIED_LOCAL_ONLY` | 链完整，但尚无外部锚点 |
| `VERIFIED_ANCHORED` | 链完整 + 匹配外部锚点 |
| `VERIFIED_SIGNED` | 链完整 + Ed25519 Merkle 签名有效 |

---

## Part of the Aurora Evidence Suite

| Tool | Purpose |
|------|---------|
| [Evolution Ledger](https://github.com/Zijian-Ni/evolution-ledger) | Self-evolution audit trail (this repo) |
| [ClaimTape](https://github.com/Zijian-Ni/claimtape) | Claim verification & citation tracking |
| [Traceboard](https://github.com/Zijian-Ni/traceboard) | Execution trace visualization |
| [Skill Distillery](https://github.com/Zijian-Ni/skill-distillery) | Skill extraction & knowledge distillation |

All four share the [aurora-ui](https://github.com/Zijian-Ni/aurora-ui) design system.

---

## License

MIT © Zijian Ni
