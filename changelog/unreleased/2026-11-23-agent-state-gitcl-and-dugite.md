# Workbench versions are recorded by the host's git when it has one

- **Date:** 2026-11-23
- **Type:** change
- **Scope:** `server`, `plugins`, `docs`

[中文版](2026-11-23-agent-state-gitcl-and-dugite.zh.md)

The server module plugin that records Agent State versions with native Git splits in two, and the
one a host with git needs no longer downloads anything:

- `@penguinharness/agent-state-gitcl` (new) runs the Git command line the host already has — the
  `git` on its `PATH`, probed once and the answer remembered — the standard git commands, one
  process each, for the same two steps the previous plugin ran a downloaded build for: writing a
  commit, and reading a version's files back. Nothing is downloaded and nothing is kept; the
  host's Git finds its own exec path, and the plugin sets no `GIT_EXEC_PATH` for it. A host
  whose `git` is not on the `PATH`, or does not run, has no Git.
- `@penguinharness/agent-state-dugite` (renamed from `agent-state-git`) is unchanged otherwise: it
  fetches GitHub Desktop's build of Git, as dugite pins it, the first time it runs on a host, and
  serves the hosts the gitcl plugin cannot — no `git` on the `PATH`, a program that does not run,
  or one that is not Git.

## Which engine runs

Which engine records versions is the harness's own decision, not a contributor's: the built-in
side prefers the harness's own plugins' engines — the gitcl engine first, the dugite engine the
fallback for a host without git — and any engine another plugin contributed runs behind them,
in contribution order. A host with neither keeps the built-in engine, as before. All of them
write the same commits, so the repository never notices which one wrote.

## Details

- The gitcl engine declares the same `fasterFrom` steps as the dugite engine, which its bench
  (`bench/engines.bench-run.ts`) measured.
- The gitcl plugin ships no binary and carries no test-time download; its live suites run where a
  usable `git` exists and skip elsewhere, the same gate the other plugins' suites use
  (`PENGUIN_MUST_RUN`).
- Both plugins are on the Plugins page with no category; an administrator installs them on the
  server. The Skills & Plugins docs describe both.
