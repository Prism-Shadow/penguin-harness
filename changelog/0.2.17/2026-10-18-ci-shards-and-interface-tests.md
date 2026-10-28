# Shorter CI runs, and tests for terminals, new conversations and the machines account

- **Date:** 2026-10-18
- **Type:** process
- **Scope:** `ci`, `web`, `server`
- **PR:** [#1206](https://github.com/Prism-Shadow/penguin-harness/pull/1206)

[中文版](2026-10-18-ci-shards-and-interface-tests.zh.md)

Shortened the longest CI jobs of web and server pull requests, and spent part of the time saved on tests for the parts of the Web App behind this round's terminal, new-conversation and machine-reconnect bugs.

## CI layout

- On Linux the web suite runs in two jobs, `web-1` and `web-2`, each running half of the `web`, `ui` and `cli` test files (`vitest --shard`); each uploads the coverage of its half. A full run splits the Windows `sites` shard the same way; macOS keeps one `sites` job.
- The Windows server suite keeps its three shards, its files now dealt by their measured Windows durations (`packages/server/test/shard-weights.json`, averaged over the logs of seven runs and refreshed by `packages/server/scripts/shard-weights.mjs`) instead of by a hash of their paths.
- The server suite runs one Vitest worker per core on macOS, at most four (three on the runner); Linux and Windows keep two.
- The typecheck job builds only what the checked packages import: their dependencies, never a site bundle (`web`, `ui-gallery`, `docs`, `landing`) nor the checked packages themselves. The web test jobs build the web's dependencies, not its bundle.
- browser-smoke builds the server without type declarations, installs Chromium while it builds, and runs `dock.spec.mjs` (which also selects `mobile-dock.spec.mjs`) and `terminal.spec.mjs` beside the existing smoke specs. The component library's layout checks moved from browser-smoke into the Linux job that tests the gallery. The dock spec's check that the Files panel is on screen looks for the panel's Refresh button instead of a root label the panel no longer shows.

## New tests

- `terminal-list.test.ts`: the terminal list over this server and every machine, killing a shell on the machine that holds it, and pruning terminal tabs only on a complete answer, with `test/helpers/terminal-world.ts` as the terminals' fake.
- `draft-send.test.ts`: a new conversation's first send through the draft page, on a machine's Workspace, with the create or the first task refused, a second click, and a self-healed id, with `test/helpers/draft-world.ts` as its server and frame.
- `machines-account.test.ts`: the machines account every machine surface reads (coalesced reads, a late answer about a Project the user left, a failed read, a member, an answer a request already brought).
- `shard-deal.test.ts`: the weighted dealing of server test files into shards.
