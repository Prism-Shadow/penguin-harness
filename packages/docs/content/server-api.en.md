---
title: Server API
description: HTTP API reference — authentication, routes, the SSE streaming protocol, and DTO type imports.
---

The PenguinHarness server exposes a same-origin HTTP API used by the bundled Web App and by any other HTTP client. This page is the reference: authentication, route tables, and the SSE streaming protocol. For starting the server, see the [Quickstart](/quickstart).

## Overview

- Stack: Hono + @hono/node-server, requires Node >= 24;
- Storage: SQLite (built-in `node:sqlite`, WAL mode) holds only indexes and aggregates — users, auth sessions, Project authorization, Agent / Session indexes, usage, UI preferences, error records, and Schedule state; all Agent, Trace, and Workspace data stays as files under `~/.penguin/data`, shared with the CLI / SDK — see the [Configuration Reference](/configuration);
- Binding: defaults to `127.0.0.1:7364`, adjustable via the `PORT` / `HOST` environment variables;
- Request bodies: writes accept JSON only (Content-Type check, one of the CSRF defenses), capped at 20MB — counted as the body is read, so a request that declares no length (chunked) is capped just the same;
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
- No open registration: the built-in admin `admin` is seeded at startup with a random initial password (of the form `penguin-1234`) — kept in `<root>/initial-admin-password` and re-printed to the server console on every start until it is changed; `PENGUIN_SEED_ADMIN_PASSWORD` pins it for automation — and all other accounts are created by an admin;
- Same-origin only — no CORS middleware is enabled.

```bash
# Use the initial password printed at first start (or your changed one).
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"userId":"admin","password":"penguin-1234"}' \
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

In desktop mode (the server spawned by the desktop app) the whole surface answers `403` with code `desktop_single_user`: the desktop app is single-user, so user management is disabled — existing users in the data root are untouched.

### Server Settings (admin only)

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/admin/settings | Server-global settings: `{settings: {proxyForApp, proxyForAgent, proxyUrl}}` |
| PUT | /api/admin/settings | Update settings (fields optional; omitted fields keep their current value), returns the full updated settings |

The proxy settings are two independent switches sharing one optional explicit address; changes take effect for newly initiated connections/spawns immediately — no restart:

- `proxyForApp` ("application uses the proxy", default on) governs the server's own outbound traffic (LLM requests, the update check, image fetches): on with `proxyUrl` set → that address for both http and https, **taking precedence over the proxy environment variables** — no environment variable needs to be configured; on without an address → the environment variables HTTP_PROXY / HTTPS_PROXY / NO_PROXY (both spellings); off → always direct.
- `proxyForAgent` ("agent environment uses the proxy", default on) governs agent command subprocess environments: on with `proxyUrl` set → `HTTP_PROXY` / `HTTPS_PROXY` (plus lowercase twins) are injected as that address together with the merged NO_PROXY, overriding inherited values (a `socks5://` address is injected verbatim — tools vary in accepting SOCKS URLs in these variables); on without an address → the host environment passes through unchanged; off → the proxy variables are stripped (NO_PROXY is kept).
- `proxyUrl` (default null = follow the environment variables) is the shared explicit address. Validation on PUT: the value is trimmed; empty or null clears the address; accepted are the proxy URLs undici's dispatcher takes — `http://`, `https://` and (experimental in undici) `socks5://` / `socks://` addresses, credentials allowed — plus bare `host[:port]` (normalized to `http://host[:port]`); only normalized values are stored, and the response echoes the stored form. Anything else — unparseable, or a scheme undici refuses, such as `socks4://` — is `400` with code `invalid_proxy_url`, and the rejected PUT writes nothing.

In every on-state the effective NO_PROXY always includes `localhost,127.0.0.1,::1` (loopback is never proxied).

### Version and Self-Update

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/version | Running release identity: `{version, buildDate}` (`buildDate` is the running version's release date, stamped at build time — no network; null in a dev/source build or a release that predates the stamping) |
| GET | /api/version/update-check | Compares the newest GitHub release with the running version: `{currentVersion, latestVersion, updateAvailable, releaseUrl, publishedAt, checkedAt, disabled?, error?}`; `?force=1` (the manual "check for updates" action) bypasses the TTL cache, and the outcome is cached as usual |
| POST | /api/version/update | **Admin only.** Runs the CLI self-update (`penguin update --yes`) on the server host: `{status, output, needsRestart}` |

`update-check` is the server's only outbound internet call and is strictly fail-soft: a failed lookup still returns 200 with `error` set (`network` / `rate_limited` / `bad_response`) and `latestVersion: null`, results are cached in memory (success 1 h, failure 10 min), and setting `PENGUIN_UPDATE_CHECK=off` disables the lookup entirely (`disabled: true`, no network call). The update `status` is `updated` (restart the service to run the new version), `failed`, or `unsupported` — the latter both when the server was not started via `penguin server|web` (`reason: "not_launched_via_cli"`) and when the CLI refuses (source checkout, unrecognized install layout, Windows); `output` carries the tail of the CLI's own output.

### Projects and Members

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/projects | Projects visible to the current user |
| POST | /api/projects | Create a Project |
| DELETE | /api/projects/:projectId | Delete a Project |
| GET | /api/projects/:projectId/members | List members |
| POST | /api/projects/:projectId/members | Add a member: `{userId}` |
| DELETE | /api/projects/:projectId/members/:userId | Remove a member |

Member writes are owner-only. The member routes also answer `403 desktop_single_user` in desktop mode (see User Administration above).

### Models

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/projects/:projectId/models | List models (api_key masked) |
| PUT | /api/projects/:projectId/models | Full-table replace, keyed by `(provider, modelId)` |
| POST | /api/projects/:projectId/models/test | Connectivity test: `{provider, modelId, …}` → `{ok, latencyMs?, message?}` |

Every endpoint that names a model takes the complete `(provider, modelId)` pair. Nothing is inferred: a request carrying only one half is a 400, never a lookup. Where the reference itself is optional (Session creation, Schedules), omitting both halves selects the Project's default model.

`PUT /models` also invalidates the Project's cached Session runtimes (same effective-value semantics as a vault update): no hot swap into a run already in flight, but the next Task on any Session of the Project re-resumes and reads the new `api_key` / `base_url`. It additionally publishes a `credentials_updated` event to the Project's open Session channels (see Streaming below), and the models response carries `updatedAt` (the config file's mtime) — the Web App compares it against the last auth failure to decide whether an auth-dead composer should stay disabled.

### Agents

The paths below omit the `/api/projects/:projectId` prefix.

| Method | Path | Description |
| --- | --- | --- |
| GET / POST | /agents | List / create Agents |
| DELETE | /agents/:agentId | Delete an Agent |
| GET / PUT | /agents/:agentId/config | Read / write config (AGENTS.md + system_config.yaml; PUT preserves YAML comments) |
| GET / PUT | /agents/:agentId/vault | Vault environment variables (values masked; PUT is a full replace) |
| GET | /agents/:agentId/memory | Memory overview: the switch, whether the template carries `{{MEMORY}}`, and one entry per scope — the user scope (`user`, `kind: "user"`) first, then the Workspaces |
| POST | /agents/:agentId/memory/template-placeholder | Insert the `{{MEMORY}}` placeholder into the prompt template (idempotent; the explicit adoption path for an Agent created before Memory) |
| GET | /agents/:agentId/memory/scopes/:key/files | List one scope's topic files (frontmatter + stats); `:key` is a workspace key or `user` |
| GET / DELETE | /agents/:agentId/memory/scopes/:key/files/:name | Read one topic file / delete it (also pruning its `MEMORY.md` index lines) |
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

On Session creation, `modelId` and `provider` are both-or-neither: send the complete pair to pick a model, or omit both to take the Project's default model — one without the other is a 400. The Workspace defaults to an auto-created temporary workspace, and the approval mode defaults to `allow-all`.

### Usage and Traces (Agent Level)

| Method | Path | Description |
| --- | --- | --- |
| GET | /usage | Usage statistics; query parameters `from`, `to`, `groupBy`, `agentId`, `provider`, `modelId` |
| GET | /usage/errors | One page of the error detail table (newest first): `offset`, `limit`, plus the same `from` / `to` / `agentId` filter → `{items, total}` |
| GET | /agents/:agentId/traces | Date → Session drill-down structure of Trace files |
| GET | /agents/:agentId/traces/:sessionId/:index | Read Trace events (`offset` / `limit` pagination) |
| GET | /agents/:agentId/traces/:sessionId/:index/analysis | Trace performance analysis |
| GET | /agents/:agentId/traces/:sessionId/:index/download | Download the raw Trace file (JSONL attachment) |
| POST | /agents/:agentId/traces/import | Import a Trace file: `{dataBase64}` → `{sessionId, index, date}` |

Trace download is available to any member; import is owner-only (like the Agent snapshot import, capped at 14MB). An imported file must be valid Trace JSONL whose first record is a `session_meta` with a filename-safe `session_id`; a session id the Agent already has is rejected (409 `trace_session_exists`), so an imported file always becomes index 001 of a new Session, landing in the local date directory of its first record's timestamp.

### Session-Level Endpoints

The paths below omit the `/api/sessions/:sessionId` prefix. For the storage model behind Sessions and Traces, see [Sessions and Traces](/sessions-and-traces).

| Method | Path | Description |
| --- | --- | --- |
| GET | / | Session info (the single-session GET additionally carries `tracePath`, the absolute path of the latest Trace file; list rows omit it) |
| PATCH | / | Update: `{approvalMode?, archived?, title?}` |
| DELETE | / | Delete the Session (along with its Traces and scratch files) |
| GET | /messages | Full OmniMessage history; while a Task runs the response also carries `live` (the in-progress stream tail, see below) |
| GET | /stream | SSE event stream (next section) |
| POST | /tasks | Start a Task: `{input: TaskInputPart[], thinkingLevel?, queueIfBusy?}` → 202. With `queueIfBusy`, a busy session holds the input as a follow-up (`queued: true`) and auto-starts it as an ordinary next task once idle; `task_state` events report the queued count. `file` input parts are written to the Session scratchpad and handed to the model as `[attached file: <path>]` lines (see the request body below). With `goal: {budget?}` the input starts a goal loop instead: it must carry non-empty text (an image alone states no objective), any images it carries fold into the objective as scratchpad path lines whatever the model's vision, and `file` parts are refused — nothing folds them into a re-injected objective — see [Goal mode](/docs/goal-mode) |
| POST | /steer | Mid-run steering: `{text, images?}` queues a message for the running Task (delivered between turns as a standalone `[user_steering]` user message, with its images right behind it) → 202; either field can carry the message on its own, but a request with neither is a 400; 409 `not_running` when no Task is in progress |
| POST | /approvals/:toolCallId | Approval decision: `{decision}` is `allow` or `deny` → 204 |
| POST | /abort | Interrupt the current Task: 202 when triggered, 204 when idle |
| POST | /subagents/:childSessionId/messages | Send `{text}` to a retained child: steer its running round or start a follow-up round in the same child Session when idle → 202 `{delivery: "steered" | "started"}` |
| POST | /subagents/:childSessionId/abort | Interrupt only the child's current round without disposing its Session/context: 202 when triggered, 204 when already idle |
| POST | /retry-now | "Retry now" on the reconnect countdown: skips the in-progress backoff wait, firing the next retry immediately (attempt counter unchanged) → 200 `{skipped}` — `skipped:false` is the benign "no wait in progress" case, never an error |
| POST | /compact | Trigger context compaction: 202; 409 `nothing_to_compact` when there is nothing to compact |
| GET | /files?path= | Browse the Workspace directory |
| GET | /files/content?path=&download=&preview= | Read a Workspace file (`download=1` serves it as an attachment, `preview=1` renders it in a sandbox — see below) |
| GET | /files/preview-redirect?path= | "Open in a new tab" for html: mints a signed token and 302s to the separate preview origin |
| POST | /files/stat | Batch existence check: `{paths}` |
| PUT | /files/content?path= | Upload a file: `{dataBase64}`, capped at 14MB |
| GET | /traces | List this Session's Trace files |
| GET | /traces/:index | Read Trace events (paginated) |
| GET | /traces/:index/analysis | Trace performance analysis |
| GET | /scratchpad/:fileName | Read a session scratch file (e.g. input images, file attachments) |

General conventions: Sessions the user cannot access always return 404 — their existence is never leaked; only one Task or compaction runs per Session at a time, and conflicts return 409 (`task_in_progress` / `compacting`).

#### The `live` field on GET /messages

The Trace stores only complete messages (streaming `partial_*` never reaches disk), so history alone cannot show a message that is still streaming. While the Session is running or compacting, the messages response therefore also carries the in-progress stream tail:

```ts
interface MessagesResponse {
  messages: OmniMessage[];
  live?: {
    // The Session channel's most recently assigned SSE event id (`<epoch>-<seq>`):
    // every event published up to and including this id is already reflected in `fragments`.
    cursor: string;
    // One synthetic `partial_* start` OmniMessage per open streaming fragment, whose
    // payload carries the full accumulated content so far (text/thinking prefix,
    // tool-call name + accumulated arguments, tool-output prefix + images), with the
    // original `origin` chain preserved (subagent fragments included).
    fragments: OmniMessage[];
  };
}
```

`cursor` and `fragments` are captured atomically before the trace read starts. A client using the connect-first pattern (below) applies them after history: when the cursor's epoch matches the epoch of the SSE events it has buffered, it drops every buffered **partial** event with seq ≤ cursor (their content is already accumulated inside `fragments`), feeds `fragments` through its normal reducer, then replays the rest of the buffer. Buffered **complete** messages are never dropped by the cursor — the regular overlap dedup decides for them. `live` is omitted only when both the parent and all retained children are idle, so refreshing after the parent Task has returned does not lose an active background child's open fragment.

Workspace files may be Agent-generated, so `GET /files/content` treats them as untrusted: every response carries `X-Content-Type-Options: nosniff`, and the rest of the headers depend on the two flags (`download=1` wins over `preview=1`):

| Query | Content-Type | Content-Disposition | Content-Security-Policy |
| --- | --- | --- | --- |
| neither | `text/plain; charset=utf-8` for `.html` / `.htm` / `.svg`, the real type otherwise | `inline` | — |
| `preview=1` | the real type (`text/html`, `image/svg+xml`, …) | `inline` | `sandbox allow-scripts allow-popups allow-modals allow-forms`, sent only for `.html` / `.htm` / `.svg` |
| `download=1` | the real type | `attachment` | — |

`GET /scratchpad/:fileName` serves the same kind of untrusted bytes (uploads and Agent-written temp files) and is locked down the same way, without the flags: `nosniff` always, a fixed allowlist of five inert image types (`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`) served inline for the conversation's `<img>` tags, and everything else `application/octet-stream` with `Content-Disposition: attachment` — so nothing that isn't one of those images can render as a document on the App's origin.

The filename always rides along as `filename*=UTF-8''` with percent-encoding. `preview=1` is where the preview redirect falls back when no separate preview origin is available: the document keeps its real type and does render and run, but the sandbox deliberately omits `allow-same-origin`, so it lands in an opaque origin and can reach neither this origin's cookies nor the API. That isolation is also why `localStorage`, `document.cookie` and third-party embeds do not work there.

### Preview on a separate origin

Both the Files panel's rendered HTML view (an iframe) and "open in a new tab" go through `GET /files/preview-redirect?path=`, which authenticates the caller, then mints a short-lived HMAC token and 302s to a **different origin**:

```text
GET  /api/sessions/:sessionId/files/preview-redirect?path=index.html
302  Location: http://localhost:7364/preview/<token>/index.html
GET  /preview/<token>/<relative path>          (unauthenticated; the token is the credential)
```

- **Why a separate origin.** The page needs a real origin to have working storage, cookies and third-party embeds — but it must not be the app's origin, or Agent-written HTML would run with the session cookie. Locally the app is canonicalized onto `localhost` and previews are served from `127.0.0.1`; cookies are keyed by host and ignore port, so those are separate cookie jars while a second port would not be. Otherwise `PENGUIN_PREVIEW_ORIGIN` applies; with neither (a wildcard or non-loopback bind, or the variable unset), the redirect falls back to the same-origin sandbox above and `previewIsolated` on `GET /api/me` reports `false` so the UI can say so first.
- **In-app rendering rides the same URL.** The Files panel embeds the redirect URL in an iframe sandboxed with `allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads` — `allow-same-origin` grants the preview origin's identity, not the App's, so this stays strictly tighter than the sandbox-free new tab. Without a separate preview origin the panel instead falls back to inline `srcdoc` rendering (`allow-scripts` only, plus an in-memory storage shim), where relative subresources cannot load. Note that some browsers partition or block storage inside a cross-site iframe, so a page may behave slightly differently in the panel than in the top-level tab.
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
  // Thinking level for this Task (a per-turn parameter, one of the five names; 400 otherwise);
  // omitted = falls back to the Agent config
  thinkingLevel?: "none" | "low" | "medium" | "high" | "xhigh";
}
type TaskInputPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string }    // pasted images arrive as data URLs
  // File attachment: base64 data: URL, ≤10MB each (413 file_too_large beyond that), at most 20
  // per request and 12MB of decoded bytes in total (413 too_many_files / payload_too_large;
  // all three are checked before anything is written). The server writes it into the Session
  // scratchpad and appends an `[attached file: <path>]` line to the message text — the model
  // opens the file by path. `fileName` carries no path separators; on disk it keeps its own
  // words (`报告 2026.pdf` → `报告-2026.pdf`: non-ASCII survives, shell-hostile ASCII becomes
  // `-`), so a name is readable in the message and safe to paste into a command.
  | { type: "file"; fileName: string; dataUrl: string };

// POST /api/sessions/:sessionId/approvals/:toolCallId
interface ApprovalDecisionRequest {
  decision: "allow" | "deny";
}
```

The Web's `/model` switch has no dedicated endpoint: like the `/agent` handoff, it composes the ordinary APIs above — session creation opens a new Session for the same Agent (the chosen model, the source Workspace carried over), then POST /tasks sends a first message opening with a `[model_switch_from]` source block (the source session id, its `tracePath`, the Workspace, and the previous model pair); the model reads that Trace file itself when it needs the earlier history.

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
  | { type: "subagent_state"; subagents: SessionSubagentInfo[] }
  | { type: "session_title"; sessionId: string; title: string }
  | { type: "resync_required" }
  | { type: "credentials_updated" }
  | { type: "hello" }
  | { type: "session_created"; projectId: string; agentId: string; sessionId: string; source: SessionSource }
  | { type: "schedule_fired"; projectId: string; agentId: string; name: string; sessionId: string }
  | { type: "schedule_queued"; projectId: string; agentId: string; name: string; sessionId: string };
```

| Event | Fired when |
| --- | --- |
| approval_request | A tool call escalated to human approval: every call under always-ask, plus rw / unknown-permission calls under read-only; pending approvals are resent on reconnect |
| task_state | The Session's run state flips (idle / running / compacting) |
| subagent_state | The authoritative lifecycle snapshot of retained child Sessions changes; also sent on subscribe so a resumed child never stays visually "done" |
| session_title | The model-generated title after the first turn has been persisted |
| resync_required | The Last-Event-ID was evicted from the buffer; the client must refetch history |
| credentials_updated | The Project's model credentials changed (`PUT /models`): cached runtimes were invalidated, so the client clears any auth-dead composer state |
| hello | Handshake on the user channel |
| session_created | A new Session was registered (e.g. a subagent session) |
| schedule_fired | A scheduled task fired and was delivered |
| schedule_queued | The target Session is running; this firing was queued |

### Delivery Guarantees

- Event ids are monotonic per channel, shaped `<epoch>-<seq>`;
- Each channel keeps a bounded replay buffer (most recent 10,000 events or 8MB);
- Reconnecting with `Last-Event-ID` replays the gap on a buffer hit; on a miss the server first sends `resync_required`, and the client refetches `/messages` before continuing;
- A heartbeat comment line is written every 20 seconds;
- Event order: on a reconnect carrying `Last-Event-ID`, **the replayed gap (or `resync_required`) arrives first**, then the initial events — the authoritative `task_state` and `subagent_state` snapshots followed by still-pending approval_requests — then the live stream. A fresh connection (no `Last-Event-ID`) skips replay, so its first two events are the `task_state` and `subagent_state` snapshots.

### Recommended Client Pattern

The order the bundled Web App uses:

1. Connect `/stream` first and buffer incoming events;
2. GET `/messages` for the full history;
3. If the response carries `live` (a Task is running), drop the buffered partials the cursor already covers and seed the `live.fragments` on top of history — the in-progress message reappears with its streamed prefix intact;
4. Replay the buffer, deduplicating the overlap;
5. Go live.

## Type Imports

All DTO types are importable type-only from the server package's `@prismshadow/penguin-server/api` subpath:

```ts
import type { ServerEvent, SessionInfo } from "@prismshadow/penguin-server/api";
```
