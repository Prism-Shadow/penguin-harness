# A faster unit-test suite, and assertions that stop transcribing prose

- **Date:** 2026-08-20
- **Type:** process
- **Scope:** `server`, `core`, `web`, `skills`, `tooling`

[中文版](2026-08-20-faster-unit-tests.zh.md)

`pnpm -r test` went from a 64.7s median to 38.7s, and the server package — which the
workspace's dependency order puts on the critical path — from 51.5s to 13.4s, measured over
five interleaved before/after runs on an 8-core Linux box. Two changes account for it: a
token scrypt cost for password hashing in tests, and a module registry the server's vitest
workers keep across the files they run. A separate sweep replaced assertions that
transcribed prose out of shipped documents and i18n dictionaries with the invariants
underneath them.

## Password hashing in tests

- `hashPassword` took the scrypt work factor as a defaulted argument, and `buildAppDeps`
  gained a `passwordHashCost` override alongside the `loader` / `titles` / `updateCheck`
  test doubles it already accepted. The server's test helper passes the lowest legal
  factor. Nothing on the production path passes the argument, and `buildAppDeps` is not in
  the package's `exports`, so no configuration reaches it.
- The stored format, the recorded parameters and the verification path are the same either
  way: the factor travels inside the hash string, so `verifyPassword` re-derives at
  whatever cost wrote it and hashes already on disk keep verifying.
- `password.test.ts` calls the unparameterized form and now asserts the production factor
  is 16384, so lowering the default has to be a deliberate edit to that test.

## Worker isolation

- `packages/server/vitest.config.ts` set `isolate: false`, so a worker keeps its module
  registry across the files it runs. Every file in that suite imports the whole app graph,
  core's bundle included. Fork spawns went from one per test file to one per worker.
- The pool stayed `forks`: `process.env` is per-process, and several files in this suite
  mutate and restore it, so a thread pool would let them race.
- The same config set `restoreMocks: true`, so a spy whose inline `mockRestore()` is
  skipped by a failing assertion cannot stay installed for the rest of the worker.
- `packages/server/test/isolation.test.ts` fails if any file in the suite registers a
  module mock — the one thing a shared registry cannot tolerate, and the one whose damage
  would surface in an unrelated file.

## Assertions that transcribed prose

- `packages/skills`: three tests pinned about 140 exact sentences from `benchmark-design`,
  `agent-evaluation`, `agent-optimization` and `remote-claude-code`. Five tests replaced
  them, pinning what an agent executes — the launch statements and their CLI flags, the
  tmux commands, the Evaluator protocol's block scalars and absent `max_score` — and the
  section ordering those documents depend on.
- `packages/web`: kernel field labels, memory chat drafts, compaction titles and nav toggle
  names assert through the dictionaries instead of transcribing their values, and the
  kernel-label test covers every key in both dictionaries rather than two of them. The
  example-task drafts keep their parameter markers, forbidden markers and length bounds,
  and let the scenario copy change.
- `packages/core`: the default system prompt's guardrail test kept what a reword must not
  change — no service port number, no vault CLI command — and the ordering that puts the
  retry rule inside `# Stop rules`.
- `packages/cli`: the readiness probe's firewall hint is checked for the port number and
  for being distinct from the refused-connection hint, rather than by both translations of
  the sentence.
