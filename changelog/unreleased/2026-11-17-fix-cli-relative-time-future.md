# CLI: `relativeTime` formats future timestamps as local dates instead of `"now"`

- **Date:** 2026-11-17
- **Type:** fix
- **Scope:** `server`, `cli`
- **PR:** [#1601](https://github.com/Prism-Shadow/penguin-harness/pull/1601)

[中文版](2026-11-17-fix-cli-relative-time-future.zh.md)

When a session timestamp lay ahead of the local clock, `relativeTime` in `packages/server/src/cli/table.ts` produced a negative offset that fell into the `< 60` seconds branch and printed `"now"`, while the web formatter `formatRelativeShort` already returned the local calendar date for future timestamps.

## Details

- `relativeTime` now checks `seconds < 0` before the `"now"` branch and formats future timestamps with `formatLocalDate` in the caller's local timezone.
- Added unit tests for future timestamps across east/west timezones and boundary units in `packages/server/test/cli/table.test.ts`, plus a `penguin session ls` check in `packages/cli/test/server-commands.test.ts`.
