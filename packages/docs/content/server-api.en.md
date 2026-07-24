---
title: Server API
description: HTTP API reference — authentication, routes, the SSE streaming protocol, and DTO type imports.
---

The PenguinHarness server exposes a same-origin HTTP API used by the bundled Web App and by any other HTTP client. This page is the reference: authentication, route tables, and the SSE streaming protocol. For starting the server, see the [Quickstart](/quickstart).

## Overview

- Stack: Hono + @hono/node-server, requires Node >= 24;
- Storage: SQLite (built-in `node:sqlite`, WAL mode) holds only indexes and aggregates — users, auth sessions, Project authorization, Agent / Session indexes, usage, UI preferences, error records, and Schedule state; all Agent, Trace, and Workspace data stays as files under `~/.penguin/data`, shared with the CLI / SDK — see the [Configuration Reference](/configuration);
- Binding: defaults to `127.0.0.1:7364`, adjustable via the `PORT` / `HOST` environment variables;
- Request bodies: writes accept JSON only (Content-Type check, one of the CSRF defenses), capped at 20MB;
- Errors share a single shape:

```text
{ "error": { "code": "<machine-readable code>", "message": "<user-facing text>" } }
```

## Source layout

```text
packages/server/src
├── index.ts / config.ts / app.ts   # startup entry · env config · Hono assembly (createApp binds no port — testable)
├── api/types.ts                    # the outward DTO contract (type-only import via the "./api" subpath)
├── auth/                           # scrypt passwords, admin seeding, cookie sessions, auth middleware
├── db/                             # node:sqlite connection, schema SQL, one repo per table
├── http/                           # error bodies, request validation, SSE adapter, routes/ all route groups
├── runtime/                        # session-manager (runtime driving) · channel (SSE ring buffer)
│                                   # approvals · usage-recorder · scheduler · title-generator
└── services/                       # authorization rules, TOML/YAML config IO, Session/Trace/usage/snapshot services
```

## Authentication

- Cookie session: `penguin_session` (HttpOnly, SameSite=Lax), valid for 7 days with sliding renewal;
- Passwords are stored as scrypt hashes; the server keeps only the sha256 of the session token, never the plaintext;
- No open registration: the built-in admin `admin` / `penguin-2026` is seeded at startup, and all other accounts are created by an admin;
- Same-origin only — no CORS middleware is enabled.

```bash
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"userId":"admin","password":"penguin-2026"}' \
  http://127.0.0.1:7364/api/auth/login
```

## Route Reference

### Auth and Account

| Method | Path | Description |
| --- | --- | --- |
| POST | /api/auth/login | Log in: `{userId, password}` → `{user}` |
| POST | /api/auth/logout | Log out, returns 204 |
| GET | /api/me | Current user info |
| PUT | /api/me/password | Change password: `{oldPassword, newPassword}` |
| GET | /api/me/prefs | Read UI preferences |
| PUT | /api/me/prefs | Write UI preferences (shallow merge) |

### User Administration (admin only)

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/admin/users | List users |
| POST | /api/admin/users | Create a user: `{userId, password}` |
| POST | /api/admin/users/:userId/password | Reset a password (invalidates all of that user's login sessions) |
| DELETE | /api/admin/users/:userId | Delete a user |

### Projects and Members

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/projects | Projects visible to the current user |
| POST | /api/projects | Create a Project |
| DELETE | /api/projects/:projectId | Delete a Project |
| GET | /api/projects/:projectId/members | List members |
| POST | /api/projects/:projectId/members | Add a member: `{userId}` |
| DELETE | /api/projects/:projectId/members/:userId | Remove a member |

Member writes are owner-only.

### Models

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/projects/:projectId/models | List models (api_key masked) |
| PUT | /api/projects/:projectId/models | Full-table replace, keyed by `(provider, modelId)` |
| POST | /api/projects/:projectId/models/test | Connectivity test: `{provider, modelId, …}` → `{ok, latencyMs?, message?}` |

Every endpoint that names a model takes the complete `(provider, modelId)` pair. Nothing is inferred: a request carrying only one half is a 400, never a lookup. Where the reference itself is optional (Session creation, Schedules), omitting both halves selects the Project's default model.

### Agents

The paths below omit the `/api/projects/:projectId` prefix.

| Method | Path | Description |
| --- | --- | --- |
| GET / POST | /agents | List / create Agents |
| DELETE | /agents/:agentId | Delete an Agent |
| GET / PUT | /agents/:agentId/config | Read / write config (AGENTS.md + system_config.yaml; PUT preserves YAML comments) |
| GET / PUT | /agents/:agentId/vault | Vault environment variables (values masked; PUT is a full replace) |
| GET | /agents/:agentId/export | Export the Agent State snapshot (tar.gz download) |
| POST | /agents/:agentId/import | Import a snapshot: `{dataBase64, confirm?}`; 409 on version conflict without confirm |
| GET / POST | /agents/:agentId/skills | List / install installed Skills |
| DELETE | /agents/:agentId/skills/:name | Uninstall a Skill |
| GET | /agents/:agentId/benchmarks | Benchmark scoring data (read-only) |

### Schedules

| Method | Path | Description |
| --- | --- | --- |
| GET / POST | /agents/:agentId/schedules | List scheduled tasks / create one (409 if the name exists) |
| GET / PUT / DELETE | /agents/:agentId/schedules/:name | Read / update / delete a single task |

Schedule writes are owner-only. A task in new-Session mode carries `modelId` and `provider` together or not at all; the pair is checked against the Project's model table when the task is saved and again when the scheduler reconciles it.

### Session Creation and Directory Browsing

| Method | Path | Description |
| --- | --- | --- |
| GET | /agents/:agentId/sessions | List Sessions (including run state) |
| POST | /agents/:agentId/sessions | Create a Session: `{modelId?, provider?, workspace?, approvalMode?}` → 201 |
| GET | /dirs?path= | Server-side directory browser (backs the Workspace picker) |

On Session creation, `modelId` and `provider` are both-or-neither: send the complete pair to pick a model, or omit both to take the Project's default model — one without the other is a 400. The Workspace defaults to an auto-created temporary directory, and the approval mode defaults to `allow-all`.

### Usage and Traces (Agent Level)

| Method | Path | Description |
| --- | --- | --- |
| GET | /usage | Usage statistics; query parameters `from`, `to`, `groupBy`, `agentId`, `provider`, `modelId` |
| GET | /agents/:agentId/traces | Date → Session drill-down structure of Trace files |
| GET | /agents/:agentId/traces/:sessionId/:index | Read Trace events (`offset` / `limit` pagination) |
| GET | /agents/:agentId/traces/:sessionId/:index/analysis | Trace performance analysis |

### Session-Level Endpoints

The paths below omit the `/api/sessions/:sessionId` prefix. For the storage model behind Sessions and Traces, see [Sessions and Traces](/sessions-and-traces).

| Method | Path | Description |
| --- | --- | --- |
| GET | / | Session info |
| PATCH | / | Update: `{approvalMode?, archived?, title?}` |
| DELETE | / | Delete the Session (along with its Traces and scratch files) |
| GET | /messages | Full OmniMessage history |
| GET | /stream | SSE event stream (next section) |
| POST | /tasks | Start a Task: `{input: TaskInputPart[]}` → 202 |
| POST | /steer | Mid-run steering: `{text}` queues a message for the running Task (delivered inside the next completed tool output as a `[user_steering]` block) → 202; 409 `not_running` when no Task is in progress |
| POST | /approvals/:toolCallId | Approval decision: `{decision}` is `allow` or `deny` → 204 |
| POST | /abort | Interrupt the current Task: 202 when triggered, 204 when idle |
| POST | /compact | Trigger context compaction: 202; 409 `nothing_to_compact` when there is nothing to compact |
| GET | /files?path= | Browse the Workspace directory |
| GET | /files/content?path=&download=&preview= | Read a Workspace file (`download=1` serves it as an attachment, `preview=1` renders it in a sandbox — see below) |
| GET | /files/preview-redirect?path= | "Open in a new tab" for html: mints a signed token and 302s to the separate preview origin |
| POST | /files/stat | Batch existence check: `{paths}` |
| PUT | /files/content?path= | Upload a file: `{dataBase64}`, capped at 14MB |
| GET | /traces | List this Session's Trace files |
| GET | /traces/:index | Read Trace events (paginated) |
| GET | /traces/:index/analysis | Trace performance analysis |
| GET | /scratchpad/:fileName | Read a session scratch file (e.g. input images) |

General conventions: Sessions the user cannot access always return 404 — their existence is never leaked; only one Task or compaction runs per Session at a time, and conflicts return 409 (`task_in_progress` / `compacting`).

Workspace files may be Agent-generated, so `GET /files/content` treats them as untrusted: every response carries `X-Content-Type-Options: nosniff`, and the rest of the headers depend on the two flags (`download=1` wins over `preview=1`):

| Query | Content-Type | Content-Disposition | Content-Security-Policy |
| --- | --- | --- | --- |
| neither | `text/plain; charset=utf-8` for `.html` / `.htm` / `.svg`, the real type otherwise | `inline` | — |
| `preview=1` | the real type (`text/html`, `image/svg+xml`, …) | `inline` | `sandbox allow-scripts allow-popups allow-modals allow-forms`, sent only for `.html` / `.htm` / `.svg` |
| `download=1` | the real type | `attachment` | — |

The filename always rides along as `filename*=UTF-8''` with percent-encoding. `preview=1` renders inside the Files panel's sandboxed iframe, and is also the fallback for "open in a new tab" when no separate preview origin is available: the document keeps its real type and does render and run, but the sandbox deliberately omits `allow-same-origin`, so it lands in an opaque origin and can reach neither this origin's cookies nor the API. That isolation is also why `localStorage`, `document.cookie` and third-party embeds do not work there.

### Preview on a separate origin

"Open in a new tab" goes through `GET /files/preview-redirect?path=`, which authenticates the caller, then mints a short-lived HMAC token and 302s to a **different origin**:

```text
GET  /api/sessions/:sessionId/files/preview-redirect?path=index.html
302  Location: http://localhost:7364/preview/<token>/index.html
GET  /preview/<token>/<relative path>          (unauthenticated; the token is the credential)
```

- **Why a separate origin.** The page needs a real origin to have working storage, cookies and third-party embeds — but it must not be the app's origin, or Agent-written HTML would run with the session cookie. Locally the app is canonicalized onto `localhost` and previews are served from `127.0.0.1`; cookies are keyed by host and ignore port, so those are separate cookie jars while a second port would not be. Otherwise `PENGUIN_PREVIEW_ORIGIN` applies; with neither (a wildcard or non-loopback bind, or the variable unset), the redirect falls back to the same-origin sandbox above and `previewIsolated` on `GET /api/me` reports `false` so the UI can say so first.
- **The preview host serves only `/preview/*`.** It is the same process as the app, so it answers `/api` with `401` and `302`s every other route to the canonical app host. A session cookie is therefore never set or honored on the preview host, and Agent HTML there cannot reach the API same-origin. (For a deployed `PENGUIN_PREVIEW_ORIGIN`, the reverse proxy must enforce the equivalent: route only `/preview/*` to the app on that origin.)
- **Path-based, not a query parameter**, so a page's relative subresources (`app.js`, `style.css`, images) resolve against the document and load under the same token.
- **The token binds the Session, the preview host and an expiry.** The host binding is load-bearing: the same process also answers on the app origin, so `/preview/...` refuses to serve there — otherwise it would be a same-origin XSS. Access is read-only and scoped to that Session's Workspace, and the path is re-resolved server-side, so `..` and symlink escapes are rejected as before.
- **Responses carry `Referrer-Policy: no-referrer`**, or the token-bearing URL would leak through `Referer` to every third party the page embeds — a risk that exists precisely because embeds now work.
- Bad token, expired token, wrong host and out-of-bounds path all answer a bare 404: the endpoint is unauthenticated and must not confirm what exists.

Key request bodies (explicit keys):

```ts
// POST /api/sessions/:sessionId/tasks — start a Task
interface TaskCreateRequest {
  input: TaskInputPart[];
}
type TaskInputPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string };   // pasted images arrive as data URLs

// POST /api/sessions/:sessionId/approvals/:toolCallId
interface ApprovalDecisionRequest {
  decision: "allow" | "deny";
}
```

## Streaming (SSE)

Real-time delivery uses Server-Sent Events, not WebSocket, on two channels (the ordering semantics of what the channels carry are on [Message Flow & Ordering](/message-flow)):

| Channel | Path | Contents |
| --- | --- | --- |
| Per Session | GET /api/sessions/:sessionId/stream | The Session's message stream and run events |
| Per user | GET /api/events | `hello` handshake and cross-Session notifications (schedule_fired / schedule_queued / session_created) |

### Wire Format

Default (unnamed) SSE events carry raw OmniMessage envelopes as single-line JSON — the same protocol the SDK yields and the Trace stores, see the [OmniMessage Protocol](/omni-message). Events named `server_event` carry the ServerEvent union:

```ts
export type ServerEvent =
  | { type: "approval_request"; toolCall: OmniMessage<ToolCallPayload>; origin?: string[] }
  | { type: "task_state"; state: "idle" | "running" | "compacting" }
  | { type: "session_title"; sessionId: string; title: string }
  | { type: "resync_required" }
  | { type: "hello" }
  | { type: "session_created"; projectId: string; agentId: string; sessionId: string; source: SessionSource }
  | { type: "schedule_fired"; projectId: string; agentId: string; name: string; sessionId: string }
  | { type: "schedule_queued"; projectId: string; agentId: string; name: string; sessionId: string };
```

| Event | Fired when |
| --- | --- |
| approval_request | A tool call escalated to human approval: every call under always-ask, plus rw / unknown-permission calls under read-only; pending approvals are resent on reconnect |
| task_state | The Session's run state flips (idle / running / compacting) |
| session_title | The model-generated title after the first turn has been persisted |
| resync_required | The Last-Event-ID was evicted from the buffer; the client must refetch history |
| hello | Handshake on the user channel |
| session_created | A new Session was registered (e.g. a subagent session) |
| schedule_fired | A scheduled task fired and was delivered |
| schedule_queued | The target Session is running; this firing was queued |

### Delivery Guarantees

- Event ids are monotonic per channel, shaped `<epoch>-<seq>`;
- Each channel keeps a bounded replay buffer (most recent 1000 events or 2MB);
- Reconnecting with `Last-Event-ID` replays the gap on a buffer hit; on a miss the server first sends `resync_required`, and the client refetches `/messages` before continuing;
- A heartbeat comment line is written every 20 seconds;
- Event order: on a reconnect carrying `Last-Event-ID`, **the replayed gap (or `resync_required`) arrives first**, then the initial events — the authoritative `task_state` snapshot and still-pending approval_requests — then the live stream. A fresh connection (no `Last-Event-ID`) skips replay, so its first event is the `task_state` snapshot.

### Recommended Client Pattern

The order the bundled Web App uses:

1. Connect `/stream` first and buffer incoming events;
2. GET `/messages` for the full history;
3. Replay the buffer, deduplicating the overlap;
4. Go live.

## Type Imports

All DTO types are importable type-only from the server package's `@prismshadow/penguin-server/api` subpath:

```ts
import type { ServerEvent, SessionInfo } from "@prismshadow/penguin-server/api";
```
