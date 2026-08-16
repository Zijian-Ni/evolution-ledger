# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] — 2026-08-16

### Added

- External anchoring: git notes, optional Gist and OpenTimestamps, with a four-state verdict.
- `record --json` for zero-friction appends from an agent.
- MCP server exposing record / verify / stat / last-good.
- Merkle checkpoints signed with Ed25519, and a policy heatmap in the viewer.

### Fixed

- Anchors are scoped to their own ledger file. They live in a per-repository git notes ref, but the documented convention is one ledger per agent — so a sibling agent's anchor looked like proof that this chain had been rewritten, and every honest ledger reported `HISTORY_REWRITTEN`. A tamper alarm that fires on healthy data trains people to ignore it.
- `verify` exits 0 on `VERIFIED_SIGNED`, which was missing from the success set.

_46 tests._
