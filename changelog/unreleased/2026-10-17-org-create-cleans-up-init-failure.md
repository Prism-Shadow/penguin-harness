# Organization creation cleans up when the initialization dispatch fails

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1179](https://github.com/Prism-Shadow/penguin-harness/pull/1179)
- **Issue:** [#734](https://github.com/Prism-Shadow/penguin-harness/issues/734)

[中文版](2026-10-17-org-create-cleans-up-init-failure.zh.md)

Organization creation no longer leaves a half-made company behind when the CEO's initialization dispatch fails: the dispatch now runs inside the same locked, cleaned-up window as the rest of the writes, and a failure there removes the directory **and** the CEO Agent, so the organization id is reusable right away. A dispatch that came back as skipped — the desk could not open, or the run could not start — still stands the organization up, and the create response now carries `ceoInitSkipped` so the caller can tell; the reasons stay in the errors log under `org_desk_unavailable` / `org_dispatch_failed`.

## Details

- The agents gateway grew a `remove` operation, backed by `AgentService.deleteAgent`, which the cleanup path calls; a failing removal is recorded as `org_cleanup_failed` rather than masking the error that caused the cleanup.
