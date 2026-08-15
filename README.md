# 🎀 Evolution Ledger

**How an AI agent was actually trained — and how to prove it.**

Append-only, tamper-evident audit ledger for **agent self-evolution**: every hypothesis, change, measurement, decision and rollback, hash-chained so history cannot be quietly rewritten.

[![MIT](https://img.shields.io/badge/license-MIT-4fe3d0)](LICENSE)
![offline](https://img.shields.io/badge/runs-100%25%20local-a77bff)
![deps](https://img.shields.io/badge/runtime%20deps-0-56b8ff)

🔗 **Live viewer:** https://zijian-ni.github.io/evolution-ledger/

---

## The problem (real, not hypothetical)

Self-evolving agents (OpenClaw, Hermes, DSPy/GEPA loops, auto-prompt-optimizers) rewrite their own prompts, skills and configs. In practice:

| Pain | What actually happens |
|------|----------------------|
| **Silent self-edits** | Agent tweaks its own prompt. Three weeks later quality drops and nobody can say what changed. |
| **Unfalsifiable "improvements"** | No metric captured before/after → every change sounds like progress. |
| **No rollback point** | Last known-good policy was overwritten in place. You can't go back. |
| **Untrustworthy history** | A log the agent can rewrite isn't evidence. |

Real example encoded in the demo ledger: a memory index was "improved" by adding 72,931 crawled documents — query latency went **0.3s → 180s** and personal recall got drowned in noise. Without a ledger, that regression is archaeology. With one, it's a `revert` entry with the metric attached.

---

## What this is

```
hypothesis → change → eval → decision ──(revert)──> rollback
     └──────────── hash-chained, append-only ────────────┘
```

- **Append-only.** Rollback never deletes; it appends a *compensating* entry pointing at the prior good hash.
- **Tamper-evident.** Each entry stores `prevHash` + content hash (SHA-256). Edit any past entry → `verify` fails.
- **Measured.** An `eval` entry carries `metric / before / after / passed / evidence`.
- **Zero runtime deps.** Node CLI + static viewer. Nothing uploaded, no API key.

---

## Quickstart

```bash
npm install
npm test          # 10 tests
npm run build     # static viewer → dist/

# CLI
node src/cli.js init ledger.jsonl

node src/cli.js cycle \
  --hypothesis "Trim SOUL.md preamble to cut tokens" \
  --kind prompt --path SOUL.md \
  --before "long preamble" --after "short preamble" \
  --metric tokens --m-before 1200 --m-after 800 --pass \
  --decision keep

node src/cli.js verify     # chain integrity
node src/cli.js stat       # pass rate, active changes, rollbacks
node src/cli.js list
node src/cli.js export md > EVOLUTION.md
```

Failed experiment? Use `--fail --decision revert` — the rollback entry is appended automatically and `activeChanges` drops back.

---

## Viewer

```bash
npm run dev        # http://localhost:5173
```

- Aurora glass UI (navy / teal / violet), EN ⇄ 中文
- Timeline with per-type nodes, reverted entries struck through
- Click any entry → drawer with before/after diff + raw JSON
- **Verify chain** button recomputes hashes in the browser
- Drag-drop your own `ledger.jsonl` — never leaves your machine

---

## Entry schema

```jsonc
{
  "id": "uuid",
  "ts": "2026-08-15T19:21:40.014Z",
  "type": "change",              // hypothesis|change|eval|decision|rollback|note
  "agent": "xiaoluo",
  "title": "Add tool-liveness reflex",
  "change": { "kind": "policy", "path": "AGENTS.md#Reflex-7",
              "before": "...", "after": "...", "summary": "..." },
  "eval":   { "metric": "silent_failure_days", "before": 8, "after": 0,
              "unit": "days", "passed": true, "evidence": "healthcheck OK" },
  "decision": { "action": "keep", "reason": "..." },
  "prevHash": "…",
  "hash": "…"
}
```

`kind`: `prompt | skill | tool | config | memory | model | policy | other`

---

## Why not just git?

Git versions **files**. This versions **the reasoning loop**: why a change was attempted, what was measured, whether it passed, and what the compensating action was. It also survives changes that never touch a repo — model swaps, runtime config, memory index scope, routing policy.

Use both: git for content, ledger for *evidence of learning*.

---

## 中文说明

会自我进化的 Agent 会改自己的提示词、技能、配置——通常**没有任何审计痕迹**。质量三周后下滑时，没人说得清改了什么、当时测了什么、能退回哪一版。

Evolution Ledger 用**只追加 + 哈希链**记录每一次「假设 → 改动 → 评测 → 决策 →（必要时）回滚」：

- 回滚不删除历史，而是追加补偿条目，指向上一个良好状态
- 任何人篡改旧条目，`verify` 立刻报链断裂
- 评测必须带指标（改前/改后/是否通过/证据），杜绝「听起来像进步」
- 纯本地运行，零运行时依赖，不上传任何数据

---

## Integrations

- **OpenClaw / Hermes**: pipe self-evolution hooks into `eledger cycle`
- **[Traceboard](https://github.com/Zijian-Ni/traceboard)**: run traces
- **[Skill Distillery](https://github.com/Zijian-Ni/skill-distillery)**: distilled skills become `change` entries
- **[Aurora Orchestra](https://github.com/Zijian-Ni/aurora-orchestra)**: orchestration evidence packs

MIT © Zijian Ni
