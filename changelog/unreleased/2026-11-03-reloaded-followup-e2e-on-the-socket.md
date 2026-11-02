# The reloaded follow-up e2e reads the API socket

- **Date:** 2026-11-03
- **Type:** process
- **Scope:** `web`
- **PR:** [#1422](https://github.com/Prism-Shadow/penguin-harness/pull/1422)

[中文版](2026-11-03-reloaded-followup-e2e-on-the-socket.zh.md)

`reloaded-followup.spec.mjs` passes again. Since API calls moved onto the page's socket, the spec had been timing out on its first step. It waited with `page.waitForResponse` for an HTTP answer to `POST /tasks`, and staged the steer race with `page.route`, but neither one sees socket frames. The spec is not in CI's e2e list, so nothing caught it.

## Details

- The socket watcher `project-switch.spec.mjs` already used now lives in `e2e/api-socket.mjs`, shared by both specs. It gained `answer(method, path, { status, body })`, which answers a call in the server's place.
- The spec stages the steer's `409 not_running` through that watcher, and it checks the fallback's call frame (`queueIfBusy`, the whole draft) and its answer (`202`, `queued: true`).
- The thinking-level block is gone. It asserted that a queued follow-up carries the level picked mid-run, but since the level moved onto the Session ([#539](https://github.com/Prism-Shadow/penguin-harness/pull/539)) a follow-up carries none. The switch dialog is covered by `test/thinking-level.test.ts`.
