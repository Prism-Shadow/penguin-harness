# `pnpm penguin` runs the CLI again

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `tooling`, `cli`

[中文版](2026-08-19-penguin-dev-script-entry.zh.md)

The repo root's `pnpm penguin` script now runs `packages/cli/src/penguin.ts`, the source file the `penguin` bin is built from, instead of `packages/cli/src/index.ts`.

Splitting the CLI entry in [#298](https://github.com/Prism-Shadow/penguin-harness/pull/298) left `index.ts` exporting `cli()` and moved the invocation into `penguin.ts`. That change updated `packages/cli`'s own `penguin` script and the bin, but not the root one, so from 2026-08-18 every `pnpm penguin <args>` at the repo root imported the module, ran nothing and exited 0 — no output, no error, and `dotenv/config` never loaded. `pnpm penguin chat` looked like a CLI that refused to start.

## Details

- A drift guard in `packages/cli/test/dev-script-entry.test.ts` derives the expected source entry from `bin.penguin` and asserts both dev scripts run it, so a future entry rename cannot silently strand one of them.
- The installed and globally linked `penguin` commands were never affected: they run the bin, which has pointed at `dist/penguin.js` throughout.
