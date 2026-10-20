# Web E2E (Playwright)

Browser end-to-end tests: chat (thinking + tool approval + tool execution + second-turn
reply), the iconified stats line (cost conversion / copy reply), Session fork (footer action
right of copy, confirm-gated, and no stray request after deleting the fork), Traces (per-Task
timeline + legend + hover-linked highlighting), Workspace file preview (sandboxed HTML
rendering, path hidden by default). The LLM is driven by `mock-llm.mjs` (a mock Anthropic
Messages SSE endpoint) — no network access.

```sh
pnpm --filter @prismshadow/penguin-web test:e2e          # build + start the server + run the tests
SKIP_BUILD=1 pnpm --filter @prismshadow/penguin-web test:e2e   # skip the build
```

PR CI runs `smoke.spec.mjs`, three browser scenarios against the real HTTP server and core:
sign-in and its cookie across reload; a pending approval that must not write until allowed;
and completed history plus a working follow-up after reload. The last scenario covers the
post-reload send regression from #89. Only the LLM boundary is replaced by the shared mock.
Beside it CI runs `sticky-rows.spec.mjs`: a work group's head and an open tool row stay pinned
at the top of the transcript while the output scrolls under them, with and without a custom
background.

PR CI also runs `project-switch.spec.mjs`: two Projects with distinct Agents, switched while
their lists are still loading — one late Agent list forced with a route delay, and a slow-machine
run with the renderer CPU throttled and every API answer delayed from a fixed seed. It fails on
anything of one Project shown under the other, on any request that pairs a Project with an Agent
it does not have, and on any `agent_not_found` answer.

PR CI also runs `dock.spec.mjs` and `terminal.spec.mjs`, the only browser tests that run a real
shell through the server: each conversation keeps its own dock tabs (nothing of one shows in
another), a new shell starts in the conversation's Workspace, a failed shell create surfaces as
a toast and a later attempt recovers, and a shell keeps its screen across a reload.

```sh
pnpm --filter @prismshadow/penguin-web test:e2e smoke.spec.mjs project-switch.spec.mjs sticky-rows.spec.mjs dock.spec.mjs terminal.spec.mjs
SKIP_BUILD=1 pnpm --filter @prismshadow/penguin-web test:e2e smoke.spec.mjs project-switch.spec.mjs sticky-rows.spec.mjs dock.spec.mjs terminal.spec.mjs
```

Arguments are forwarded to Playwright, so a spec path or `--grep` selects a focused run.
With no arguments the runner executes every browser spec. `SKIP_BUILD=1` requires a current
server/web build and their workspace dependencies; the default runner builds them in dependency
order. It uses a temporary data root and stops its server and mock on exit.

The first run requires `pnpm --filter @prismshadow/penguin-web exec playwright install chromium`
(add `--with-deps` on Linux CI). No provider credentials or external LLM service are needed.
Failed tests retain a trace and screenshot under `packages/web/test-results/`. Server and mock
logs are written to `packages/web/e2e-logs/` (override with `E2E_LOG_DIR`) and their tails are
printed if startup or tests fail.

The runner (`run.sh`) is POSIX-only and deliberately stays that way: `pnpm test` never
invokes it (only the separate `test:e2e` script does), so a Windows checkout builds and
tests fine without it. To run the browser e2e on Windows, use Git-Bash
(`bash e2e/run.sh` from `packages/web`).
