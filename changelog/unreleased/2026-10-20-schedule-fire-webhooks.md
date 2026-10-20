# Fire schedules by hand, and trigger them from webhooks

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1261](https://github.com/Prism-Shadow/penguin-harness/pull/1261)

[中文版](2026-10-20-schedule-fire-webhooks.zh.md)

A scheduled task can now fire outside its slots: `POST .../schedules/:name/fire` runs it once, immediately, as an extra run that never consumes the schedule (a one-shot's real firing still happens), and answers the session it went to. Every firing — scheduled or manual — lands a row in the new `schedule_firings` table, so firing history is queryable. On top of that, a task can own a webhook trigger: an outside system POSTs a bearer URL to fire one run, with per-provider idempotency keys, HMAC-SHA256 sender proof, and a deliveries audit trail with replay.

## Manual firing

- `POST /api/projects/:projectId/agents/:agentId/schedules/:name/fire` is owner-only, like every other schedule write. It answers `{ sessionId, queued }`: `queued` when the bound session is busy (the firing waits and is sent once it turns idle).
- Unknown names 404 with `schedule_not_found`; invalid files and lost sessions 400 with `schedule_invalid` / `schedule_session_missing` (a lost session marks the task invalid, like a scheduled fire hitting it).
- A manual firing advances only the last-fired time; `schedule_firings` records it with `manual = 1`.

## Webhook triggers

- One trigger per task at most, managed owner-only under `schedules/:name/webhook` (create/read/update/rotate/delete); reads are member-level. Creation and rotation return the bearer token once — reads redact it to a last-4 hint, since the ingress path embeds it.
- The public ingress is `POST /api/webhooks/schedules/:token` (no auth; the token is the credential). Two header conventions: `generic` (`Idempotency-Key`) and `github` (`X-GitHub-Delivery` + `X-Hub-Signature-256`). A configured secret is always enforced with a timing-safe compare; failures persist a `rejected` delivery and answer 401.
- A repeated idempotency key answers from the original delivery (`duplicate` with its delivery and run ids) without firing again. Disabled, settled or invalid tasks answer `ignored` without firing; unknown tokens 404, unparsable bodies 400, payloads past 256 KiB 413.
- `GET .../webhook/deliveries` lists the audit trail; `POST .../deliveries/:id/replay` deliberately fires the payload again as a new, keyless delivery row that points at its source.
- A failed session creation 500s and leaves the delivery `queued`, so the provider's retry still has a chance. An in-memory per-IP sliding window (60/min) 429s floods.
