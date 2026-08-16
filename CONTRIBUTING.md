# Contributing to Evolution Ledger

Thank you for your interest! Evolution Ledger is part of the **Aurora Evidence Suite** — local-first, zero-backend, MIT licensed.

## Hard constraints (non-negotiable)

- **Zero runtime dependencies** for the main CLI (`src/`). The MCP subpackage (`packages/mcp/`) may have deps — it is a separate `package.json`.
- **CN/EN bilingual**: add i18n strings to `src/i18n.js` for any new UI text.
- **Zero telemetry**: no tracking, no analytics, no external requests from the CLI or viewer.
- **MIT license** on all contributions.

## Development setup

```bash
git clone https://github.com/Zijian-Ni/evolution-ledger.git
cd evolution-ledger
npm install
npm test        # run all tests
npm run build   # build the web viewer
npm run dev     # start dev server for the viewer
```

For the MCP subpackage:

```bash
cd packages/mcp
npm install
npm test
```

## Commit convention

Use [Conventional Commits](https://www.conventionalcommits.org/) with task IDs in the body:

```
feat(anchor): git notes anchoring with four-state verdict

Add Layer 1 external anchoring via git notes. Upgrade verify
to return CHAIN_BROKEN / HISTORY_REWRITTEN / VERIFIED_ANCHORED /
VERIFIED_LOCAL_ONLY.

Task: EL-1
```

Types: `feat` · `fix` · `test` · `docs` · `refactor` · `chore`

## Adding new features

1. Read the existing code first — especially `src/core.js` (data model) and `src/ledger.js` (Node persistence).
2. New modules go in `src/`. New CLI commands extend `src/cli.js`.
3. Add tests in `tests/` (uses Node's built-in `node:test`).
4. If adding UI text, add both `en` and `zh` entries to `src/i18n.js`.
5. Run `npm test && npm run build` before opening a PR.

## aurora-ui design system

The viewer uses the vendored `src/aurora-ui/` files from [aurora-ui](https://github.com/Zijian-Ni/aurora-ui). Five aesthetic laws apply:

1. **Instrument, not ornament** — every card must show a readable value.
2. **One focus per screen** — `.aurora-ring` appears exactly once (on the verify-result card).
3. **Density layers** — browse layer dense, focus layer airy, never mixed.
4. **OKLCH colour discipline** — new colours in OKLCH only.
5. **Texture triad, one each** — grain on background, glow on lamps/ring, scanlines in terminals.

## Testing philosophy

- Tests live in `tests/*.test.js`, run with `node --test`.
- No external test framework — `node:test` + `node:assert/strict` only.
- Each new module should have a corresponding `tests/<module>.test.js`.
- DoD tests (e.g. HISTORY_REWRITTEN replay attack) must be real integration tests, not mocks.

## Pull request checklist

- [ ] `npm test` passes (all 45+ tests green)
- [ ] `npm run build` succeeds
- [ ] New UI text has `en` + `zh` translations
- [ ] No runtime dependencies added to main package
- [ ] Commit messages follow Conventional Commits
- [ ] README updated if the feature is user-visible
