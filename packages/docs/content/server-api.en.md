---
title: Server API
description: HTTP API reference — authentication, routes, the SSE streaming protocol, and DTO type imports.
---

The PenguinHarness server exposes a same-origin HTTP API used by the bundled Web App and by any other HTTP client. This page is the reference: authentication, route tables, and the SSE streaming protocol. For starting the server, see the [Quickstart](/quickstart).

## Overview

- Stack: Hono + @hono/node-server, requires Node >= 24;
- Storage: SQLite (built-in `node:sqlite`, WAL mode) holds only indexes and aggregates — users, auth sessions, Project authorization, Agent / Session indexes, usage, UI preferences, error records, and Schedule state; all Agent, Trace, and Workspace data stays as files under `~/.penguin/data`, shared with the CLI / SDK — see the [Configuration Reference](/configuration);
- Binding: defaults to `127.0.0.1:7364`, adjustable via the `PORT` / `HOST` environment variables;
- Request bodies: writes accept JSON only (Content-Type check, one of the CSRF defenses), capped at a size **derived from the attachment budget** rather than fixed — attachments ride the request as base64 `data:` URLs (4/3 inflation), so the cap is `base64(attachmentTotalMb) + headroom for one inline image and the JSON framing`, about 190MB at the default 120MB total and falling again if an admin lowers it. It is counted as the body is read, so a request that declares no length (chunked) is capped just the same;
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

- Cookie session: `penguin_session` (HttpOnly, SameSite=Lax), valid for 30 days with sliding renewal;
- Passwords are stored as scrypt hashes. A session is a row in `auth_sessions` keyed by the sha256 of a random cookie token (the raw token is never stored); it survives a restart, renews in place, and logout deletes the row;
- No open registration: the built-in admin `admin` is seeded at startup with a random password that is hashed and discarded unseen. Until a password is actually set, every start prints a first-login link that claims the account (`PENGUIN_SEED_ADMIN_PASSWORD` pins a known password instead, for automation). All other accounts are created by an admin;
- Same-origin only — no CORS middleware is enabled.

```bash
# Use the password you set when claiming the account from the first-login link.
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"userId":"admin","password":"<your password>"}' \
  http://localhost:7364/api/auth/login
```

### Local API token (Bearer)

Every protected route also accepts `Authorization: Bearer <token>` carrying the **local API token** — the machine-local credential the CLI (and agents driving the harness through it) use instead of a login:

- The server mints a fresh token at every boot and writes it to `<root>/api-token` (owner-only permissions, `0600`); the previous boot's token stops working the moment a new one is minted.
- A valid Bearer authenticates as the built-in `admin`. That equivalence is the authorization model, not an accident: local filesystem access to the data root already **is** admin authority — whoever can read `api-token` can read `web.db` next to it, and it is the same rule `penguin server reset-admin-password` stands on.
- Server-driven sessions inject the current token into every tool subprocess as `PENGUIN_API_TOKEN` (together with `PENGUIN_API_URL`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID`, `PENGUIN_SESSION_ID`), which is how an agent's own `penguin` / API calls are sanctioned to reach the server that runs them.
- SSE endpoints accept the header like any other route (consume them with `fetch`, not `EventSource` — the latter cannot send headers).
- The JSON-only Content-Type check on writes still applies to Bearer requests.

```bash
curl -H "Authorization: Bearer $(cat ~/.penguin/data/api-token)" \
  http://127.0.0.1:7364/api/me
```

## Route Reference

### Auth and Account

| Method | Path | Description |
| --- | --- | --- |
| POST | /api/auth/login | Log in: `{userId, password}` → `{user}` |
| POST | /api/auth/logout | Log out, returns 204 |
| GET | /api/auth/claim?token=… | Redeem a sign-in link (first-login, or the desktop shell's one-shot token): sets the cookie, redirects to `/` |
| GET | /api/install | Public: `{installId}` — an opaque id identifying the data root being served (`<root>/install-id`), minted the first time the root is used. The Web App compares it against the one it stored and clears the browser-side UI state that references server entities when it differs, so replacing the data root no longer leaves the old Workspace, drafts and pins in place. `null` means the server could not establish one; clients must then change nothing. |
| GET | /api/me | Current user info |
| PUT | /api/me/password | Change password: `{oldPassword, newPassword}`; a desktop or first-login session may omit `oldPassword` — its current password is random and was never shown |
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
| GET | /api/admin/settings | Server-global settings: `{settings: {proxyForApp, proxyForAgent, proxyUrl, attachmentMaxMb, attachmentTotalMb}}` |
| PUT | /api/admin/settings | Update settings (fields optional; omitted fields keep their current value), returns the full updated settings |

The proxy settings are two independent switches sharing one optional explicit address; changes take effect for newly initiated connections/spawns immediately — no restart:

- `proxyForApp` ("application uses the proxy", default on) governs the server's own outbound traffic (LLM requests, the update check, image fetches): on with `proxyUrl` set → that address for both http and https, **taking precedence over the proxy environment variables** — no environment variable needs to be configured; on without an address → the environment variables HTTP_PROXY / HTTPS_PROXY / NO_PROXY (both spellings); off → always direct.
- `proxyForAgent` ("agent environment uses the proxy", default on) governs agent command subprocess environments: on with `proxyUrl` set → `HTTP_PROXY` / `HTTPS_PROXY` (plus lowercase twins) are injected as that address together with the merged NO_PROXY, overriding inherited values (a `socks5://` address is injected verbatim — tools vary in accepting SOCKS URLs in these variables); on without an address → the host environment passes through unchanged; off → the proxy variables are stripped (NO_PROXY is kept).
- `proxyUrl` (default null = follow the environment variables) is the shared explicit address. Validation on PUT: the value is trimmed; empty or null clears the address; accepted are the proxy URLs undici's dispatcher takes — `http://`, `https://` and (experimental in undici) `socks5://` / `socks://` addresses, credentials allowed — plus bare `host[:port]` (normalized to `http://host[:port]`); only normalized values are stored, and the response echoes the stored form. Anything else — unparseable, or a scheme undici refuses, such as `socks4://` — is `400` with code `invalid_proxy_url`, and the rejected PUT writes nothing.

The upload limits are two whole-MB integers governing composer file attachments; both apply to the next request with no restart (the validators and the body cap read them per request):

- `attachmentMaxMb` (default 100) is the per-file cap — a larger file is `413` `file_too_large`.
- `attachmentTotalMb` (default 120) is the per-message total of decoded bytes — `413` `payload_too_large` beyond it.
- Validation on PUT: each must be an integer between 1 and 200, and the **effective** total (the value in this PUT, or the stored one when this PUT does not change it) must not be below the effective per-file cap. Anything else is `400` with code `invalid_attachment_limit`, and the rejected PUT writes nothing.
- Not settable: the per-message file count (20) and the inline-image cap (20MB, `413` `image_too_large`). An inline image is written into the Trace and re-read on every history page and resume, so it deliberately does not follow the attachment cap up; `GET /api/me` reports all of these under `uploadLimits` so a client can pre-check a pick against the numbers actually in force.

In every on-state the effective NO_PROXY always includes `localhost,127.0.0.1,::1` (loopback is never proxied).

### Machines (admin only)

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/projects/:projectId/machines | This machine and the host aliases of the SERVER's own `~/.ssh/config` with what THIS PROJECT has installed on each, the last status probed for each, the version this server would install, and the running or last job: `{machines: [{id, alias, machineId, installed, elsewhere?, local, connection, api, status}], imageVersion, job}`. `elsewhere` is a host another Project installed — a machine to adopt rather than install |
| POST | /api/projects/:projectId/machines/probe | Ask this Project's installed machines what they are doing (one ssh round trip each, five at a time) and answer the list with the fresh statuses |
| POST | /api/projects/:projectId/machines/:machineId/install | Start installing this build on that host and give it to this Project; `202` with the same body, the job now running. Body `{replaceProgram: true}` answers a job that came back asking for it: install the program even though its version already matches, and restart it |
| POST | /api/projects/:projectId/machines/:machineId/connect | Bring that machine's server up and HOLD the one connection to it — an `ssh -T -D` session that never idles out, is re-established on its own if it drops, and is restored after a restart or a hot push; `202` with the same body, the connect job now running. A Windows machine is `409` `connect_unsupported`: there is no shell to hold a session on |
| POST | /api/projects/:projectId/machines/:machineId/disconnect | Drop the connection. The remote server is left running — it is that machine's own, and other people may be on it |
| POST | /api/projects/:projectId/machines/:machineId/restart | Stop that machine's server and start it again on the same port; `202`, or `409` while a job runs. Its own control because a machine's FILES can be brought forward while it runs, and only a restart makes the process match them |
| GET | /api/projects/:projectId/machines/:machineId/dirs?path= | The subdirectories of `path` on that machine, over the held connection — what the workspace picker browses. Addressed by the machine's OWN id, like the proxy. `404` when the machine is not connected: a read never opens ssh on its own |
| POST | /api/projects/:projectId/machines/:machineId/release | Drop that machine from this Project; the install on it stays |

Admin only on a personal server as much as a multi-user one: the install spawns ssh with the **server account's** keys and writes a program directory on another machine, which is an owner's capability rather than a visitor's. Nothing writes to the ssh config, and nothing resolves it: the list is the config's text (one file read, however many hosts it declares), and an alias is handed to ssh as written — what it means is ssh's to apply, from its own config, every time.

`imageVersion` is what would be pushed, or `null` when this server has no image at all (a development checkout that has never been hot-pushed to is the one such shape) — every install then refuses with `409` `no_install_image`. The version is the running install's own: a hot-pushed server sends the bundle it runs (`0.0.0-hmr.<cli>.<web>`), a tarball or packaged one sends its own tree, so the two ends match by construction.

`installed` is the last install THIS server carried out on that machine — `{version, at}`, or `null` when it never has. It is persisted under the data root, so it survives a restart, a hot push, and installing on some other machine; a record of what was done rather than a survey of the far side, so a machine wiped by hand still reads as installed until the next install corrects it. A failed install records nothing.

`machineId` is that machine's OWN id — 16 base64url characters minted by the server running there (its `machine` table), stable across renames, re-aliasing and reinstalls, and the thing stored references should point at. It is `null` until a server has started on that machine, since nothing has minted one yet; it is learned on the same round trip as `status` and remembered beside the install record. Two aliases for one host report the same `machineId`.

`local` marks the machine this server runs on. It is always listed, always installed, always running — it is the thing answering — and is never an install target: `POST …/install` on it is `409` `self_install`.

`status` is `{state, checkedAt, port?, detail?}` with `state` one of `running` / `stopped` / `unreachable`, or `null` when that machine has not been probed. There is no separate ssh status: ssh is the transport, so a machine it cannot reach is `unreachable` and carries OpenSSH's own message in `detail`. `GET` never probes — it reports the last answer — because a probe is an ssh round trip per machine while the list itself is only the config's text. `POST /api/machines/probe` is what spends them, and only on machines something was installed on.

A connected machine's API is reachable at `/server/<machineId>/api/…` on THIS origin, dialled through the one ssh session this server holds to it — a channel inside that session, via its SOCKS port, never a second connection. Addressed by the machine's own id rather than the ssh alias it was reached through: an alias lives in one config file, so keying on it would change a machine's URLs the moment someone renamed a host — and being base64url, an id needs no percent-encoding in a path. **Admin only**, and one identity: the request is made over there as that machine's admin, with a session this server mints through its own ssh access (`penguin auth token` on the machine) — the browser's cookies never cross, and the machine's never come back. Only `/api` is forwarded — the frontend stays local.

An install is a job, not a request: it probes the far side, may fetch and verify a Node runtime, and copies an image over scp — minutes in the bad case. `POST` starts it and returns at once; the client polls `GET` for `job.log`, which carries the far side's own words (ssh's diagnostics, the remote installer's output). A connect (`POST …/connect`) and a restart (`POST …/restart`) are jobs of the same shape, `job.kind` (`install` / `connect` / `restart`) telling them apart. `job.result` is `null` while running, then `{ok: true, installed: "installed" | "already-installed", version}` for an install, `{ok: true, connected: true}` for a connect or a restart, or `{ok: false, step, message, canReplaceProgram?}` — `canReplaceProgram` marks a failure whose next step is installing the program anyway (`POST …/install` with `{replaceProgram: true}`), offered rather than done because it restarts a server other people may be using. One job at a time; the job lives in memory and does not survive a hot push or a restart, and re-running is the recovery — every step is idempotent.

Refusals decided before any ssh runs have their own codes: `409` `install_running`, `404` `unknown_machine`, `409` `no_install_image`, and `409` `self_install` — this server will not push this build over the program directory it is running from. Besides the `local` row, that covers an alias pointing back home (`Host localhost`, a second name for this host) once a probe has heard this server's own id from it.

### Version and Self-Update

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/version | Identity of the running build plus this root's pushed harness: `{version, describe, channel, buildDate, commit, branch, dirty, runtime, harness}` — the same record `penguin version --json` prints. `harness` describes the data root's HMR store (`{source, pushedAt, bundles}`, where `source` is the pushing checkout's `{repo, revision}`) and is null when nothing was ever pushed there. `describe` is the one-line identity (`v0.2.3` for a release, `v0.2.3-14-g9e8f7d6-dirty` for a build from a checkout); `channel` is `release` or `source`; `buildDate` (UTC yyyy-mm-dd) and `commit` are stamped at build time, so no network is needed, and are null in a source build or a release predating the stamping; `branch` and `dirty` carry a source build's git position and are null for a release |
| GET | /api/version/update-check | Compares the newest GitHub release with the running version: `{currentVersion, latestVersion, updateAvailable, releaseUrl, publishedAt, checkedAt, disabled?, error?}`; `?force=1` (the manual "check for updates" action) bypasses the TTL cache, and the outcome is cached as usual |
| GET | /api/version/update | **Admin only.** The self-update job's status: `{state: idle \| running \| done, targetVersion, phase?, percent?, output, result?, startedAt?, finishedAt?}` — `phase` (`resolving` / `downloading` / `installing`) and `percent` (read off the installer's progress bar) while running; `result` (`{status, reason?, output, needsRestart}`) once done. Polled by the update dialog while a run is in flight |
| POST | /api/version/update | **Admin only.** Starts the self-update job — `penguin update --yes` on the server host, in the background — unless one is running (then it is joined); answers with the status exactly as GET does. A finished run may be started again (a retry) |
| POST | /api/version/restart | **Admin only.** Asks the process to exit with the supervisor's restart code after a graceful shutdown, so `penguin server \| penguin web` relaunches it on the installed release: `{restarting: true}`; `{restarting: false, reason: "no_supervisor"}` when nothing supervises the process |

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
| POST | /api/projects/:projectId/models/detect | Protocol auto-detection for a custom base URL: probes `openai-responses` → `ant-messages` → `openai-chat` in order and reports the first served protocol: `{baseUrl, apiKey?, …}` → `{detected?, probes}` |
| POST | /api/projects/:projectId/models/list | Endpoint model listing for the add-group import: the ids the endpoint serves on a detected protocol: `{baseUrl, clientType, apiKey?}` → `{ok, models?, unsupported?, message?}` |
| POST | /api/projects/:projectId/models/detect-vision | Vision capability probe: sends one 1x1 image on this model's credential (a real, billed completion): `{provider, modelId, apiKey?, baseUrl?, clientType?}` → `{outcome: supported\|unsupported\|failed, message?}` |

Every endpoint that names a model takes the complete `(provider, modelId)` pair. Nothing is inferred: a request carrying only one half is a 400, never a lookup. Where the reference itself is optional (Session creation, Schedules), omitting both halves selects the Project's default model.

`PUT /models` also invalidates the Project's cached Session runtimes (same effective-value semantics as a vault update): no hot swap into a run already in flight, but the next Task on any Session of the Project re-resumes and reads the new `api_key` / `base_url`. It additionally publishes a `credentials_updated` event to the Project's open Session channels (see Streaming below), and the models response carries `updatedAt` (the config file's mtime) — the Web App compares it against the last auth failure to decide whether an auth-dead composer should stay disabled.

#### Provider key minting

Owner-only, except the redirect receiver `GET /callback`, which answers without a session and can do nothing but hand the code it was redirected with to the flow — see below. A provider group that publishes an authorization flow in the built-in catalog can mint a **new** API key for the user in the browser, instead of the user copying one out of a console.

| Method | Path | Description |
| --- | --- | --- |
| POST | /api/projects/:projectId/model-oauth/start | Open a flow: `{provider, mode?: callback\|manual}` → `{flowId, authorizeUrl}` |
| GET | /api/projects/:projectId/model-oauth/callback | Where the provider redirects (`?flow=&code=`); deposits the code on the flow and answers an HTML page. `HEAD` answers 405 |
| GET | /api/projects/:projectId/model-oauth/:flowId | Poll a flow, redeeming a deposited code and applying the key: `{status: pending\|done\|error, provider, error?}` |
| POST | /api/projects/:projectId/model-oauth/:flowId/code | Redeem a code the user pasted: `{code}` → `{ok, applied?, error?}` |

The PKCE verifier is generated server-side, held in memory for ten minutes, and never sent to a client; the minted key goes straight into the provider group's models and is never returned, logged, or put in a URL. A flow belongs to one user in one Project and is single-use: a second redemption is refused, and `/start`, `/:flowId` and `/:flowId/code` refuse anyone but that owner.

`GET /callback` is the exception, and has to be. A loopback OAuth redirect is delivered by whichever browser the provider redirected, which is not necessarily the one that started the flow — the desktop shell opens the authorization page in the *system* browser, which holds no cookie for the app's origin. So that one path is mounted outside the session gate and authorizes on the flow id instead: 32 random bytes, valid for ten minutes, depositable once, and only against the Project the flow was opened in, and only for a flow that asked for a callback at all (a `manual` flow is refused, since it was handed no callback URL).

What that route may do is bounded a second time: it stores the code on the flow and nothing else. The exchange with the provider and the write into the Project's models both run on `GET /:flowId`, the owner's own poll, behind the session gate — so no key reaches a Project without its owner asking for its flow's status, and a failed exchange is reported there as `{status: error, error}` rather than on the redirect page. Nothing adjacent is exempt either: a longer path, any other method (`HEAD` on the literal path answers 405), and the three sibling routes all still require the session.

`mode: manual` omits the callback so the authorization page shows a one-time code to carry back by hand, for deployments the redirect cannot reach. Whichever route redeems the code, a completed flow invalidates cached runtimes and publishes `credentials_updated`, exactly as `PUT /models` does.

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
| GET | /agents/:agentId/memory/scopes/:key/export | One scope as a single JSON document: every topic file plus its `MEMORY.md`, downloaded as an attachment |
| POST | /agents/:agentId/memory/scopes/:key/import | Write such a document back (owner only): `{payload, mode?, confirm?}`. `mode` is `skip` (the default — adds only names the scope lacks), `overwrite` (replaces same-named files) or `replace` (also deletes what the document omits); anything that would overwrite or delete needs `confirm`, else 409 `memory_import_confirm_required` |
| GET | /agents/:agentId/export | Export the Agent State snapshot (tar.gz download) |
| POST | /agents/:agentId/import | Import a snapshot: `{dataBase64, confirm?}`; 409 on version conflict without confirm |
| GET | /agents/:agentId/skills | Installed Skills (library installs go through `/plugins`) |
| DELETE | /agents/:agentId/skills/:name | Uninstall a Skill |
| POST | /agents/:agentId/plugins | Install library plugins by name — each one's skills and hook package; reinstalling updates. `{ names }` → 201 `{ skills, hooks }`; 404 `unknown_plugin` writes nothing |
| GET | /agents/:agentId/hooks | Installed hook packages: name, description, version, hook points, the plugin's icon |
| GET | `/api/plugins` (global) | The plugin library by category — every plugin with its skills' metadata and hook points (any logged-in user) |
| GET | `/api/plugins/:plugin/files` (global) | Everything one library plugin ships as text keyed by path — each skill's installable SKILL.md and reference files under `skills/<name>/`, the hook scripts under `hooks/` — for the plugin detail view's file browser (any logged-in user) |
| DELETE | /agents/:agentId/hooks/:name | Uninstall a hook package |
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
| GET | /agents/:agentId/sessions | List Sessions (including run state); every row is listed whichever client created it |
| POST | /agents/:agentId/sessions | Create a Session: `{modelId?, provider?, workspace?, approvalMode?, client?}` → 201. `client` is the creating-client hint stored on the row (`"cli"` from the CLI; default `"web"`) — informational provenance, never a list filter |
| GET | /dirs?path= | Server-side directory browser (backs the Workspace picker) |

On Session creation, `modelId` and `provider` are both-or-neither: send the complete pair to pick a model, or omit both to take the Project's default model — one without the other is a 400. The Workspace defaults to an auto-created temporary workspace, and the approval mode defaults to `allow-all`.

### Usage and Traces (Agent Level)

| Method | Path | Description |
| --- | --- | --- |
| GET | /usage | Usage statistics; query parameters `from`, `to`, `fromTs`/`toTs` (ISO timestamps bounding a trailing window, given together; required for `minute`), `groupBy`, `granularity` (`minute` / `hour` / `day` / `week` / `month` time-series precision, default `day`; oversized range × precision combinations are rejected), `agentId`, `provider`, `modelId` |
| GET | /usage/errors | One page of the error detail table (newest first): `offset`, `limit`, plus the same `from` / `to` / `agentId` filter and an optional `kind` (`unexpected` / `expected`) → `{items, total}` |
| DELETE | /usage/errors | Empties the error table for the filter on screen: `from` / `to` / `agentId`, the same pair the reads take (no `kind` — the panel offers no such control) → `{deleted}`. Project owner only; errors with no Project attribution are outside every clear, admin included |
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
| PATCH | / | Update: `{approvalMode?, thinkingLevel?, archived?, title?}`. `thinkingLevel` pins the level on this Session (durable) and applies from its very next LLM request — the thinking level is soft-limited: changeable mid-context, at the cost of the provider's cached context, which is why the picker advises compacting first — and it comes back as `SessionInfo.thinkingLevel` (absent = never pinned: the Agent config applies) |
| DELETE | / | Delete the Session (along with its Traces and scratch files) |
| GET | /messages | Full OmniMessage history; while a Task runs the response also carries `live` (the in-progress stream tail, see below) |
| POST | /fork | Fork an idle Session through a completed assistant reply: `{position:{fileIndex,ordinal}}` → `{session}` |
| GET | /stream | SSE event stream (next section) |
| POST | /tasks | Start a Task: `{input: TaskInputPart[], queueIfBusy?}` → 202. With `queueIfBusy`, a busy session holds the input as a follow-up (`queued: true`) and auto-starts it as an ordinary next task once idle; `task_state` events report the queued count. `file` input parts are written to the Session scratchpad and handed to the model as `[attached file: <path>]` lines (see the request body below). With `goal: {budget?}` the input starts a goal loop instead (409 `goal_plugin_not_installed` unless the `goal` plugin is installed on the Agent): it must carry non-empty text (an image alone states no objective), any images it carries fold into the objective as scratchpad path lines whatever the model's vision, and `file` parts are refused — nothing folds them into a re-injected objective — see [Goal mode](/goal-mode) |
| POST | /steer | Mid-run steering: `{text, images?}` queues a message for the running Task (delivered between turns as a standalone `[user_steering]` user message, with its images right behind it) → 202; either field can carry the message on its own, but a request with neither is a 400; 409 `not_running` when no Task is in progress |
| DELETE | /steer/:steerId | Recall an undelivered steering message (ids ride `task_state`'s `pendingSteering`): withdraws it from the queue → 200 with its original content `{text, images, files}` (files read back from the scratchpad as data URLs, their disk copies deleted) so the composer can restore it for editing; 409 `not_pending` once it was delivered to the model |
| DELETE | /follow-ups/:followUpId | Recall a queued follow-up task (ids ride `task_state`'s `pendingFollowUps`): removes it before it auto-starts → 200 with its original content `{text, images, files}` — every queued follow-up carries that content, however it was queued; 409 `follow_up_started` once it already started |
| POST | /approvals/:toolCallId | Approval decision: `{decision}` is `allow` or `deny` → 204 |
| POST | /abort | Interrupt the current Task: 202 when triggered, 204 when idle |
| POST | /retry-now | "Retry now" on the reconnect countdown: skips the in-progress backoff wait, firing the next retry immediately (attempt counter unchanged) → 200 `{skipped}` — `skipped:false` is the benign "no wait in progress" case, never an error |
| POST | /compact | Trigger context compaction: 202; 409 when there is nothing to compact, the reason carried by the code — `compaction_not_configured` (this Agent has no compaction configured), `nothing_to_compact` (the context has no completed conversation turn yet), `already_compacted` (nothing new was said since the last compaction). A Session resumed after a server restart reports availability from its Trace, so an existing conversation stays compactable without running a Task first |
| GET | /processes | Background processes the conversation started (`exec_command`s promoted past their yield window). Served from the active runtime only — an evicted or never-loaded session truthfully reports an empty list. Rows carry `serviceUrl` when a served address was detected (the last local URL the output printed, else a listen-port probe of the process group, refreshed on each fetch) |
| POST | /processes/:processId/kill | Stop one background process (SIGTERM to the whole process group, SIGKILL after a grace period); the entry drops from the list. 404 `process_not_found` when it is gone |
| DELETE | /processes/:processId | Remove one **exited** process entry from the list: 409 `process_running` while it still runs (stop it instead), 404 `process_not_found` when it is already gone. The entry leaves the runtime registry with the output captured from it, so `input_command` on that `process_id` fails afterwards |
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
  messages: (OmniMessage & { tracePosition?: { fileIndex: number; ordinal: number } })[];
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

`cursor` and `fragments` are captured atomically before the trace read starts. A client using the connect-first pattern (below) applies them after history: when the cursor's epoch matches the epoch of the SSE events it has buffered, it drops every buffered **partial** event with seq ≤ cursor (their content is already accumulated inside `fragments`), feeds `fragments` through its normal reducer, then replays the rest of the buffer. Buffered **complete** messages are never dropped by the cursor — the regular overlap dedup decides for them. `live` is omitted while idle.

`tracePosition` is history-response metadata, not part of the persisted OmniMessage envelope. The Web App submits the final assistant record's immutable coordinate to `/fork`; the server validates that it closes a completed Task. A fork clones the retained Trace shards and snapshots the source scratchpad under the new Session id, rewriting system-generated local attachment markers so the fork remains usable if either Session is later deleted. Forks made from any reply in the same source Session share a persistent, language-neutral title sequence (`Source title (1)`, `Source title (2)`); deleting an older fork does not reuse its number. Running or compacting sources return 409.

Workspace files may be Agent-generated, so `GET /files/content` treats them as untrusted: every response carries `X-Content-Type-Options: nosniff`, and the rest of the headers depend on the two flags (`download=1` wins over `preview=1`):

| Query | Content-Type | Content-Disposition | Content-Security-Policy |
| --- | --- | --- | --- |
| neither | `text/plain; charset=utf-8` for `.html` / `.htm` / `.svg`, the real type otherwise | `inline` | — |
| `preview=1` | the real type (`text/html`, `image/svg+xml`, …) | `inline` | `sandbox allow-scripts allow-popups allow-modals allow-forms`, sent only for `.html` / `.htm` / `.svg` |
| `download=1` | the real type | `attachment` | — |

`GET /scratchpad/:fileName` serves the same kind of untrusted bytes (uploads and Agent-written temp files) and is locked down the same way, without the flags: `nosniff` always, a fixed allowlist of five inert image types (`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`) served inline for the conversation's `<img>` tags, and everything else `application/octet-stream` with `Content-Disposition: attachment` — so nothing that isn't one of those images can render as a document on the App's origin.

The filename always rides along as `filename*=UTF-8''` with percent-encoding. `preview=1` is where the preview redirect falls back when no separate preview origin is available: the document keeps its real type and does render and run, but the sandbox deliberately omits `allow-same-origin`, so it lands in an opaque origin and can reach neither this origin's cookies nor the API. That isolation is also why `localStorage`, `document.cookie` and third-party embeds do not work there.

### Messaging Bindings (Feishu, Telegram, QQ, WeChat)

A Session can be connected to a messaging bot — Feishu, Telegram, QQ and WeChat are the channels today, each under `/messaging/<channel>`. A Session keeps **at most one saved config per channel** (all of them may sit saved side by side), and **at most one of them is enabled** — the enabled channel holds the live connection. Enabling is what binds the bot account to the Session and disabling releases it, so the same app or bot may sit saved on any number of Sessions and only the enable is exclusive. Inbound messages to the bot start Tasks on the Session as ordinary user input, exactly as if typed into the web composer (no marker, queued as follow-ups while the Session is busy), and completed replies are relayed back to the chat, chunked under the channel's text-size limit (Telegram's hard cap is 4096 characters). Feishu listens over the SDK's WebSocket long connection, Telegram long-polls `getUpdates`, QQ holds the platform's WebSocket gateway with the `GROUP_AND_C2C_EVENT` intent, and WeChat long-polls `ilink/bot/getupdates` — none of them needs a public callback URL. Saving and connecting are separate: PUT persists credentials only, and the explicit state endpoint owns the connection. Paths omit the `/api/sessions/:sessionId` prefix like the table above.

| Method | Path | Description |
| --- | --- | --- |
| GET | /messaging | Channel-agnostic read: EVERY saved channel config (`channel` discriminant, secrets masked, per-row `enabled` intent + `linePerMessage` + `finalReplyOnly` + `renderMarkdown` + runtime status + `lastChatKnown`). The channel-aware binding editor loads this one |
| GET | /messaging/feishu | The Feishu config in a `{binding, status}` envelope (null when not saved) |
| PUT | /messaging/feishu | Save credentials: `{appId, appSecret?, baseDomain?, clearAppSecret?, linePerMessage?, finalReplyOnly?, renderMarkdown?}`. An omitted/blank `appSecret` keeps the stored one; `clearAppSecret: true` drops it (a typed secret wins; 409 `messaging_disable_before_clear` while enabled — the cleared config keeps its row and non-secret fields); `baseDomain` defaults to `https://open.feishu.cn`. No connection side effect — except that an **enabled** binding's connector restarts with the new credentials, so stored config and live connection never diverge. A save never conflicts across Sessions, with one exception that follows from that restart: re-pointing an **enabled** binding at an account ANOTHER Session has enabled answers 409 `account_enabled_elsewhere`, because the restart would otherwise carry a second live connection onto it without passing the enable gate |
| POST | /messaging/feishu/state | The connection toggle: `{enabled}` — enabling connects with the STORED credentials, disabling terminates. 409 `another_channel_enabled` while the Session's other channel is enabled, 409 `account_enabled_elsewhere` while ANOTHER Session has the same account enabled (both mean: turn that one off first — the second names nothing about the holder, which may sit in a Project the caller cannot see); 400 `feishu_secret_required` when the stored config has no secret. New configs start disabled; server startup connects only enabled ones |
| DELETE | /messaging/feishu | Remove this channel's config entirely (App Secret included; the other channel is untouched). API completeness only — the web UI's removal affordance is the clear flag |
| POST | /messaging/feishu/test | Credential probe with the request's draft values, each falling back to the stored config → `{ok, latencyMs?, error?}` (a rejected credential is `ok: false`, not an HTTP error) |
| POST | /messaging/feishu/test-message | Send a short fixed text to the last known chat; 409 `feishu_no_chat` until the bot has been messaged once in Feishu |
| GET | /messaging/telegram | The Telegram config in the same envelope (`botId`, `botTokenMasked`) |
| PUT | /messaging/telegram | Save the credential: `{botToken?, clearBotToken?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` — the whole credential is the one `<bot id>:<secret>` token from @BotFather (omitted/blank keeps the stored one; 400 `telegram_token_invalid` when the numeric id cannot be read; the clear flag works like Feishu's and the cleared config keeps its bot identity). Same save/enable split, the same 409 `account_enabled_elsewhere` when an enabled binding's token is swapped for one another Session has enabled, and otherwise the same absence of a cross-Session conflict on save |
| POST | /messaging/telegram/state | Same contract as the Feishu toggle (400 `telegram_token_required` without a stored token) |
| DELETE | /messaging/telegram | Remove this channel's config entirely (Bot Token included). API completeness only |
| POST | /messaging/telegram/test | Credential probe (`getMe`) with the draft token falling back to the stored one → `{ok, latencyMs?, botUsername?, groupPrivacy?, error?}` — success names the bot the token signs in as, and reports `groupPrivacy: true` when @BotFather's Group Privacy is on (the default), under which the bot receives no ordinary message in any group it does not administer |
| POST | /messaging/telegram/test-message | Send a short fixed text to the last known chat; 409 `telegram_no_chat` until the bot has been messaged once in Telegram |
| GET | /messaging/qq | The QQ config in the same envelope (`appId`, `appSecretMasked`) |
| PUT | /messaging/qq | Save the credential pair: `{appId, appSecret?, clearAppSecret?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` — the App ID and App Secret from the QQ open platform's development settings. Same keep-on-blank, clear flag and save/enable split as the Feishu PUT, the same 409 `account_enabled_elsewhere` when an enabled binding's App ID is swapped for one another Session has enabled, and no cross-Session conflict on save otherwise; there is no domain field, because API v2 has one host |
| POST | /messaging/qq/state | Same contract as the other toggles (400 `qq_secret_required` without a stored secret) |
| DELETE | /messaging/qq | Remove this channel's config entirely (App Secret included). API completeness only |
| POST | /messaging/qq/test | Credential probe (the app-access-token exchange) → `{ok, latencyMs?, error?}`. No account label: the platform has no call that identifies the bot |
| POST | /messaging/qq/scan | Start scan-to-connect: the server registers a bind task under a fresh AES key it keeps → `{taskId, qrUrl, pollMs}`. Render `qrUrl` as a QR code; it is opened by the QQ app, never fetched. 409 `messaging_disable_before_scan` while this Session's QQ connection is enabled — a scan rewrites both halves of the credential under a live connector; 502 `qq_scan_failed` when the platform refuses |
| POST | /messaging/qq/scan/poll | `{taskId}` → `{status, appId?, binding?}`. `completed` means the server already decrypted the App Secret and **saved** the binding (enabling stays separate); `expired` means start a new task. 404 `qq_scan_task_unknown` for an unknown, foreign or already-resolved task |
| POST | /messaging/qq/scan/cancel | `{taskId}` — drop a scan the user walked away from, so its key is forgotten now rather than at the sweep |
| POST | /messaging/qq/test-message | Send a short fixed text to the last known chat; 409 `qq_no_chat` until the bot has been messaged once in QQ, and 502 `qq_send_failed` when no recent QQ message can be replied to (see below) |
| GET | /messaging/wechat | The WeChat config in the same envelope (`botId`, `botTokenMasked`) |
| PUT | /messaging/wechat | Save the delivery preferences ONLY: `{clearBotToken?, linePerMessage?, finalReplyOnly?, renderMarkdown?}`. The one PUT here that carries no credential — a WeChat bot token exists only where a scan put it, and there is no console to copy one out of — so it presupposes a binding and answers 400 `wechat_token_required` before one exists. The clear flag works like the others' (409 `messaging_disable_before_clear` while enabled; the cleared config keeps its row and its bot identity, and only a fresh scan makes it connectable again) |
| POST | /messaging/wechat/state | Same contract as the other toggles (400 `wechat_token_required` without a stored token) |
| DELETE | /messaging/wechat | Remove this channel's config entirely (bot token included). API completeness only |
| POST | /messaging/wechat/test | Credential probe (`ilink/bot/getconfig` on behalf of the account that scanned) → `{ok, latencyMs?, error?}`. The only test here that takes NO body: nothing on this channel is typed, so the stored binding is the only thing to probe (400 `wechat_token_required` without one). No account label — the probe names neither the bot nor the person |
| POST | /messaging/wechat/scan | Start scan-to-connect, which on this channel is the ONLY way to bind → `{taskId, qrUrl, pollMs}`. Render `qrUrl` as a QR code; it is opened by WeChat, never fetched. The platform's own poll handle — the thing that collects the bot token — stays on the server, and `taskId` is a handle this server mints in its place. 409 `messaging_disable_before_scan` while the connection is enabled; 502 `wechat_scan_failed` when the platform refuses |
| POST | /messaging/wechat/scan/poll | `{taskId}` → `{status, botId?, binding?}`. `status` is one of `pending`, `scanned`, `need_verify_code`, `blocked`, `expired`, `already_bound`, `completed`. `completed` means the server already **saved** the binding (enabling stays separate); `already_bound` is not a failure — the bot is bound already and nothing new was issued. It does not say WHERE: the scan offers the platform no token list, so it cannot distinguish a binding on this server from one anywhere else. 404 `wechat_scan_task_unknown` for an unknown, foreign or already-resolved task. Unlike QQ's poll, an OVERLAPPING request answers `pending` rather than 404: the upstream call is a long poll and spans several client intervals |
| POST | /messaging/wechat/scan/verify | `{taskId, verifyCode}` → 204. The pairing code WeChat showed on the phone. It rides the NEXT poll rather than a request of its own, because the platform takes it as a parameter of its status call, so this only records it — a wrong code surfaces as the next poll reporting `need_verify_code` again |
| POST | /messaging/wechat/scan/cancel | `{taskId}` — drop a scan the user walked away from, so its handle is forgotten now rather than at the sweep |
| POST | /messaging/wechat/test-message | Send a short fixed text to the last known chat; 409 `wechat_no_chat` until the bot has been messaged once in WeChat |

Masked secrets are omitted from responses when none is stored (a cleared config), and a config without a secret cannot be enabled. `linePerMessage`, `finalReplyOnly` and `renderMarkdown` are the three saved fields that are not credentials. With `linePerMessage` set, every non-blank line of a relayed assistant reply is sent as its own message (blank lines dropped, each line still chunked under the size cap, and the remainder combined into one last message past a per-reply message cap). With `finalReplyOnly` set, a run relays only its LAST completed assistant message, delivered when the run ends, instead of mirroring each one as it completes — the working notes a run writes between tool calls stay in the web app, and the files that follow the reply are then read from that final message alone, since it is the only text the chat received. The two compose: with both set, the final reply is the one split per line. Both default to false, an omitted value on a PUT keeps the stored one, and neither applies to the notices or the test message — the approval reminder in particular is not a reply and arrives immediately whatever `finalReplyOnly` says. `renderMarkdown` renders a relayed reply's Markdown in the channel's own markup instead of sending its characters as written; it **defaults to true**, an omitted value on a PUT keeps the stored one, and it likewise never applies to the notices or the test message. Each channel shows what it can and degrades the rest deliberately rather than leaking the source: Telegram sends `parse_mode: "HTML"` and has no headings, lists or tables (a heading becomes a bold line, list markers become literal text, a table becomes a `<pre>` block); Feishu sends an interactive card carrying the JSON 2.0 rich-text component and renders everything, over-long tables becoming code blocks so no row is silently dropped; QQ sends `msg_type: 2` free-form markdown and has no code formatting and no tables (a fenced block becomes plain escaped lines, a table becomes its rows); WeChat reads Markdown itself, so rendering SUBTRACTS rather than translates — what the client will not show keeps its words and loses its markers (headings past the fourth level, emphasis around CJK, and inline images, which become links). Chunking follows the setting, cutting at block boundaries and re-fencing a code block that spans messages, so no message opens a construct it does not close. **A formatted send the channel refuses falls back to a plain-text send of the same message**, so the setting can cost formatting and never a reply. The one cross-Session rule is per bot account per channel and applies to the connection only: one account has one event stream, so at most one Session may have it enabled. Feishu's account identity is the `app_id`, Telegram's is the numeric bot id in front of the token's colon (robust against token rotation), and WeChat's is the bot id the scan returns. Reads and the two tests are open to any Project member; PUT, the state toggle and DELETE are owner-only (vault semantics — the binding writes carry or act on the secret). Secrets never round-trip. Deleting the Session removes all its configs. Inbound processing accepts text, images and files: an image becomes an ordinary `image_url` input part, capped at the server's inline-image ceiling per image and by a rolling per-binding byte budget in aggregate — an inline image is written verbatim into the Trace, and this path, unlike the composer, has no authentication in front of it. A file becomes the composer's other attachment shape — written into the Session scratchpad and handed to the model as an `[attached file: <path>]` line, so its bytes never enter the conversation — under the same admin-settable per-file and per-message attachment caps an authenticated upload answers to, narrowed further by any tighter ceiling the channel itself has (Telegram serves a bot no file over 20MB). Feishu takes the `file` message type and Telegram the `document` field: a file the sender chose to send AS a file, which is also the only one of Telegram's media fields carrying the sender's own name. Video, audio and voice are deliberately not delivered on those two channels — nothing downstream decodes or transcribes them, and what a sender wants the Agent to have arrives as a file the moment they attach it as one. WeChat is the exception, and only because the platform does the work itself: it ships its own transcription with a voice message, and a video arrives as an ordinary file. The caption of a message whose attachment IS delivered (a photo, a document) is that message's text; a caption on any other media kind is not, since its bytes never arrive and running the model on the caption alone answers about a file it never received. An image over the ceiling, one past the budget and one the channel refuses answer with three different bilingual notices, as do a file over a cap, a batch over the per-message total and a file the channel refuses; none of them runs half a message, and a refusal the bot's own permissions caused names the scopes to grant and carries the channel's console link, which for Feishu is the usual case (receiving messages and downloading their attachments are separate scopes). Every other type still gets the bilingual "not supported" reply. Outbound, a finished run's reply is followed by the files it MENTIONED AND PRODUCED — path-like tokens that resolve inside the Workspace, exist, and were written at or after the run started, wherever in the reply they appear (the mention picks which output was the point; the mtime is what keeps a steerable reply from becoming a read primitive, since a reply that declines to paste a file still names it) — images as images and everything else as attachments, classified by the file the read actually reached rather than by the name the reply spelled, at most 5 per run and at most 10MB per image / 30MB per file (the tighter of each channel's own limits). Every way a mentioned file does not arrive is said in the chat — over a cap, past the count cap, no such file in the Workspace, or an upload the channel refused — except a file the run did not write, which is dropped silently because a reply naming the config it read is the ordinary case. Telegram connects by draining the backlog first: messages sent while no connection existed are skipped, matching Feishu, where missed events are simply gone. A binding's runtime status additionally reports what the live connection has SEEN — `lastInboundAt` (when a message last arrived; absent while none has since this connection opened), `lastDeliveryError` (`{at, stage, detail}`, where `stage` is `inbound` when the message arrived and its Task never started, or `send` when a reply never reached the chat, and which no later success clears) and `lastConnectionError` (`{at, detail}` for the last connection failure, kept after the connection recovers — unlike `lastError`, which belongs to the `error` state and is gone the moment the state leaves it). All three are in-process and reset on every (re)connect — a re-enable or a credential save opens a new one — so an absent `lastInboundAt` means "nothing since this connection opened", never "nothing ever". They exist because a channel that withholds messages produces `connected` with no error at all.
**QQ is a reply-only channel, and it changes what delivery means.** The platform accepts no push this product may use: every outbound message is a *passive reply* carrying the `msg_id` of an inbound one, valid for a few minutes and capped at 4 replies per message in a single chat (5 in a group). Three consequences are visible through this API. A run that completes more assistant messages than the budget allows has them **coalesced** — the first `budget - 1` go out as they complete and the rest arrive combined in one final message, so nothing is dropped. `linePerMessage` is **clamped to that budget** rather than to the channel-neutral cap of 20, and a `renderMarkdown` send the platform refuses spends a second slot on its plain-text retry. `finalReplyOnly` cuts both ways here: it spends the least budget a run can spend — one reply — but the passive-reply window is only a few minutes wide, and holding the reply until the run ends spends that window on the run, so a run that outlives it delivers nothing at all where an every-message relay would have sent whatever completed inside it. And a send with nothing to reply to — a turn started in the web app, or any reply after the window closed — is **refused rather than pushed**, surfacing as 502 `qq_send_failed` on the test endpoint and as one `messaging_send_failed` error record for a relayed reply. QQ's account identity is the App ID. Outbound files are refused on this channel: the platform's rich-media path requires a publicly reachable URL for the bytes.
**WeChat carries direct chats only, and the most media of the four.** The claw bot channel has no group inbound at all: a message addressed to the bot in a group never reaches this API, so a binding that answers a direct chat perfectly is silent in a group by design rather than by misconfiguration. In exchange it is the only channel here that carries text, images and files in BOTH directions — a reply's pictures and attachments are uploaded to the platform's CDN (AES-128-ECB under a per-file key) and arrive as real images and files rather than being refused. Two inbound kinds are folded: a voice message is relayed as WeChat's own transcription of it, and a video arrives as a file; a recording the platform could not transcribe reaches the chat as the shared not-supported notice.

**Scan-to-connect never shows the browser the secret.** Whatever makes the flow safe stays on the server — the AES key that decrypts QQ's App Secret, and the poll handle that collects WeChat's bot token — generated, held, used and dropped there; the client is given only a task handle, a URL to draw, and a status. Tasks live in memory, are scoped to the Session that started them, are bounded per Session so one caller's scans cannot evict another's, and are claimed by the poll that resolves them, so a replay reads as 404 rather than as a second bind. On QQ a second concurrent poll of one task reads as 404 too; on WeChat it answers `pending`, because the upstream call is a long poll that spans several client intervals. Every scan route is owner-only, because the flow ends in a stored credential however little of it the caller types.

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
  // The thinking level is not a task parameter: it belongs to the model context — pin it on
  // the Session with PATCH, and each context the Session opens runs at the pinned level
}
type TaskInputPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string }    // pasted images arrive as data URLs, ≤20MB (413 image_too_large)
  // File attachment: base64 data: URL, by default ≤100MB each (413 file_too_large beyond that),
  // at most 20 per request and 120MB of decoded bytes in total (413 too_many_files /
  // payload_too_large; all three are checked before anything is written). The two sizes are
  // admin-settable (PUT /api/admin/settings) and reported by GET /api/me. The server writes it into the Session
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
| Per user | GET /api/events | `hello` handshake and cross-Session notifications (session_state / session_background / schedule_fired / schedule_queued / session_created) |

### Wire Format

Default (unnamed) SSE events carry raw OmniMessage envelopes as single-line JSON — the same protocol the SDK yields and the Trace stores, see the [OmniMessage Protocol](/omni-message). Events named `server_event` carry the ServerEvent union:

```ts
export type ServerEvent =
  | { type: "approval_request"; toolCall: OmniMessage<ToolCallPayload>; origin?: string[] }
  | { type: "task_state"; state: "idle" | "running" | "compacting" }
  | { type: "session_title"; sessionId: string; title: string }
  | { type: "session_state"; sessionId: string; state: "idle" | "running" | "compacting"; lastActiveAt: string; hasTrace: boolean }
  | { type: "session_background"; sessionId: string; processes: number; subagents: number }
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
| session_title | The model-generated title after the first turn has been persisted |
| session_state | The user-channel counterpart of `task_state`: the same run-state flip, named by `sessionId`, so a Session list stays live for every row and not only the conversation a client has open. Carries the row fields needed to redraw it without refetching — `lastActiveAt` as just stamped, and `hasTrace` (true whenever the state is running or compacting, since a Session that is running has by definition started a Task). Published to the user channels of the Project's owner and members |
| session_background | A Session's background-task counts changed — a command promoted past its yield window or launched with `run_in_background`, a process that exited or was stopped, a background subagent starting, settling or being released. Carries `SessionInfo.backgroundTasks` as it now stands (`processes` = background command sessions still running, `subagents` = promoted subagent sessions mid-round), zeros included so a list can clear its mark without refetching; the list row and the single-session GET omit the field at zero. Same audience as `session_state` |
| resync_required | The Last-Event-ID was evicted from the buffer; the client must refetch history |
| credentials_updated | The Project's model credentials changed (`PUT /models`, or a completed key-minting flow): cached runtimes were invalidated, so the client clears any auth-dead composer state |
| hello | Handshake on the user channel |
| session_created | A new Session was registered (e.g. a subagent session) |
| schedule_fired | A scheduled task fired and was delivered |
| schedule_queued | The target Session is running; this firing was queued |

### Delivery Guarantees

- Event ids are monotonic per channel, shaped `<epoch>-<seq>`;
- Each channel keeps a bounded replay buffer (most recent 10,000 events or 8MB);
- Reconnecting with `Last-Event-ID` replays the gap on a buffer hit; on a miss the server first sends `resync_required`, and the client refetches `/messages` before continuing;
- A heartbeat comment line is written every 20 seconds;
- Event order: on a reconnect carrying `Last-Event-ID`, **the replayed gap (or `resync_required`) arrives first**, then the initial events — the authoritative `task_state` snapshot and still-pending approval_requests — then the live stream. A fresh connection (no `Last-Event-ID`) skips replay, so its first event is the `task_state` snapshot.

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
