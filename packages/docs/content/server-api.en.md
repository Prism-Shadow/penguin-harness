---
title: Server API
description: Reference for the PenguinHarness server's HTTP API, covering authentication, every route group, the SSE streaming protocol and DTO type imports.
---

The PenguinHarness server exposes a same-origin HTTP API that the bundled Web App and any other HTTP client use. This page covers authentication first, then the routes grouped by area, each with a route table followed by details, and ends with the SSE streaming protocol. To start the server, see the [Quickstart](/quickstart).

## Overview

- Stack: Hono and `@hono/node-server`; requires Node >= 24.
- Storage: SQLite (the built-in `node:sqlite`, in WAL mode) holds only indexes and aggregates: users, auth sessions, Project authorization, agent and Session indexes, usage, UI preferences, error records and schedule state. All agent, Trace and Workspace data stays as files under `~/.penguin/data`, shared with the CLI and SDK; see the [Configuration Reference](/configuration).
- Binding: `127.0.0.1:7364` by default, adjustable with the `PORT` / `HOST` environment variables.
- Request bodies: writes accept JSON only; the Content-Type check is one of the CSRF defenses. The body size cap is derived from the attachment budget rather than fixed. Attachments travel in the request as base64 `data:` URLs, which inflate them by 4/3, so the cap is `base64(attachmentTotalMb)` plus headroom for one inline image and the JSON framing. That is about 190MB at the default 120MB total, and the cap drops again if an admin lowers the total. The server counts bytes as it reads the body, so a request that declares no length (chunked) is capped the same way.
- Errors share one shape:

```text
{ "error": { "code": "<machine-readable code>", "message": "<user-facing text>" } }
```

## Source layout

```text
packages/server/src
├── index.ts / config.ts / app.ts   # startup entry · env config · the HMR layer's app (network guards, /api/hmr, the platform seam, static hosting; binds no port, testable)
├── api/types.ts                    # the outward DTO contract (type-only import via the "./api" subpath)
├── auth/                           # scrypt passwords, admin seeding, cookie sessions, auth middleware
├── db/                             # node:sqlite connection, schema SQL, one repo per table
├── hmr/                            # hot update: the platform seam and the /api/hmr routes
├── http/                           # the business routes' assembly (app.ts), error bodies, request validation, SSE adapter, routes/
├── machines/                       # remote machines: ssh config, install and connect jobs, the /server/<machineId> proxy
├── organization/                   # company mode's files: chart, tickets, channels, handbook
├── runtime/                        # session-manager (runtime driving) · channel (SSE ring buffer)
│                                   # approvals · usage-recorder · scheduler · title-generator · messaging/ · organization/
├── services/                       # authorization rules, TOML/YAML config IO, Session/Trace/usage/snapshot services
└── terminal/                       # terminals: /api/terminals and the byte-stream WebSocket
```

## Authentication

The API accepts two credentials: a cookie session and the local API token.

- Cookie session: `penguin_session` (HttpOnly, SameSite=Lax), valid for 30 days with sliding renewal.
- Passwords are stored as scrypt hashes. A session is a row in `auth_sessions`, keyed by the sha256 of a random cookie token; the raw token is never stored. A session survives a restart and renews in place, and logout deletes the row.
- There is no open registration. At startup the server seeds the built-in admin `admin` with a random password, which it hashes and discards without anyone seeing it. Until a password is set, every start prints a first-login link that claims the account. For automation, `PENGUIN_SEED_ADMIN_PASSWORD` pins a known password instead. An admin creates all other accounts.
- Same-origin only: no CORS middleware is enabled.
- Routes marked admin only answer other users with `403` `admin_required`.

```bash
# Use the password you set when claiming the account from the first-login link.
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"userId":"admin","password":"<your password>"}' \
  http://localhost:7364/api/auth/login
```

### Local API token (Bearer)

Every protected route also accepts `Authorization: Bearer <token>` with the **local API token**. The CLI, and agents that drive the harness through it, use this machine-local credential instead of a login.

- The server mints a fresh token at every boot and writes it to `<root>/api-token` with owner-only permissions (`0600`). The previous boot's token stops working as soon as the new one is minted.
- A valid Bearer token authenticates as the built-in `admin`. This is the authorization model by design: local filesystem access to the data root already is admin authority, since whoever can read `api-token` can also read `web.db` next to it. `penguin server reset-admin-password` relies on the same rule.
- Server-driven sessions inject the current token into every tool subprocess as `PENGUIN_API_TOKEN`, together with `PENGUIN_API_URL`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID` and `PENGUIN_SESSION_ID`. That is what authorizes an agent's own `penguin` and API calls to reach the server that runs them.
- SSE endpoints accept the header like any other route. Consume them with `fetch`, not `EventSource`, which cannot send headers.
- The JSON-only Content-Type check on writes applies to Bearer requests too.

```bash
curl -H "Authorization: Bearer $(cat ~/.penguin/data/api-token)" \
  http://127.0.0.1:7364/api/me
```

## Auth and Account

Sign-in, sign-out, account claiming, and the current user's password, profile and preferences.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/auth/login` | Logs in: `{userId, password}` → `{user}` |
| POST | `/api/auth/logout` | Logs out; returns `204` |
| GET | `/api/auth/claim?token=…` | Redeems a sign-in link: sets the cookie and redirects to `/` |
| GET | `/api/install` | Public: `{installId}`, the id of the data root being served |
| GET | `/api/me` | The current user's info |
| PUT | `/api/me/password` | Changes the password: `{oldPassword, newPassword}` |
| PUT | `/api/me/profile` | Sets the avatar and nickname: `{displayName?, avatar?}` → `{user}` |
| GET | `/api/me/prefs` | Reads UI preferences |
| PUT | `/api/me/prefs` | Writes UI preferences (shallow merge) |

- `GET /api/auth/claim` redeems a first-login link or the desktop shell's one-shot token. An invalid or already-used link redirects to `/login?claimFailed=…` instead, where the Web App explains how to get a working one.
- `GET /api/install` needs no authentication. `installId` is an opaque id stored in `<root>/install-id`, minted the first time the root is used. The Web App compares it with the id it stored and, when they differ, clears the browser-side UI state that refers to server entities, so replacing the data root no longer leaves the old Workspace, drafts and pins behind. `null` means the server could not establish an id, and clients must then change nothing.
- `PUT /api/me/password`: a desktop or first-login session may omit `oldPassword`, because its current password is random and was never shown.
- `PUT /api/me/profile` is a patch. An absent field keeps its stored value, `null` clears it, and a body that names neither field is a `400`.
  - `displayName` must be 1–32 characters after trimming, counted as characters (so a CJK name may have 32), with no control characters.
  - `avatar` must be a `data:image/(png|jpeg|webp);base64,…` URL of at most 131072 characters whose payload decodes.
  - Every authenticated session may call it, including the desktop shell's token session. Unlike the password route, a profile has no old credential to check.

## User Administration (admin only)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/admin/users` | Lists users |
| POST | `/api/admin/users` | Creates a user: `{userId, password}` |
| POST | `/api/admin/users/:userId/password` | Resets a password and invalidates all of that user's login sessions |
| DELETE | `/api/admin/users/:userId` | Deletes a user |

Each row of the user list carries the account's nickname when it has one. Avatars are deliberately left out: the list is not paged, and one data URL per account would dwarf the rest of the response.

In desktop mode (a server spawned by the desktop app), every route in this group answers `403` with code `desktop_single_user`. The desktop app is single-user, so user management is disabled; users already in the data root are untouched.

## Server Settings (admin only)

Server-wide proxy, attachment and company-mode settings.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/admin/settings` | Server-wide settings: `{settings: {proxyForApp, proxyForAgent, proxyUrl, attachmentMaxMb, attachmentTotalMb, imageCompression, imageCompressionOverMb, companyMode}}` |
| PUT | `/api/admin/settings` | Updates settings; omitted fields keep their current value, and an invalid field rejects the whole PUT. Returns the full updated settings |
| GET | `/api/admin/settings/proxy-probe` | The reachability probe's targets: `{targets: [{provider, url}]}`. Makes no request |
| POST | `/api/admin/settings/proxy-probe/:provider` | Probes one target over the server's outbound path, sending no credential: `{probe: {provider, url, outcome, ms, status?}}` |

A probe's `outcome` is `reachable` for any HTTP answer, and otherwise `timeout`, `dns`, `refused`, `tls` or `network`. A `:provider` that is not in the target list returns `404` `probe_target_not_found`.

### Proxy settings

The proxy settings are two independent switches that share one optional explicit address. Changes apply to newly opened connections and newly spawned processes right away, with no restart.

`proxyForApp` (the **Application uses the proxy** switch, on by default) governs the server's own outbound traffic: LLM requests, the update check and image fetches.

- On, with `proxyUrl` set: both http and https use that address, which takes precedence over the proxy environment variables. No environment variable needs to be configured.
- On, without an address: the server follows the `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` environment variables, in either spelling.
- Off: always direct.

`proxyForAgent` (the **Agent environment uses the proxy** switch, on by default) governs the environment of agent command subprocesses.

- On, with `proxyUrl` set: `HTTP_PROXY` and `HTTPS_PROXY` (plus their lowercase twins) are injected with that address, together with the merged `NO_PROXY`, overriding inherited values. A `socks5://` address is injected as-is; tools differ in whether they accept SOCKS URLs in these variables.
- On, without an address: the host environment passes through unchanged.
- Off: the proxy variables are removed, and `NO_PROXY` is kept.

`proxyUrl` is the shared explicit address. It defaults to `null`, which means following the environment variables. PUT validates it as follows:

- The value is trimmed, and an empty value or `null` clears the address.
- Accepted values are the proxy URLs undici's dispatcher takes (`http://`, `https://`, and the experimental `socks5://` / `socks://`, with credentials allowed), plus a bare `host[:port]`, which is normalized to `http://host[:port]`. Only the normalized value is stored, and the response echoes it.
- Anything else, whether unparseable or a scheme undici refuses such as `socks4://`, returns `400` with code `invalid_proxy_url`, and the rejected PUT writes nothing.

In every on-state, the effective `NO_PROXY` includes `localhost,127.0.0.1,::1`, so loopback traffic is never proxied.

### Attachment limits

Two whole-MB integers govern file attachments in the composer. Both apply from the next request with no restart, because the validators and the body cap read them on every request.

- `attachmentMaxMb` (default 100) is the per-file cap. A larger file returns `413` `file_too_large`.
- `attachmentTotalMb` (default 120) is the per-message total of decoded bytes. A larger total returns `413` `payload_too_large`.

PUT validates them as follows:

- Each must be an integer from 1 to 200.
- The effective total (the value in this PUT, or the stored one if this PUT does not change it) must not be below the effective per-file cap.
- Anything else returns `400` with code `invalid_attachment_limit`, and the rejected PUT writes nothing.

Two limits cannot be changed: the number of files per message (20) and the inline-image cap (20MB, `413` `image_too_large`). An inline image is written into the Trace and read again on every history page and every resume, so it deliberately does not follow the attachment cap upward. `GET /api/me` reports all of these limits under `uploadLimits`, so a client can check a file against the limits actually in force before sending it.

### Image compression

A limit is what the server refuses; this is what the Web App is asked to do before it uploads. An inline image enters the conversation and the Trace, where its size is paid again on every history page and every resume, so a large one is resized and re-encoded in the browser — before it becomes a base64 `data:` URL, so the upload shrinks with the picture.

- `imageCompression` (default `true`) is the switch.
- `imageCompressionOverMb` (default 4) is the size above which an image is re-encoded. A smaller one is uploaded byte-for-byte, and so is any animated or vector image (GIF, SVG), which a canvas round trip would turn into a different picture.
- PUT validates the threshold as an integer from 1 to 64. Anything else returns `400` with code `invalid_image_compression`, and the rejected PUT writes nothing.

`GET /api/me` reports both under `uploadPolicy`, together with the range the threshold may be set to. The policy shapes what a client uploads; it gates nothing, and an API client that ignores it is not refused — it simply pays the full size itself. The attachment limits above still apply to whatever is uploaded, compressed or not.

### Company mode switch

`companyMode` is the server's **Enable company mode** switch, off by default. A change applies without a restart: while the switch is off, every organization route returns `404` `company_mode_off` and the organization scheduler fires nothing.

## Machines (admin only)

Installs this server's build on other hosts over ssh and manages the connections to them.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/projects/:projectId/machines` | This machine and the host aliases in the server's own `~/.ssh/config`, with this Project's installs, the last statuses and the current job: `{machines: [{id, alias, machineId, installed, elsewhere?, local, connection, api, status}], imageVersion, job}` |
| POST | `/api/projects/:projectId/machines/probe` | Asks this Project's installed machines what they are doing (one ssh round trip each, five at a time) and returns the list with fresh statuses |
| POST | `/api/projects/:projectId/machines/:machineId/install` | Starts installing this build on that host and assigns the host to this Project; `202` with the same body while the job runs |
| POST | `/api/projects/:projectId/machines/:machineId/connect` | Starts that machine's server and holds the one connection to it; `202` with the same body while the connect job runs |
| POST | `/api/projects/:projectId/machines/:machineId/disconnect` | Drops the connection and leaves the remote server running |
| POST | `/api/projects/:projectId/machines/:machineId/restart` | Stops that machine's server and starts it again on the same port; `202`, or `409` while a job runs |
| GET | `/api/projects/:projectId/machines/:machineId/dirs?path=` | The subdirectories of `path` on that machine, read over the held connection; the Workspace picker browses these |
| POST | `/api/projects/:projectId/machines/:machineId/release` | Removes that machine from this Project; the install on it stays |

These routes are admin only on a personal server as much as on a multi-user one: an install runs ssh with the server account's keys and writes a program directory on another machine, which is an owner's capability rather than a visitor's. The server never writes to its ssh config and never resolves it. The list is the config's text, read once however many hosts it declares, and each alias goes to ssh exactly as written, so ssh applies its own config every time.

- `POST …/install` accepts the body `{replaceProgram: true}` to answer a job that came back asking for it: the server installs the program even though its version already matches, and restarts it.
- `POST …/connect` holds an `ssh -T -D` session that never times out when idle, reconnects on its own if it drops, and is restored after a restart or a hot push. A Windows machine returns `409` `connect_unsupported`, because there is no shell to hold a session on.
- `POST …/disconnect` leaves the remote server running because it belongs to that machine, and other people may be using it.
- `POST …/restart` exists as its own action because a machine's files can be updated while it runs, and only a restart makes the process match them.
- `GET …/dirs` addresses the machine by its own id, like the API proxy below. It returns `404` when the machine is not connected, because a read never opens ssh by itself.

### Machine fields

- `elsewhere`: the host was installed by another Project, so it can be adopted instead of installed.
- `imageVersion`: the version that would be pushed, or `null` when this server has no install image at all. A development checkout that was never hot-pushed to is the only such case, and every install then fails with `409` `no_install_image`. The version is the running install's own: a hot-pushed server sends the bundle it runs (`0.0.0-hmr.<cli>.<web>`), and a tarball or packaged install sends its own tree, so both ends match by construction.
- `installed`: the last install this server carried out on that machine, as `{version, at}`, or `null` if there was none. It is stored under the data root, so it survives a restart, a hot push and installs on other machines. It records what was done rather than checking the far side, so a machine wiped by hand still shows as installed until the next install corrects it. A failed install records nothing.
- `machineId`: the machine's own id, 16 base64url characters minted by the server running there (in its `machine` table). It stays the same across renames, alias changes and reinstalls, and stored references should point at it. It is `null` until a server has started on that machine, since nothing has minted it yet. The server learns it on the same round trip as `status` and stores it beside the install record. Two aliases for one host report the same `machineId`.
- `local`: marks the machine this server runs on. It is always listed, always installed and always running, since it is the one answering, and it is never an install target: `POST …/install` on it returns `409` `self_install`.
- `status`: `{state, checkedAt, port?, detail?}`, where `state` is `running`, `stopped` or `unreachable`; `null` when the machine has never been probed. There is no separate ssh status. Because ssh is the transport, a machine ssh cannot reach is `unreachable`, and `detail` carries OpenSSH's own message. `GET` never probes and reports the last answer, because a probe costs one ssh round trip per machine while the list itself is only the config's text. Only `POST …/machines/probe` spends those round trips, and only on machines that have an install.

### Connected machine API

A connected machine's API is reachable at `/server/<machineId>/api/…` on this server's origin. Requests travel through the single ssh session this server holds to that machine, as a channel inside the session through its SOCKS port, never as a second connection.

The URL uses the machine's own id rather than the ssh alias it was reached through. An alias lives in one config file, so keying on it would change a machine's URLs as soon as someone renamed a host. The id is base64url, so it needs no percent-encoding in a path.

This proxy is admin only and uses one identity: the request runs on the far side as that machine's admin, with a session this server mints through its own ssh access (`penguin auth token` on the machine). The browser's cookies never go across, and the machine's cookies never come back. Only `/api` is forwarded; the frontend stays local.

### Jobs

An install is a job, not a single request. It probes the far side, may download and verify a Node runtime, and copies an image over scp, which can take minutes. `POST` starts the job and returns at once. The client polls `GET` for `job.log`, which carries the far side's own output (ssh's diagnostics and the remote installer's output).

A connect (`POST …/connect`) and a restart (`POST …/restart`) are jobs of the same shape, told apart by `job.kind` (`install`, `connect` or `restart`). `job.result` is `null` while the job runs, and then one of:

- `{ok: true, installed: "installed" | "already-installed", version}` for an install
- `{ok: true, connected: true}` for a connect or a restart
- `{ok: false, step, message, canReplaceProgram?}` for a failure

`canReplaceProgram` marks a failure whose next step is to install the program anyway, with `POST …/install` and `{replaceProgram: true}`. The server offers this step instead of taking it, because it restarts a server other people may be using.

Only one job runs at a time. Jobs live in memory and do not survive a hot push or a restart. To recover, run the job again: every step is idempotent.

### Refusals

These refusals are decided before any ssh command runs, and each has its own code:

- `409` `install_running`
- `404` `unknown_machine`
- `409` `no_install_image`
- `409` `self_install`: this server will not push its build over the program directory it runs from. Besides the `local` row, this also covers an alias that points back to this host (such as `Host localhost` or a second name for this host) once a probe has heard this server's own id from it.

## Version and Self-Update

Report the running build, check GitHub for a newer release, and run the self-update.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/version` | The running build's identity and this root's pushed harness |
| GET | `/api/version/update-check` | Compares the newest GitHub release with the running version |
| GET | `/api/version/update` | Admin only. The self-update job's status |
| POST | `/api/version/update` | Admin only. Starts the self-update job |
| POST | `/api/version/restart` | Admin only. Restarts the process through its supervisor |

### GET /api/version

Returns the identity of the running build plus this root's pushed harness: `{version, describe, channel, buildDate, commit, branch, dirty, runtime, harness}`. It is the same record `penguin version --json` prints.

- `describe` is the one-line identity: `v0.2.3` for a release, `v0.2.3-14-g9e8f7d6-dirty` for a build from a checkout.
- `channel` is `release` or `source`.
- `buildDate` (UTC yyyy-mm-dd) and `commit` are stamped at build time, so reading them needs no network. They are null in a source build and in a release that predates the stamping.
- `branch` and `dirty` carry a source build's git position and are null for a release.
- `harness` describes the data root's HMR store as `{source, pushedAt, bundles}`, where `source` is the pushing checkout's `{repo, revision}`. It is null when nothing was ever pushed to that root.

### GET /api/version/update-check

Compares the newest GitHub release with the running version: `{currentVersion, latestVersion, updateAvailable, releaseUrl, publishedAt, checkedAt, disabled?, error?}`. `?force=1`, which the manual **Check for updates** action sends, bypasses the TTL cache, and the result is cached as usual.

The lookup fails softly:

- A failed lookup still returns 200, with `error` set (`network`, `rate_limited` or `bad_response`) and `latestVersion: null`.
- Results are cached in memory: for 1 h after a success and 10 min after a failure.
- `PENGUIN_UPDATE_CHECK=off` disables the lookup entirely: the response carries `disabled: true`, and no network call is made.

That switch turns off this check and nothing else. Model requests, an enabled remote-control connection, owner-initiated provider key authorization and the proxy test go out whatever it is set to.

### GET /api/version/update

Admin only. Returns the self-update job's status: `{state: idle | running | done, targetVersion, phase?, percent?, output, result?, startedAt?, finishedAt?}`. The update dialog polls it while a run is in progress.

- While the job runs, `phase` is `resolving`, `downloading` or `installing`, and `percent` is read from the installer's progress bar.
- When the job is done, `result` is `{status, reason?, output, needsRestart}`.

The `status` in `result` is one of:

- `updated`: restart the service to run the new version.
- `failed`.
- `unsupported`: either the server was not started with `penguin server` or `penguin web` (`reason: "not_launched_via_cli"`), or the CLI refused to update (a source checkout, an unrecognized install layout, or Windows).

`output` carries the last part of the CLI's own output.

### POST /api/version/update

Admin only. Starts the self-update job, which runs `penguin update --yes` on the server host in the background. If a job is already running, the request joins it. The response is the status, exactly as `GET /api/version/update` returns it. A finished job can be started again as a retry.

### POST /api/version/restart

Admin only. Asks the process to exit with the supervisor's restart code after a graceful shutdown, so `penguin server` or `penguin web` relaunches it on the installed release. Returns `{restarting: true}`, or `{restarting: false, reason: "no_supervisor"}` when no supervisor runs the process.

## Projects and Members

Projects, their members, and the Project-wide settings stored in `.project_config.toml`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/projects` | The Projects visible to the current user |
| POST | `/api/projects` | Creates a Project: `{projectId, name?}` → 201 `{project}` |
| PATCH | `/api/projects/:projectId` | Renames a Project: `{name}` → `{project}` |
| DELETE | `/api/projects/:projectId` | Deletes a Project |
| GET | `/api/projects/:projectId/members` | Lists members |
| POST | `/api/projects/:projectId/members` | Adds a member: `{userId}` |
| DELETE | `/api/projects/:projectId/members/:userId` | Removes a member |
| GET / PUT | `/api/projects/:projectId/chat-defaults` | Reads / replaces the defaults a new chat starts with |
| GET / PUT | `/api/projects/:projectId/command-policy` | Reads / replaces the sandbox command policy |
| POST | `/api/projects/:projectId/suggest-id` | Proposes a semantic id for the display name of an object being created |

- `PATCH /api/projects/:projectId` is owner only and changes only the display name (1–100 characters). The Project id names its directory and never changes.
- `DELETE /api/projects/:projectId` is owner only. `default_project` is shared with the CLI and cannot be deleted: `409` `cannot_delete_default_project`.
- Member writes are owner only. In desktop mode the member routes also answer `403 desktop_single_user`; see [User Administration (admin only)](#user-administration-admin-only).
- `chat-defaults` is the `[default_chat]` block: `{agentId?, workspace?, approvalMode?, thinkingLevel?}`. Any member can read it, and only the owner can replace it. A PUT replaces the whole block: an omitted key clears that default, and an empty body removes the block. `agentId` must name an existing agent of the Project (otherwise `400` `unknown_agent`). `workspace` is a prefill and is not checked until a Session is created; an empty value means a temporary Workspace. `thinkingLevel` is the fallback for agents whose config sets none, and `none` is not accepted. The default model is not part of this block; it stays with the model routes.
- `command-policy` is the `[command_policy]` block: `{enabled?, rules: [{name, pattern, description?, enabled?}]}`. Any member can read it, and only the owner can replace it. A PUT always carries the full rule list (an empty array means no rules), with at most 64 rules. Each rule needs a name of up to 64 characters and a pattern of up to 512 characters that compiles as a regular expression, and a description may have up to 300 characters. A pattern that does not compile returns `400` `invalid_rule_pattern`, any other malformed rule returns `400` `invalid_rules`, and a non-boolean `enabled` returns `400` `invalid_enabled`. See [Command policy](/configuration#command-policy).

### Semantic id proposals

`POST /api/projects/:projectId/suggest-id` takes `{name, kind, taken?}` and returns `{id, source, reason?}`. `kind` is `project`, `agent`, `benchmark`, `org` or `channel`, and `taken` names the ids the proposal must avoid. It is the one route behind every **Generate with AI** button beside an id field.

- The default model of the Project in the path translates the name into one English id in the kind's spelling (`source: model`); the **New Project** dialog borrows the Project it was opened from. An answer that yields no id has the model asked once more, with the format spelled out.
- An ASCII slug of the name answers when no model is configured or neither answer is usable (`source: fallback`).
- A name neither path can name gets a dated placeholder (`source: placeholder`) with a `reason` of `no_default_model`, `model_failed`, `unusable_answer` or `no_ascii`: `project_<yyyymmdd>`, `agent_<yyyymmdd>`, `benchmark-<yyyymmdd>`, `co_org_<yyyymmdd>` or `ch_channel_<yyyymmdd>`, with the username in front for a non-admin's Project.
- The kinds differ only in the id's shape, the ids the server avoids on its own, and who may ask. `project` is snake_case for an admin and `<username>-<suffix>` for everyone else, and avoids every Project id on the server; `agent` is snake_case and avoids the Project's agents; `benchmark` is kebab-case, avoids the Project's Benchmarks and is owner only; `org` and `channel` carry the `co_` and `ch_` prefix, never doubled when the answer already has it, and return `404` `company_mode_off` while company mode is off. Every other caller must be a member of the Project.
- The ids the server avoids on its own are the names the kind's create route would refuse as taken, a leftover folder no list shows included. They never reach the prompt; a collision only adds a `_2` / `-2` suffix. A core the kind's rule rejects for starting with a digit or being one character long is retried behind the kind's noun (`3D Viewer` → `agent_3d_viewer`).
- The route never fails for a name it cannot translate, so a dialog that asked for an id always gets one. Every model dead end is recorded as an `id_suggest_failed` error, under the source `organization` for `org` and `channel` and `id_suggest` for the rest. The completion runs with thinking off and within the shared meta budget, belongs to no Session and is not metered.

## Models

Manage a Project's model table and probe model endpoints. Reading the table is open to any member; every other route here is owner only.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/projects/:projectId/models` | Lists models (`api_key` masked); a row with a running promotion carries it as `discount` |
| PUT | `/api/projects/:projectId/models` | Replaces the whole table, keyed by `(provider, modelId)`; an entry's `discount` stores or clears its promotion |
| PUT | `/api/projects/:projectId/models/default` | Sets the default model: `{provider, modelId}` → `{defaultModel}` |
| POST | `/api/projects/:projectId/models/test` | Tests connectivity: `{provider, modelId, …}` → `{ok, latencyMs?, message?}` |
| POST | `/api/projects/:projectId/models/detect` | Detects the protocol a custom base URL speaks |
| POST | `/api/projects/:projectId/models/list` | Lists the model ids an endpoint serves, for the add-group import |
| POST | `/api/projects/:projectId/models/detect-vision` | Probes whether a model accepts images |

Every route that names a model takes the complete `(provider, modelId)` pair. Nothing is inferred: a request that carries only half the pair is a 400, never a lookup. Where the model reference itself is optional (Session creation, schedules), omitting both halves selects the Project's default model.

A row's `pricing` is always the list price. A promotion, a fraction above 0 and below 1 taken off that price, is never written to `.project_config.toml`: the server keeps it per row in `web.db` and applies it when it prices usage. On `PUT /models`, an entry's `discount` decides it outright — a number stores the promotion, `null` clears it, and any other value is a `400` before anything is written. An entry that omits `discount` keeps the stored promotion, unless it renames the row (`renamedFrom` naming another pair) or its `pricing` differs from the stored one, in which case the promotion is cleared. A row left out of the new table takes its promotion with it.

- `PUT /models` also invalidates the Project's cached Session runtimes, with the same effective-value semantics as a vault update. A run already in progress is not switched over, but the next Task on any Session of the Project reloads its runtime and reads the new `api_key` / `base_url`. The route also publishes a `credentials_updated` event to the Project's open Session channels (see [Streaming (SSE)](#streaming-sse)). The models response carries `updatedAt`, the config file's modification time, which the Web App compares with the last auth failure to decide whether a composer disabled by that failure stays disabled.
- `PUT /models/default` changes only the default model, without resending the table or its credentials. The pair must name a configured entry, otherwise the route returns 400. Existing Sessions keep the model they were created with, so the route neither invalidates runtimes nor publishes `credentials_updated`.
- `POST /models/detect` probes `openai-responses`, then `ant-messages`, then `openai-chat`. It tries the URL as typed first (normalized, with any pasted endpoint path stripped), then the same URL with `/v1` added or removed, and reports the first protocol served and the base URL that served it: `{baseUrl, apiKey?, …}` → `{detected?, baseUrl?, probes}`.
- `POST /models/list` returns the ids the endpoint serves on a detected protocol: `{baseUrl, clientType, apiKey?}` → `{ok, models?, unsupported?, message?}`.
- `POST /models/detect-vision` sends one 1x1 image with this model's credential, which is a real, billed completion: `{provider, modelId, apiKey?, baseUrl?, clientType?}` → `{outcome: supported|unsupported|failed, message?}`.

### Provider key minting

A provider group that publishes an authorization flow in the built-in catalog can mint a new API key for the user in the browser, so the user does not have to copy one out of a console. These routes are owner only, except the redirect receiver `GET /callback`, which answers without a session and can only hand the code it was redirected with to the flow (see below).

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/projects/:projectId/model-oauth/start` | Opens a flow: `{provider, mode?: callback\|manual}` → `{flowId, authorizeUrl}` |
| GET | `/api/projects/:projectId/model-oauth/callback` | Where the provider redirects (`?flow=&code=`): stores the code on the flow and answers with an HTML page. `HEAD` answers 405 |
| GET | `/api/projects/:projectId/model-oauth/:flowId` | Polls a flow, redeeming a stored code and applying the key: `{status: pending\|done\|error, provider, error?}` |
| POST | `/api/projects/:projectId/model-oauth/:flowId/code` | Redeems a code the user pasted: `{code}` → `{ok, applied?, error?}` |

The server generates the PKCE verifier, keeps it in memory for ten minutes and never sends it to a client. The minted key goes straight into the provider group's models and is never returned, logged or put in a URL. A flow belongs to one user in one Project and can be used once: a second redemption is refused, and `/start`, `/:flowId` and `/:flowId/code` refuse anyone except that user.

`GET /callback` has to be the exception. A loopback OAuth redirect arrives in whichever browser the provider redirected, which is not necessarily the one that started the flow. The desktop shell, for example, opens the authorization page in the *system* browser, which holds no cookie for the app's origin. So this one path is mounted outside the session gate and authorizes with the flow id instead: 32 random bytes, valid for ten minutes and usable for one deposit. A deposit is accepted only for the Project the flow was opened in, and only for a flow that asked for a callback: a `manual` flow is refused, because it was never given a callback URL.

What the callback may do is limited a second time: it stores the code on the flow and nothing else. The exchange with the provider and the write into the Project's models both happen on `GET /:flowId`, the owner's own poll, behind the session gate. No key reaches a Project unless its owner asks for the flow's status, and a failed exchange is reported there as `{status: error, error}` rather than on the redirect page. Nothing next to the callback is exempt either: a longer path, any other method (`HEAD` on the exact path answers 405), and the three sibling routes all still require a session.

`mode: manual` sends no callback URL, so the authorization page shows a one-time code for the user to paste back, for deployments the redirect cannot reach. Whichever route redeems the code, a completed flow invalidates cached runtimes and publishes `credentials_updated`, exactly as `PUT /models` does.

### Penguin Go key authorization

Penguin Go delivers its key through a device authorization the server polls, not through a redirect, so it has routes of its own. All of them are owner only. The browser is handed a local flow id and an authorization URL, and never the device secret, the delivered key or anything else the platform returns.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/projects/:projectId/platform-auth/start` | Opens a one-time flow, with the platform's deadline capped locally at ten minutes: → 201 `{flowId, authorizeUrl, expiresAt}` |
| POST | `/api/projects/:projectId/platform-auth/sync` | Fetches the platform catalog with the stored key, adds the models the Project lacks and refreshes platform-owned fields: → the model table plus `added` and `updated` counts |
| GET | `/api/projects/:projectId/platform-auth/:flowId/status` | Polls Penguin Go from the server, then writes the delivered key across the group and adds the platform's models: `{status: pending\|applying\|completed\|cancelled\|apply_failed\|error, error?, applied?}` |
| POST | `/api/projects/:projectId/platform-auth/:flowId/retry` | Retries the local write after it failed; the single-use delivery is not requested again, and a flow in any other state answers `409 platform_auth_not_retryable` |
| POST | `/api/projects/:projectId/platform-auth/:flowId/cancel` | Cancels the local flow; the platform's pending record expires on its own TTL |

The server validates the delivered key, the endpoints and the catalog before it writes anything. It then writes the key to every existing `penguin-go` entry, creates the models the platform advertises and the Project does not have, refreshes the list price and client protocol of the ones it does, and replaces the group's stored promotions with the platform's. Endpoints and other Project-owned fields are preserved, nothing is deleted, and a non-empty catalog creates the group when it is missing. A completed write invalidates cached runtimes and publishes `credentials_updated`, exactly as `PUT /models` does.

A flow id that names no live flow is `404 platform_auth_flow_not_found`. `sync` answers `409 platform_reauthorization_required` when there is no stored key or the platform rejects it, and `502 platform_sync_failed` when the platform refuses the catalog or returns one that does not parse; the platform being unreachable is `502 platform_unreachable`. A delivery the server could not write locally leaves the flow in `apply_failed`, which is what the retry route is for.

## Agents

The paths below omit the `/api/projects/:projectId` prefix, except the two global `/api/plugins` routes.

| Method | Path | Description |
| --- | --- | --- |
| GET / POST | `/agents` | Lists agents / creates one |
| DELETE | `/agents/:agentId` | Deletes an agent (owner only) |
| GET / PUT | `/agents/:agentId/config` | Reads / writes the config (`AGENTS.md` and `system_config.yaml`; PUT preserves YAML comments) |
| POST | `/agents/:agentId/config/mcp-test` | Tests one MCP server entry: `{name, config}` → `{ok, tools?, error?, latencyMs?}` |
| POST | `/agents/:agentId/config/kernel-update` | Merges the config up to the current defaults: → `{advanced, kept, kernelVersion}` |
| POST | `/agents/:agentId/config/reset` | Overwrites `system_config.yaml` with the current defaults and returns the fresh config |
| GET / PUT | `/agents/:agentId/vault` | Vault environment variables (values masked; PUT replaces all of them and is owner only) |
| POST | `/agents/:agentId/vault/template-placeholder` | Inserts the `{{VAULT}}` placeholder into the prompt template (owner only) |
| GET | `/agents/:agentId/memory` | Memory overview |
| POST | `/agents/:agentId/memory/template-placeholder` | Inserts the `{{MEMORY}}` placeholder into the prompt template |
| GET | `/agents/:agentId/memory/scopes/:key/files` | Lists one scope's topic files |
| GET / DELETE | `/agents/:agentId/memory/scopes/:key/files/:name` | Reads one topic file / deletes it |
| GET | `/agents/:agentId/memory/scopes/:key/export` | Exports one scope as a single JSON document |
| POST | `/agents/:agentId/memory/scopes/:key/import` | Writes an exported scope back (owner only) |
| GET | `/agents/:agentId/export` | Exports the Agent State snapshot (tar.gz download) |
| POST | `/agents/:agentId/import` | Imports a snapshot: `{dataBase64, confirm?}`; 409 on a version conflict without `confirm` |
| GET | `/agents/:agentId/skills` | Installed Skills (library installs go through `/plugins`) |
| POST | `/agents/:agentId/skills/template-placeholder` | Inserts the `{{SKILLS}}` placeholder into the prompt template |
| POST | `/agents/:agentId/skills/archive` | Installs a Skill from a zip: `{dataBase64, overwrite?}` → 201 with the Skill list |
| GET | `/agents/:agentId/skills/:name/archive` | Exports an installed Skill as a zip |
| DELETE | `/agents/:agentId/skills/:name` | Uninstalls a Skill |
| POST | `/agents/:agentId/plugins` | Installs library plugins by name: `{names}` → 201 `{skills, hooks}` |
| GET | `/agents/:agentId/hooks` | Installed hook packages |
| POST | `/agents/:agentId/hooks/archive` | Installs a hook package from a zip: `{dataBase64, overwrite?}` |
| GET | `/agents/:agentId/hooks/:name/archive` | Exports an installed hook package as a zip |
| DELETE | `/agents/:agentId/hooks/:name` | Uninstalls a hook package |
| GET | `/api/plugins` (global) | The plugin library by category (any signed-in user) |
| GET | `/api/plugins/:plugin/files` (global) | The files one library plugin ships, as text keyed by path (any signed-in user) |

### Agent routes

- `POST /agents` takes `{agentId, name?, description?, plugins?, skillsDirectory?, directorySkills?, dataBase64?}` and answers 201 `{agent}`. `plugins` names library plugins to preinstall, and unknown names are rejected before the agent's directory exists. `skillsDirectory` and `directorySkills` import Skills from a directory the user picked (see `GET /dir-skills` under [Session Creation and Directory Browsing](#session-creation-and-directory-browsing)) and must be sent together. `dataBase64` starts the agent from an exported snapshot instead of the default template.
- `POST …/config/mcp-test` connects to one MCP server entry from this host, lists its tools and disconnects, and writes nothing to the Agent State. A malformed entry returns 400. An unreachable server is a normal `{ok: false, error}` result.
- `POST …/config/kernel-update` is the non-destructive sibling of `reset`. It moves settings tabs that are absent or still hold an old default up to the current defaults (`advanced`), keeps customized tabs whole (`kept`), and writes the new defaults generation (`kernelVersion`).
- The `template-placeholder` routes are idempotent. The vault and Skills routes insert `{{VAULT}}` or `{{SKILLS}}` into the prompt template, or turn a legacy hard-coded `# Vault` or `# Skills` section into the placeholder. The Memory route inserts `{{MEMORY}}` and is how an agent created before Memory adopts it.
- `POST …/skills/archive` accepts a zip of up to 14MB. Without `overwrite`, a Skill that is already installed returns 409 `skill_exists`. `GET …/skills/:name/archive` names the file `<name>.zip`, or `<name>-v<version>.zip` when the Skill's `SKILL.md` declares a version. The export and uninstall routes return 404 `not_found` for a Skill that is not installed.

### Memory

- `GET …/memory` returns the Memory switch, whether the prompt template carries `{{MEMORY}}`, and one entry per scope: the user scope (`user`, `kind: "user"`) first, then the Workspaces.
- In the scope routes, `:key` is a workspace key or `user`.
- `GET …/scopes/:key/files` lists one scope's topic files with their frontmatter and file stats.
- `DELETE …/scopes/:key/files/:name` deletes a topic file and removes its lines from the `MEMORY.md` index.
- `GET …/scopes/:key/export` returns every topic file of the scope plus its `MEMORY.md` as one JSON document, downloaded as an attachment.
- `POST …/scopes/:key/import` takes `{payload, mode?, confirm?}`. `mode` is `skip` (the default, which adds only names the scope lacks), `overwrite` (which replaces same-named files) or `replace` (which also deletes what the document omits). Anything that would overwrite or delete needs `confirm`, otherwise the route returns 409 `memory_import_confirm_required`.

### Plugins and hooks

- `POST …/plugins` installs each named plugin's Skills and hook package, and reinstalling updates them. An unknown name returns 404 `unknown_plugin`, and nothing is written.
- `GET …/hooks` returns each installed hook package's name, description, version, hook points and plugin icon.
- `POST …/hooks/archive` expects `hooks.json` and its scripts at the root of the zip or inside one top-level directory, and every listed command must name a file inside the package. Without `overwrite`, an installed package of the same name returns 409 `hook_exists`. The zip that `GET …/hooks/:name/archive` exports can be installed again through this route.
- `GET /api/plugins` returns every library plugin by category, with its Skills' metadata and hook points.
- `GET /api/plugins/:plugin/files` returns everything one library plugin ships, as text keyed by path: each Skill's installable `SKILL.md` and reference files under `skills/<name>/`, and the hook scripts under `hooks/`. The plugin detail view's file browser uses it.

## Plugin Registry and Project Plugins

The plugins in this section are server-side packages: modules the server loads into its own module tree, such as the sandbox backends. They are not the library plugins installed on an agent, which are covered under [Plugins and hooks](#plugins-and-hooks). The registry routes are global and open to any signed-in user; the installed-plugin routes belong to one Project.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/plugins/registry` | The plugin index: `{plugins: PluginIndexEntry[]}` |
| GET | `/api/plugins/registry/readme?name=…` | One listed entry's readme: `{name, readme}` |
| GET | `/api/projects/:projectId/plugins/installed` | The plugins this Project asks for, joined with what the process runs: `{plugins, shipped, file, restartPending}` |
| POST | `/api/projects/:projectId/plugins/installed` | Admin only. Adds a plugin the build ships: `{specifier}` |
| PUT | `/api/projects/:projectId/plugins/installed` | Admin only. Replaces the list: `{plugins}` |
| DELETE | `/api/projects/:projectId/plugins/installed?specifier=…` | Admin only. Removes a plugin from the list |

- The index follows the schema of typst/packages' `index.json`: a flat array of per-version entries with `name`, `version`, `description`, `authors` and `license`, plus optional `repository`, `homepage`, `keywords`, `categories` and `updatedAt`. An entry's `name` is the package name a Project's list uses. The index currently comes from a single registry built into the server, which lists the four sandbox backends. A registry is for discovery only and never imports plugin code.
- `GET …/readme` returns the package's own `README.md`, read from the copy on this machine; `readme` is `null` when there is none. A name the index does not list returns `404` `not_found`, and a request without `name` returns `400` `bad_request`.
- `GET …/installed` is open to any member of the Project. Each entry in `plugins` is `{specifier, active, builtin, modules, replaces, error?}`: `active` means the process has loaded the package, `builtin` that it ships with this build, `modules` and `replaces` are the nodes its generated `ifaces.json` declares, and `error` says why it is not running, such as a package that is not on this machine or a load that failed. `shipped` lists every plugin package the build ships, asked for or not. `file` names the file that holds the list. `restartPending` is true when a listed plugin is neither running nor failed, which a server restart resolves. A Project whose `.project_config.toml` cannot be read returns `400` `invalid_plugins_file`.
- The writes answer with the same body as the GET. A specifier must be a package name, never a path, a URL or a version range (`400` `bad_request`). A name that enters the list must be a package the build ships, otherwise the route returns `400` `plugin_not_shipped`: nothing is downloaded. `PUT` sends names only, and a name that stays in the list keeps the requirement the file records for it. `DELETE` edits the list only and removes nothing from disk.
- A write takes effect without a restart: the App [re-assembles itself](/server-boot#re-assembly) around the new list, with the effects of a hot swap. Agent runs in progress are stopped in every Project, because all Projects share one module tree. If the new App fails to boot, the edit is undone and the previous App is restored.
- The list is the `[plugins]` table of the Project's `.project_config.toml` (see [Project config](/configuration#project-config)). The process loads the union of every Project's table, so a plugin one Project asks for is loaded for all of them.

## Schedules

The paths below omit the `/api/projects/:projectId` prefix.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/schedules` | Every agent's scheduled tasks in the Project in one list, each stamped with its `agentId` (any member) |
| GET / POST | `/agents/:agentId/schedules` | Lists scheduled tasks / creates one (409 if the name exists) |
| POST | `/agents/:agentId/schedules/template-placeholder` | Inserts the `{{SCHEDULES}}` placeholder into the prompt template (idempotent) |
| GET / PUT / DELETE | `/agents/:agentId/schedules/:name` | Reads / updates / deletes a single task |

Schedule writes are owner only. A task in new-Session mode carries `modelId` and `provider` together or not at all. The pair is checked against the Project's model table when the task is saved, and again when the scheduler reconciles it.

## Benchmarks

Benchmarks belong to the Project, not to an agent: one Benchmark can evaluate any number of agents, and each evaluation names the agent it tested (`agentId`, or `null` for a record that names none). A summary's `agentIds` lists those agents in the order they first appear. The paths below again omit the `/api/projects/:projectId` prefix.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/benchmarks` | Benchmark scoring data |
| POST | `/benchmarks` | Creates a Benchmark by hand (owner only) |
| DELETE | `/benchmarks/:benchmarkId` | Deletes a Benchmark directory with its cases, config and scoreboard (owner only; 204, or 404 when absent) |
| GET | `/benchmarks/:benchmarkId/cases` | A Benchmark's cases: each case's id and the heading of its statement README. Rubrics are never returned |
| GET | `/benchmarks/:benchmarkId/cases/:caseId/files` | Browses one case's `statement/` |
| GET | `/benchmarks/:benchmarkId/cases/:caseId/files/content` | Reads one file of the statement (`?path=`, `?preview=1`, `?download=1`) |
| GET | `/benchmarks/:benchmarkId/cases/:caseId/rubric/files` | Browses one case's `rubric/` |
| GET | `/benchmarks/:benchmarkId/cases/:caseId/rubric/files/content` | Reads one file of the rubric, with the same parameters |

- `GET /benchmarks` lists only directories that hold a `benchmark_config.toml`. A directory without one, which is what a Benchmark deleted during an evaluation leaves behind, is skipped. Each entry carries `status`: `draft` while the Skill is still building the Benchmark, `failed` when its calibration never finished, and `published` otherwise.
- `POST /benchmarks` takes `{id, title, description?, runs?, cases: [{id, title, statement, rubric}]}` and answers 201 `{benchmark}`. The server writes `benchmark_config.toml` (with `status = "published"`), a `scoreboard.yaml` with `evaluations: []`, and each case's `statement/README.md` (with the title as its heading) and `rubric/README.md`. Ids use the same characters as agent ids, and case ids start with `CASE-`. If the directory already exists, the route returns 409 `benchmark_exists`.
- The file-content routes apply the same inline hardening as Workspace files; see [Workspace file responses](#workspace-file-responses).

## Organizations (company mode)

All paths below are under `/api/projects/:projectId/organizations`. While the server's company-mode switch is off, every route answers `404` `company_mode_off` (see [Company mode switch](#company-mode-switch)). Any Project member can read and write. No route deletes an organization: `status` (`active` / `paused`) is the off switch, and a paused organization keeps its conversations, employees, desks and tickets. For the files behind these routes, see [Company Mode](/company-mode).

| Method | Path | Description |
| --- | --- | --- |
| GET / POST | `/` | Lists organizations / creates one |
| GET / PATCH | `/:orgId` | The organization's overview / changes its settings |
| GET | `/:orgId/chart` | The employee tree, with each employee's live state, desk and spend for the period |
| POST | `/:orgId/employees` | Hires an employee: an existing agent or a new one |
| PATCH / DELETE | `/:orgId/employees/:agentId` | Changes an employee / removes the employee from the organization |
| GET / POST | `/:orgId/employees/:agentId/desk` | The desk session, opened when missing / a renewed desk session |
| GET / PUT | `/:orgId/handbook` | The handbook index (`handbook/README.md`) |
| GET | `/:orgId/handbook/files` | The knowledge-base files, the index first |
| GET / PUT / DELETE | `/:orgId/handbook/files/<path>` | One document by relative path; the index cannot be deleted |
| GET / POST | `/:orgId/calendar` | Every employee's events with their run state / creates an event |
| GET / PUT / DELETE | `/:orgId/calendar/:agentId/:name` | One event |
| GET / POST | `/:orgId/tickets` | The board by column, plus files that could not be parsed / creates a ticket |
| GET / PUT | `/:orgId/tickets/:ticketId` | Ticket detail / updates the ticket |
| POST | `/:orgId/tickets/:ticketId/move` | `{status, reason?}`; moving into `rejected` needs a reason |
| POST | `/:orgId/tickets/:ticketId/block` | `{reason, by?}`, where `by` is a ticket id or a principal; the ticket stays in its column |
| POST | `/:orgId/tickets/:ticketId/unblock` | Clears the block |
| POST | `/:orgId/tickets/:ticketId/progress` | `{text}`: appends one plain sentence to `## Progress` |
| POST | `/:orgId/tickets/:ticketId/start` | `{agentId?, message?, workspace?}` → 202 `{sessionId}`: starts a ticket session |
| POST | `/:orgId/tickets/:ticketId/attach` | `{sessionId}`: records an existing session as contributing |
| GET / POST | `/:orgId/channels` | The channels the caller may see, `default_channel` first / opens a channel |
| GET / PATCH | `/:orgId/channels/:channelId` | The channel and its members / renames it, changes `purpose`, sets `archived` |
| POST | `/:orgId/channels/:channelId/members` | `{principal}`: adds a member |
| DELETE | `/:orgId/channels/:channelId/members/:principal` | Removes a member |
| GET / POST | `/:orgId/channels/:channelId/messages` | A day's messages with the caller's unread and mention counts / sends a message |
| POST | `/:orgId/channels/:channelId/read` | `{upTo}`: the caller's read cursor in this channel |
| GET | `/:orgId/finance` | Spend per employee (own and cumulative along the reporting line) and per ticket (rolled up along `Parent`), the daily trend and alerts; `?period=yyyy-mm` |
| GET | `/:orgId/sessions` | The organization's desk sessions, and its ticket sessions grouped by ticket. A desk whose Session has an enabled messaging binding carries its `messagingChannel`, as the Session's own row does |

### Caller identity

Write bodies may carry `agentId` and `sessionId`, the calling employee and the calling session, which the CLI fills in from `PENGUIN_AGENT_ID` and `PENGUIN_SESSION_ID`. The file then records the employee rather than the token's user: `agentId` wins when it names an employee, and the session decides otherwise. The channel reads and the member DELETE have no body, so they take the same pair as `?agentId=` / `?sessionId=`. The server honours both only on requests that carry the local API token; that is how an employee is answered as itself instead of as the signed-in person.

### Organizations

- `POST /` takes `{orgId, mission, name?, timezone?, workspace?, model?, ceoBudget?, language?}` and answers 201 with the organization detail. Creating an organization also creates the CEO agent and opens its desk with an initialization run. The route returns 409 when the id or the CEO's agent id is taken. The CEO's chart entry is written with `workspace: ceo`, a partition of the shared workspace like every other employee's.
- `ceoBudget` is the CEO's monthly budget in USD, written as the `budget` of the CEO's `org_chart.yaml` entry. It must not be negative and defaults to 100. Budgets are compared along the cumulative line, so this is the whole company's cap.
- `language` is `zh` or `en`, the working language of everything the organization writes. If omitted, it is detected from the mission.
- `GET /:orgId` returns the overview: settings, board counts, today's calendar, pending items, the all-hands channel's recent messages, `inbox` and alerts. The settings always carry the effective `language`, read from the mission when the file has none.
- `PATCH /:orgId` changes the name, mission, `status` (`active` / `paused`; pausing stops every automatic trigger), `approvalMode`, `timezone`, `language` and thresholds.

An organization's and a channel's id proposals come from the Project-level route, `POST /api/projects/:projectId/suggest-id` with `kind: org` or `kind: channel`; see [Semantic id proposals](#semantic-id-proposals).

### Employees

- `POST /:orgId/employees` takes `{agentId}` for an existing agent or `{newAgent: {agentId, name?, description?, plugins?}}` for a new one, plus `title`, `reportsTo`, `workspace?`, `budget?`, `duties?` and `model?`.
- `workspace` defaults to a subdirectory named after the employee's agent id, because the root of the shared workspace holds the shared inputs and is nobody's desk. A relative `workspace` is normalized (`./hr` → `hr`) and created under the shared workspace. An absolute one must already exist. One that climbs out with `..` returns 400 `invalid_workspace`.
- `PATCH /:orgId/employees/:agentId` changes the title, manager, workspace (created and validated as on hire), budget (`null` clears it), duties and model.
- `DELETE /:orgId/employees/:agentId` removes the employee from the organization: its subordinates move up to its manager. The CEO cannot leave.

### Calendar

`POST /:orgId/calendar` takes `{agentId, name, prompt, enabled, startAt, period?, endAt?, title?}` and answers with the stored event plus advisory `warnings`, one line each:

- another employee's recurring event on the same start minute
- a second recurring event for the same employee with the same period
- a recurring event that starts at `now`

Warnings never block the write. `PUT /:orgId/calendar/:agentId/:name` answers the same way as the create, `warnings` included.

### Tickets

- `POST /:orgId/tickets` takes `{title, goal?, acceptanceCriteria?, body?, owner?, parent?, notify?, priority?, due?, slug?}`.
- `owner` is the one principal responsible: an employee (a bare agent id or `agent:<id>`) or a Project member (`user:<id>`). It defaults to the caller. When `notify` is absent, the owner becomes the whole `notify` list, but only if the owner is an employee, so a person is not @-mentioned about a ticket they own. Who filed the ticket is the `created` entry of its `history`.
- The id's slug comes from `slug` when given, which must be lowercase English words joined by hyphens (400 otherwise). Without `slug`, it comes from the title. A title that yields fewer than two words is passed to the Project's model, and if that also fails, 400 `slug_required` asks the caller to name the slug.
- `GET /:orgId/tickets/:ticketId` returns the frontmatter fields, the prose sections, `progress` as plain sentences, `history`, the contributing sessions, child tickets and the rolled-up cost.
- `PUT /:orgId/tickets/:ticketId` takes `{title?, owner?, parent?, notify?, priority?, due?, goal?, acceptanceCriteria?, result?}`. `owner` does not accept `null`: a ticket always has an owner, who can be replaced but not removed. `parent` and `due` accept `null` to clear them.
- `POST …/progress` records who wrote the sentence, and when, as a `progress` entry appended to `history`.

`POST /:orgId/tickets/:ticketId/start` starts a ticket session for an employee and records it in the ticket's `sessions` and `history`. It is the one route whose `agentId` is not an identity claim: it names the employee the session runs as. Who may start a session depends on the caller:

- A person may start a session on any ticket. `agentId` names the employee and defaults to the owner.
- A caller writing as an employee (a desk or ticket session sending its own `sessionId`) may start one only for a ticket it owns. For anyone else's ticket, or a ticket with no employee owner, it gets 403 `not_ticket_owner`.
- An owner may still pass `agentId` to bring a colleague onto its own ticket.

### Channels

- `GET /:orgId/channels` lists every channel the caller may see: all of them for a person, and the ones it belongs to for an employee.
- `POST /:orgId/channels` takes `{channelId, name?, purpose?}` and answers 201 with a channel whose only member is its creator; 409 when the id is taken.
- `PATCH /:orgId/channels/:channelId` can set `archived` only for people, and never on `default_channel`.
- `POST …/members` lets any member invite an `agent:<id>` employee or a `user:<id>` Project member. A person may add itself; an employee may not. Adding an existing member is a no-op that returns 201.
- `DELETE …/members/:principal` lets anyone remove itself, and a person remove anyone; an employee can only remove itself. Removing a non-member is a no-op that returns 204.
- `GET …/messages` takes `?date=yyyy-mm-dd`, which defaults to today in the organization's timezone. `POST …/messages` sends `{text, refs?}`; mentions are resolved from the text and must all be channel members.

A `system` line carries a `notice` beside its English `text`: a `kind` and string `params`, so a client can render the sentence in the reader's language. Lines written before this field existed have none. `kind` is one of `employee_joined`, `employee_left`, `channel_created`, `channel_archived`, `channel_unarchived`, `channel_joined`, `channel_invited`, `channel_left`, `channel_removed`, `budget_warned` and `budget_paused`, or one of the legacy `ticket_blocked`, `ticket_done` and `ticket_rejected`. Nothing writes the legacy kinds any more; they remain so that lines already on disk still render.

Channel errors:

| Code | Status | Meaning |
| --- | --- | --- |
| `channel_not_found` | 404 | The channel does not exist; also returned for an id no channel could have |
| `channel_exists` | 409 | The channel id is taken |
| `channel_archived` | 409 | The channel is archived and takes no writes until it is unarchived |
| `not_a_member` | 403 | Reading, posting or inviting without membership, or an employee attempting a people-only action |
| `all_hands_immutable` | 400 | Archiving `default_channel` or editing its membership |
| `mention_not_member` | 400 | The message mentions principals that are not channel members; nothing is written |
| `invalid_principal` | 400 | The principal is malformed |

### Events and triggers

Company mode publishes `org_run`, `org_channel`, `org_ticket` and `org_budget` on the user event stream `GET /api/events`; see [Streaming (SSE)](#streaming-sse).

Only three things drive a desk session: a calendar event, an `@`-mention in a channel, and a person talking to it. The CEO's initialization run at creation is the one exception.

A ticket write starts no run. `move`, `block`, `unblock` and an owner change through `PUT /:orgId/tickets/:ticketId` are recorded in the ticket file and published as an `org_ticket` event, and they are queued for the employees they concern. Each employee's next calendar event lists them in its body under `## Since your last sweep`, one line per change. The queue survives a paused organization or employee and is delivered by the sweep that eventually fires. An employee that leaves takes its undelivered lines with it.

## Session Creation and Directory Browsing

The paths below omit the `/api/projects/:projectId` prefix.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/agents/:agentId/sessions` | Lists the agent's Sessions with their run state, whichever client created them, unless `excludeOrg=1` asks for the user's own rows only |
| POST | `/agents/:agentId/sessions` | Creates a Session: `{modelId?, provider?, workspace?, approvalMode?, client?, source?}` → 201 `{session}` |
| GET | `/dirs?path=` | Server-side directory browser behind the Workspace picker |
| GET | `/dir-skills?path=` | The Skills a directory carries, for importing them into a new agent |

- The Session list accepts optional query parameters. `limit` and `offset` page the list (`offset` requires `limit`). `category` (`active`, `subagent`, `schedule`, `benchmark` or `archived`) filters it before paging, and `workspaceGroup` filters it to one Workspace. `counts=1` adds `counts` (totals per category over the whole list), `workspaceCounts` (the same totals per Workspace path) and `workspaceLatest` (each Workspace's newest Session). Without paging parameters, the full list is returned.
- `excludeOrg=1` leaves an organization's desk, ticket and subagent Sessions out of the page and out of the `counts=1` totals together, which is what development mode's list asks for. Any other value is a 400.
- On creation, `modelId` and `provider` go together: send the complete pair to pick a model, or omit both to use the Project's default model. Sending only one is a 400.
- An explicit `workspace` must be an existing directory; it is never created. When omitted, the Workspace is a temporary one created automatically. The approval mode defaults to `allow-all`.
- `client` is a provenance hint stored on the row: `"cli"` from the CLI, `"web"` by default. The server itself writes `"org"` on an organization's desk and ticket sessions, and a client cannot send that value. Only `excludeOrg` reads it as a filter, and only to drop those rows.
- `source` accepts only `"benchmark"`, for a Session created by a Benchmark evaluation or optimization. The server sets `subagent` and `schedule` itself.
- `GET /dirs` starts at the home directory when `path` is omitted; an explicit `path` must be absolute. It answers `{path, parent, entries}` with the subdirectories only, and an unreadable directory lists as empty so the user can still go back up.
- `GET /dir-skills` reads only `<path>/.agents/skills` and `<path>/.claude/skills` of an absolute `path`, and answers `{path, skills}`. A directory without Skills answers with an empty list. See `POST /agents` under [Agents](#agents).

## Usage and Traces (Agent Level)

The paths below omit the `/api/projects/:projectId` prefix.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/usage` | Usage statistics |
| GET | `/usage/model-totals` | Lifetime Token total per model; takes no filters |
| GET | `/usage/errors` | One page of the error detail table, newest first: → `{items, total}` |
| DELETE | `/usage/errors` | Empties the error table for the current filter: → `{deleted}` (Project owner only) |
| GET | `/agents/:agentId/traces` | Trace files as a date → Session drill-down |
| GET | `/agents/:agentId/traces/:sessionId/:index` | Reads Trace events (`offset` / `limit` pagination) |
| GET | `/agents/:agentId/traces/:sessionId/:index/analysis` | Trace performance analysis |
| GET | `/agents/:agentId/traces/:sessionId/:index/download` | Downloads the raw Trace file (JSONL attachment) |
| POST | `/agents/:agentId/traces/import` | Imports a Trace file: `{dataBase64}` → `{sessionId, index, date}` |

`GET /usage` takes these query parameters:

| Parameter | Description |
| --- | --- |
| `from`, `to` | Date range, as `yyyy-mm-dd` |
| `fromTs`, `toTs` | ISO timestamps bounding a trailing window. Given together; required for `minute` |
| `groupBy` | `date`, `agent`, `model` or `session`; default `date` |
| `granularity` | Time-series precision: `minute`, `hour`, `day`, `week` or `month`; default `day`. Combinations of range and precision that would be too large are rejected |
| `agentId`, `provider`, `modelId` | Filters |

- `GET /usage/errors` takes `offset`, `limit`, the same `from` / `to` / `fromTs` / `toTs` / `agentId` filter, and an optional `kind` (`unexpected` or `expected`).
- `DELETE /usage/errors` takes the same filter as the reads, `from` / `to` / `fromTs` / `toTs` / `agentId`, but no `kind`, because the panel offers no such control. `from` and `to` are both required here (400 otherwise), because an open bound would clear the whole history rather than a filtered part. The clear reaches exactly what the caller's reads reach: an admin's clear also removes the unattributed rows that only an admin's read shows, and a member's clear never does.
- `GET /agents/:agentId/traces` also accepts `limit` and `offset` for paging, and `category` (which requires `limit`) to list one category of Sessions.
- Any member can download a Trace. Import is owner only, like the Agent State snapshot import, and capped at 14MB. The imported file must be valid Trace JSONL whose first record is a `session_meta` with a filename-safe `session_id`. A session id the agent already has is rejected (409 `trace_session_exists`), so an imported file always becomes index 001 of a new Session, stored in the local date directory of its first record's timestamp.

## Session-Level Endpoints

The paths below omit the `/api/sessions/:sessionId` prefix. For the storage model behind Sessions and Traces, see [Sessions and Traces](/sessions-and-traces).

Two conventions apply to every route here. A Session the caller cannot access always returns `404` `session_not_found`, so its existence is never revealed. And only one Task or compaction runs in a Session at a time: a conflicting request returns 409 (`task_in_progress` / `compacting`).

### Session and history

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Session info |
| PATCH | `/` | Updates the Session: `{approvalMode?, thinkingLevel?, archived?, title?}` |
| DELETE | `/` | Deletes the Session, with its Traces and scratch files |
| GET | `/messages` | The OmniMessage history, in full or as a window of Tasks |
| POST | `/fork` | Forks an idle Session after a completed assistant reply: `{position: {fileIndex, ordinal}}` → `{session}` |
| GET | `/stream` | The SSE event stream; see [Streaming (SSE)](#streaming-sse) |
| GET | `/context` | What the current model context is made of, and where compaction will start |
| GET | `/goal` | The Session's most recent goal run |

- `GET /` returns the Session's info. Unlike the list rows, the single-Session response also carries `tracePath`, the absolute path of the latest Trace file. `orgId` marks a Session that company mode's caches own (a desk session, or a session contributing to one of that organization's tickets); it is absent on every ordinary Session, and the list route sets it too.
- `PATCH /` with `thinkingLevel` pins the level on this Session durably, from its very next LLM request. The thinking level is soft-limited: it can change mid-context, at the cost of the provider's cached context, which is why the level picker advises compacting first. The pinned level comes back as `SessionInfo.thinkingLevel`; when that is absent, no level was ever pinned and the agent config applies.
- `GET /messages` without parameters returns the full OmniMessage history. `tailLimit=n` reads the newest n Task-aligned units instead, and `before=<cursor>&limit=n` reads the n units before a cursor. The two forms are exclusive, `n` is between 1 and 1000, and `limit` defaults to 200. The bundled Web App opens a conversation on its latest 50 turns and loads earlier ones as you scroll. A windowed response carries `page`, with the cursor for the next page (`before`), the number of turns before the window (`earlierTurns`) and the cumulative stats before it (`prior`). While a Task runs, the response also carries `live`; see [The live field on GET /messages](#the-live-field-on-get-messages).
- `GET /context` returns the parts the current model context is made of, plus `compactionThreshold`: the context size, in tokens, at which the Session's next request starts compaction. That threshold is the agent's `compaction.max_context_length`, capped by the room the model's context window leaves. It is `null` when compaction is disabled, when the agent's config cannot be read, or when the threshold is not below the window. The route reads the newest Trace file on every call, so the figures are a snapshot rather than a live counter.
- `GET /goal` returns `{goal}`, which is `null` if the Session never ran a goal, or otherwise `{objective, status, budget, used, rounds}`. `status` is `active`, `complete`, `blocked`, `budget_limited` or `aborted`, and a `budget` of -1 means unlimited. A goal lives only inside its run, so a goal that still reads as active while the Session is not running is reported as `aborted`. See [Goal mode](/goal-mode).

### The `live` field on GET /messages

The Trace stores only complete messages, and streaming `partial_*` messages never reach disk, so history alone cannot show a message that is still streaming. While the Session is running or compacting, the messages response therefore also carries the in-progress stream tail:

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

`cursor` and `fragments` are captured together, atomically, before the Trace read starts. A client that connects to the stream first (see [Recommended Client Pattern](#recommended-client-pattern)) applies them after the history: when the cursor's epoch matches the epoch of the SSE events it has buffered, it drops every buffered partial event with a seq at or below the cursor, since `fragments` already contains that content. It then feeds `fragments` through its normal reducer and replays the rest of the buffer. The cursor never drops buffered complete messages; the usual overlap deduplication decides those. `live` is omitted while the Session is idle.

### Forks

`tracePosition` is metadata of the history response, not part of the persisted OmniMessage envelope. The Web App sends the immutable position of the reply's final assistant record to `/fork`, and the server checks that this record closes a completed Task.

A fork clones the retained Trace files and snapshots the source scratchpad under the new Session id, rewriting the local attachment markers the system generated, so the fork keeps working if either Session is deleted later. Forks made from any reply of the same source Session share one persistent title sequence that does not depend on the interface language (`Source title (1)`, `Source title (2)`), and deleting an older fork does not free its number. A source Session that is running or compacting returns 409.

### Tasks and steering

| Method | Path | Description |
| --- | --- | --- |
| POST | `/tasks` | Starts a Task: `{input: TaskInputPart[], queueIfBusy?, goal?}` → 202 |
| POST | `/steer` | Queues a steering message for the running Task: `{text, images?}` → 202 |
| DELETE | `/steer/:steerId` | Recalls a steering message that has not been delivered yet |
| DELETE | `/follow-ups/:followUpId` | Recalls a queued follow-up Task |
| POST | `/approvals/:toolCallId` | Approval decision: `{decision}`, `allow` or `deny` → 204 |
| POST | `/tool-calls/:toolCallId/background` | Moves one executing tool call to the background → 204 |
| POST | `/subagents/:childSessionId/message` | Sends a message to one subagent child: `{text}` → `{outcome}` |
| POST | `/subagents/:childSessionId/abort` | Stops one subagent child's current run |
| POST | `/abort` | Interrupts the current Task: 202 when triggered, 204 when idle |
| POST | `/retry-now` | Skips the reconnect countdown: → 200 `{skipped}` |
| POST | `/compact` | Starts context compaction: 202 |

- `POST /tasks` answers `{sessionId, queued?}`. With `queueIfBusy`, a busy Session holds the input as a follow-up (`queued: true`) and starts it as an ordinary next Task once the Session is idle; `task_state` events report the number queued. `file` input parts are written to the Session scratchpad and handed to the model as `[attached file: <path>]` lines (see [Request bodies](#request-bodies)).
- `POST /tasks` with `goal: {budget?}` starts a goal loop instead. It returns 409 `goal_plugin_not_installed` unless the `goal` plugin is installed on the agent. The objective is the input's text, with any leading marker blocks removed, so the input must carry non-empty text (400 otherwise): an image alone states no objective. Images are sent in round 1 as ordinary input, and later rounds re-inject only the objective text. `file` parts are refused with 400, because nothing carries them into the objective that every round re-injects. See [Goal mode](/goal-mode).
- `POST /steer` delivers the message between turns as a standalone `[user_steering]` user message, with its images right after it. Either field can carry the message on its own, but a request with neither returns 400. It returns 409 `not_running` when no Task is in progress.
- `DELETE /steer/:steerId` takes an id from `pendingSteering` in `task_state` and withdraws that message from the queue. It answers 200 with the original content, `{text, images, files}`, so the composer can restore it for editing: files are read back from the scratchpad as data URLs, and their copies on disk are deleted. Once the message was delivered to the model, it returns 409 `not_pending`.
- `DELETE /follow-ups/:followUpId` takes an id from `pendingFollowUps` in `task_state` and removes that follow-up before it starts. It answers 200 with the original content, `{text, images, files}`, which every queued follow-up carries however it was queued. It returns 409 `follow_up_started` once the follow-up has started or when the id is unknown.
- `POST /tool-calls/:toolCallId/background` hands one executing tool call back as a background task, so the turn can close and the conversation can continue. The call ends as `completed` with its `process_id` or `subagent_id`, nothing is killed, and the result arrives later as the usual background-task notice. It returns 404 `tool_call_not_found` when nothing with that id is executing (the id is unknown, the call already finished, or the runtime is gone), and 409 `tool_not_detachable` when the call is running but its tool has no background form. Only `exec_command` and `run_subagent` have one.
- `POST /subagents/:childSessionId/message` delivers the text as user input to the child, whatever its state. `outcome` is `steered` when the child was running and the message was queued as steering, `started` when the idle child began a follow-up run, and `resumed` when a released child was revived and began its next round. The child runs at its own context's thinking level, which you can pin with `PATCH` on the child Session. An empty `text` returns 400, 404 `subagent_gone` means the child's record does not exist or cannot be revived, and 409 `subagent_busy` means the child cannot take a message right now.
- `POST /subagents/:childSessionId/abort` stops only the child's current run; the child Session stays available for steering and follow-ups. It returns 202 when a run was stopped, and 204 when the child is already idle or unknown.
- `POST /retry-now` backs the **Retry now** button on the reconnect countdown. It skips the backoff wait in progress and fires the next retry immediately, without changing the attempt counter. `skipped: false` means no wait was in progress; it is not an error.
- `POST /compact` returns 409 when there is nothing to compact, with the reason in the code: `compaction_not_configured` (the agent has no compaction configured), `nothing_to_compact` (the context has no completed conversation turn yet) or `already_compacted` (nothing new was said since the last compaction). A Session resumed after a server restart works this out from its Trace, so an existing conversation can be compacted without running a Task first.

### Request bodies

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

The Web App's `/model` switch has no dedicated endpoint. Like the `/agent` handoff, it combines ordinary routes:

1. Session creation opens a new Session for the same agent, with the chosen model and the source Workspace carried over.
2. `POST /tasks` sends a first message that opens with a `[model_switch_from]` source block, naming the source session id, its `tracePath`, the Workspace and the previous model pair.
3. The model reads that Trace file itself when it needs the earlier history.

### Background processes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/processes` | The background processes the conversation started |
| POST | `/processes/:processId/kill` | Stops one background process |
| DELETE | `/processes/:processId` | Removes one exited process from the list |

- `GET /processes` lists the `exec_command` calls that moved to the background past their yield window. The list comes from the active runtime only, so a Session that was unloaded or never loaded correctly reports an empty list. A row carries `serviceUrl` when the server detected an address the process serves: the last local URL the output printed, or else a listening port found by probing the process group, refreshed on each request.
- `POST /processes/:processId/kill` sends SIGTERM to the whole process group, then SIGKILL after a grace period, and the entry leaves the list. It returns 404 `process_not_found` when the process is already gone.
- `DELETE /processes/:processId` returns 409 `process_running` while the process still runs (stop it instead) and 404 `process_not_found` when the entry is already gone. The entry leaves the runtime registry together with the output captured from it, so a later `input_command` on that `process_id` fails.

### Workspace files

| Method | Path | Description |
| --- | --- | --- |
| GET | `/files?path=` | Browses a Workspace directory |
| GET | `/files/content?path=&download=&preview=` | Reads a Workspace file (see [Workspace file responses](#workspace-file-responses)) |
| GET | `/files/preview-redirect?path=` | Opens an HTML file on the separate preview origin: mints a signed token and redirects with 302 |
| POST | `/files/stat` | Checks whether files exist: `{paths}` |
| PUT | `/files/content?path=` | Uploads a file: `{dataBase64}`, up to 14MB |
| POST | `/files/move` | Moves or renames one file: `{from, to, ifVersion?}` → 204 |
| DELETE | `/files/content?path=&ifVersion=` | Deletes one file → 204 |
| POST | `/files/reveal?path=` | Shows the file in the machine's own file manager → 204 |
| GET | `/files/search?q=` | Searches the whole Workspace by entry name |
| GET | `/scratchpad/:fileName` | Reads a scratch file of the Session, such as an input image or file attachment |

- `GET /files/preview-redirect` backs **Open in new tab** and the rendered HTML view of the **Files** panel; see [Preview on a separate origin](#preview-on-a-separate-origin).
- `POST /files/move` works on files only: a directory has no single version marker, so the precondition that protects the move cannot be expressed for one, and the route returns 400. Missing parent directories of `to` are created. It returns 404 `path_not_found` when `from` is gone, and 409 `file_changed` when `ifVersion` no longer matches (a source that disappeared while a marker was given counts as changed). It returns 409 `target_exists` when something is already at `to`, because the destination was never read and so is refused rather than overwritten, and 400 for a move onto the file's own path.
- `DELETE /files/content` also works on files only (400 for a directory). It returns 404 `path_not_found` when the file is gone, and 409 `file_changed` when `ifVersion` no longer matches. The marker is optional, and without it the delete is unconditional, but the **Files** panel always sends the marker its read returned.
- `POST /files/reveal` selects the file on macOS and Windows, and opens its directory on a Linux desktop. Only the desktop shell's own window may call it. It returns 404 `not_found` when the server was not started by a desktop shell, and 403 `desktop_shell_only` for a browser session against a desktop-mode server: such a session cannot be told apart from a remote one, and a folder opening on the server's machine helps nobody there. The path is confined the same way as for a read (400 out of bounds, 404 `path_not_found`), and 502 `reveal_failed` means the file manager would not start.
- `GET /files/search` matches entry names only (a case-insensitive substring; the path is not matched) and answers `{hits: [{path, kind, sizeBytes, mtime}], truncated}`, each hit carrying what a directory listing entry carries. The search walks breadth-first from the root, so hits come shallowest first, and a capped result keeps the most relevant hits rather than whatever the first directory held. `truncated` means a cap stopped the walk: 200 hits, or 20000 directory entries visited. An empty `q`, or one longer than 100 characters, returns 400.

### Workspace file responses

Workspace files may be generated by an agent, so `GET /files/content` treats them as untrusted. Every response carries `X-Content-Type-Options: nosniff`, and the other headers depend on the two flags, where `download=1` wins over `preview=1`:

| Query | Content-Type | Content-Disposition | Content-Security-Policy |
| --- | --- | --- | --- |
| neither | `text/plain; charset=utf-8` for `.html` / `.htm` / `.svg`, the real type otherwise | `inline` | — |
| `preview=1` | the real type (`text/html`, `image/svg+xml`, …) | `inline` | `sandbox allow-scripts allow-popups allow-modals allow-forms`, sent only for `.html` / `.htm` / `.svg` |
| `download=1` | the real type | `attachment` | — |

The file name is always sent as `filename*=UTF-8''` with percent-encoding.

`preview=1` is where the preview redirect falls back when no separate preview origin is available. The document keeps its real type and does render and run, but the sandbox deliberately omits `allow-same-origin`. The document therefore lands in an opaque origin and can reach neither this origin's cookies nor the API, which is also why `localStorage`, `document.cookie` and third-party embeds do not work there.

`GET /scratchpad/:fileName` serves the same kind of untrusted bytes (uploads and temporary files an agent wrote) and is locked down the same way, without the flags:

- `X-Content-Type-Options: nosniff` is always sent.
- A fixed allowlist of five inert image types (`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`) is served inline, for the conversation's `<img>` tags.
- Everything else is served as `application/octet-stream` with `Content-Disposition: attachment`, so nothing except those images can render as a document on the app's origin.

### Preview on a separate origin

The **Files** panel's rendered HTML view (an iframe) and **Open in new tab** both go through `GET /files/preview-redirect?path=`. This route authenticates the caller, mints a short-lived HMAC token, and redirects with 302 to a **different origin**:

```text
GET  /api/sessions/:sessionId/files/preview-redirect?path=index.html
302  Location: http://localhost:7364/preview/<token>/index.html
GET  /preview/<token>/<relative path>          (unauthenticated; the token is the credential)
```

- Why a separate origin: the page needs a real origin for storage, cookies and third-party embeds to work, but it must not be the app's origin, or HTML an agent wrote would run with the session cookie. Locally, the app is canonicalized onto `localhost` and previews are served from `127.0.0.1`. Cookies are keyed by host and ignore the port, so those two hosts get separate cookie jars, which a second port would not. Otherwise `PENGUIN_PREVIEW_ORIGIN` applies. With neither (a wildcard or non-loopback bind, or the variable unset), the redirect falls back to the same-origin sandbox described above, and `previewIsolated` on `GET /api/me` reports `false` so the UI can tell the user first.
- In-app rendering uses the same URL: the **Files** panel embeds the redirect URL in an iframe sandboxed with `allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads`. Here `allow-same-origin` grants the preview origin's identity, not the app's, so this stays strictly tighter than the new tab, which has no sandbox. Without a separate preview origin, the panel falls back to inline `srcdoc` rendering (`allow-scripts` only, plus an in-memory storage shim), where relative subresources cannot load. Some browsers partition or block storage inside a cross-site iframe, so a page may behave slightly differently in the panel than in a top-level tab.
- The preview host serves only `/preview/*`. It is the same process as the app, so it answers `/api` with `401` and redirects every other route with `302` to the canonical app host. A session cookie is therefore never set or accepted on the preview host, and agent HTML there cannot reach the API from the same origin. For a deployed `PENGUIN_PREVIEW_ORIGIN`, the reverse proxy must enforce the same thing: route only `/preview/*` to the app on that origin.
- The token sits in the path, not in a query parameter, so a page's relative subresources (`app.js`, `style.css`, images) resolve against the document and load under the same token.
- The token binds the Session, the preview host and an expiry time. The host binding matters: the same process also answers on the app origin, so `/preview/...` refuses to serve there, which would otherwise be a same-origin XSS. Access is read-only and limited to that Session's Workspace, and the server resolves the path again, so `..` and symlink escapes are rejected as for any read.
- Responses carry `Referrer-Policy: no-referrer`. Otherwise the URL, with its token, would leak through `Referer` to every third party the page embeds, a risk that exists precisely because embeds now work.
- A bad token, an expired token, the wrong host and a path out of bounds all return a bare 404: the endpoint is unauthenticated and must not confirm what exists.

### Traces

| Method | Path | Description |
| --- | --- | --- |
| GET | `/traces` | Lists this Session's Trace files |
| GET | `/traces/:index` | Reads Trace events (paginated) |
| GET | `/traces/:index/analysis` | Trace performance analysis |

## Messaging Bindings (Feishu, Telegram, QQ, WeChat)

A Session can be connected to a messaging bot. The channels today are Feishu, Telegram, QQ and WeChat, each under `/messaging/<channel>`. The paths below omit the `/api/sessions/:sessionId` prefix, like the Session-level tables.

- A Session keeps at most one saved config per channel, and all its channels may be saved side by side. At most one of them is enabled, and the enabled channel holds the live connection.
- Enabling binds the bot account to the Session, and disabling releases it. The same app or bot can therefore be saved on any number of Sessions; only enabling is exclusive.
- Saving and connecting are separate: PUT only stores the credentials, and the `state` route owns the connection. New configs start disabled, and at startup the server connects only the enabled ones.
- Messages sent to the bot start Tasks on the Session as ordinary user input, exactly as if typed into the web composer: no marker is added, and they queue as follow-ups while the Session is busy. Completed replies are relayed back to the chat, split into chunks of at most 4000 characters, which stays under Telegram's hard cap of 4096.
- Feishu listens over the SDK's WebSocket long connection, Telegram long-polls `getUpdates`, QQ holds the platform's WebSocket gateway with the `GROUP_AND_C2C_EVENT` intent, and WeChat long-polls `ilink/bot/getupdates`. None of them needs a public callback URL.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/messaging` | Every saved channel config of the Session |
| GET | `/messaging/feishu` | The Feishu config, as `{binding, status}` (`null` when not saved) |
| PUT | `/messaging/feishu` | Saves the Feishu credentials: `{appId, appSecret?, baseDomain?, clearAppSecret?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` |
| POST | `/messaging/feishu/state` | Turns the connection on or off: `{enabled}` |
| DELETE | `/messaging/feishu` | Removes the Feishu config entirely, App Secret included |
| POST | `/messaging/feishu/test` | Tests the credentials: → `{ok, latencyMs?, error?}` |
| POST | `/messaging/feishu/test-message` | Sends a short fixed text to the last known chat |
| GET | `/messaging/telegram` | The Telegram config in the same envelope (`botId`, `botTokenMasked`) |
| PUT | `/messaging/telegram` | Saves the Telegram credential: `{botToken?, clearBotToken?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` |
| POST | `/messaging/telegram/state` | Turns the connection on or off: `{enabled}` |
| DELETE | `/messaging/telegram` | Removes the Telegram config entirely, Bot Token included |
| POST | `/messaging/telegram/test` | Tests the token with `getMe`: → `{ok, latencyMs?, botUsername?, groupPrivacy?, error?}` |
| POST | `/messaging/telegram/test-message` | Sends a short fixed text to the last known chat |
| GET | `/messaging/qq` | The QQ config in the same envelope (`appId`, `appSecretMasked`) |
| PUT | `/messaging/qq` | Saves the QQ credential pair: `{appId, appSecret?, clearAppSecret?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` |
| POST | `/messaging/qq/state` | Turns the connection on or off: `{enabled}` |
| DELETE | `/messaging/qq` | Removes the QQ config entirely, App Secret included |
| POST | `/messaging/qq/test` | Tests the credentials with the app-access-token exchange: → `{ok, latencyMs?, error?}` |
| POST | `/messaging/qq/scan` | Starts scan-to-connect: → `{taskId, qrUrl, pollMs}` |
| POST | `/messaging/qq/scan/poll` | Polls a scan: `{taskId}` → `{status, appId?, binding?}` |
| POST | `/messaging/qq/scan/cancel` | Drops a scan: `{taskId}` |
| POST | `/messaging/qq/test-message` | Sends a short fixed text to the last known chat |
| GET | `/messaging/wechat` | The WeChat config in the same envelope (`botId`, `botTokenMasked`) |
| PUT | `/messaging/wechat` | Saves the delivery preferences only: `{clearBotToken?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` |
| POST | `/messaging/wechat/state` | Turns the connection on or off: `{enabled}` |
| DELETE | `/messaging/wechat` | Removes the WeChat config entirely, bot token included |
| POST | `/messaging/wechat/test` | Tests the stored binding with `ilink/bot/getconfig`: → `{ok, latencyMs?, error?}` |
| POST | `/messaging/wechat/scan` | Starts scan-to-connect, the only way to bind WeChat: → `{taskId, qrUrl, pollMs}` |
| POST | `/messaging/wechat/scan/poll` | Polls a scan: `{taskId}` → `{status, botId?, binding?}` |
| POST | `/messaging/wechat/scan/verify` | Records the pairing code shown on the phone: `{taskId, verifyCode}` → 204 |
| POST | `/messaging/wechat/scan/cancel` | Drops a scan: `{taskId}` |
| POST | `/messaging/wechat/test-message` | Sends a short fixed text to the last known chat |

### Configs and permissions

- `GET /messaging` is the channel-agnostic read that the binding editor loads. Each row carries the `channel` discriminant, masked secrets, the `enabled` intent, `linePerMessage`, `finalReplyOnly`, `renderMarkdown`, the runtime status and `lastChatKnown`.
- Masked secrets are omitted from responses when no secret is stored (a cleared config), and a config without a secret cannot be enabled. Secrets never go back to the client.
- Reads and the two test routes are open to any Project member. PUT, the `state` toggle and DELETE are owner only, with the same semantics as the vault, because these writes carry or act on the secret. Every scan route is owner only too (see [Scan-to-connect](#scan-to-connect)).
- DELETE removes one channel's config entirely and leaves the other channels untouched. It exists for API completeness; the Web App removes a secret with the clear flag instead. Deleting the Session removes all its configs.
- The only rule across Sessions is per bot account per channel, and it applies to the connection only: one account has one event stream, so at most one Session may have it enabled. Feishu identifies the account by its `app_id`, Telegram by the numeric bot id before the token's colon (which survives token rotation), QQ by the App ID, and WeChat by the bot id the scan returns.

### Saving and connecting

- A PUT with an omitted or blank secret keeps the stored one. The clear flag (`clearAppSecret` or `clearBotToken`) drops the stored secret, but a secret typed in the same request wins. While the channel is enabled, clearing returns 409 `messaging_disable_before_clear`. A cleared config keeps its row and its non-secret fields, including a Telegram or WeChat bot's identity.
- A PUT has no effect on the connection, with one exception: when the binding is enabled, its connector restarts with the new credentials, so the stored config and the live connection never diverge. A save therefore never conflicts across Sessions, except when it points an enabled binding at an account that another Session has enabled. That returns 409 `account_enabled_elsewhere`, because the restart would otherwise bring a second live connection onto the account without passing the enable check.
- `POST …/state` with `{enabled: true}` connects with the stored credentials, and `{enabled: false}` disconnects. It returns 409 `another_channel_enabled` while another channel of this Session is enabled, and 409 `account_enabled_elsewhere` while another Session has the same account enabled. Both mean: turn that one off first. The second names nothing about the holder, which may be in a Project the caller cannot see. Without a stored secret, the toggle returns 400 `feishu_secret_required`, `telegram_token_required`, `qq_secret_required` or `wechat_token_required`.
- The Feishu, Telegram and QQ test routes probe with the draft values in the request, each falling back to the stored config; the WeChat test takes no body (see below). A rejected credential is `ok: false`, not an HTTP error.
- The test-message routes return 409 `feishu_no_chat`, `telegram_no_chat`, `qq_no_chat` or `wechat_no_chat` until someone has messaged the bot once in that app.

### Per-channel details

- Feishu: `baseDomain` defaults to `https://open.feishu.cn`.
- Telegram: the whole credential is the one `<bot id>:<secret>` token that @BotFather issues. A token whose numeric id cannot be read returns 400 `telegram_token_invalid`. A successful test names the bot the token signs in as (`botUsername`) and reports `groupPrivacy: true` when @BotFather's Group Privacy is on, which it is by default. With Group Privacy on, the bot receives no ordinary messages in any group it does not administer.
- QQ: the credentials are the App ID and App Secret from the development settings of the QQ open platform. There is no domain field, because API v2 has a single host. The test reports no account name, because the platform has no call that identifies the bot. The test message also returns 502 `qq_send_failed` when there is no recent QQ message to reply to; see [QQ](#qq).
- WeChat: its PUT is the only one without a credential. A WeChat bot token exists only where a scan put it, and there is no console to copy one from, so the PUT requires an existing binding and returns 400 `wechat_token_required` before one exists. A cleared WeChat config can connect again only after a fresh scan. The test route is the only one that takes no body: nothing on this channel is typed in, so the stored binding is all there is to probe (400 `wechat_token_required` without one). The test names neither the bot nor the person who scanned.

### QQ

QQ is a reply-only channel, and that changes what delivery means. The platform offers no push this product may use: every outbound message is a passive reply that carries the `msg_id` of an inbound message, is valid for a few minutes, and is limited to 4 replies per message in a single chat (5 in a group). Three consequences show through this API:

- A run that completes more assistant messages than the reply budget has them combined: the first `budget - 1` go out as they complete, and the rest arrive together in one final message, so nothing is dropped.
- `linePerMessage` is limited to that budget rather than to the usual cap of 20 messages, and a `renderMarkdown` send the platform refuses uses a second reply for its plain-text retry. `finalReplyOnly` cuts both ways here. It uses the least budget a run can, one reply, but the passive-reply window is only a few minutes long. Holding the reply until the run ends spends that window on the run, so a run that outlasts the window delivers nothing, where relaying every message would have sent whatever completed inside it.
- A send with nothing to reply to, such as a turn started in the Web App or any reply after the window closed, is refused rather than pushed. It shows up as 502 `qq_send_failed` on the test endpoint, and as one `messaging_send_failed` error record for a relayed reply.

Outbound files are refused on QQ, because the platform's rich-media path requires a publicly reachable URL for the file.

### WeChat

WeChat carries direct chats only, and the most media of the four channels. The bot channel has no group inbound at all: a message addressed to the bot in a group never reaches this API, so a binding that works in a direct chat stays silent in a group by design, not because of a misconfiguration.

In exchange, it is the only channel here that carries text, images and files in both directions. The images and attachments of a reply are uploaded to the platform's CDN (AES-128-ECB, with a key per file) and arrive as real images and files instead of being refused. Two inbound kinds are converted: a voice message arrives as WeChat's own transcription of it, and a video arrives as a file. A recording the platform could not transcribe gets the shared "not supported" notice in the chat.

### Scan-to-connect

Scan-to-connect never shows the secret to the browser. Everything that makes the flow safe stays on the server: the AES key that decrypts QQ's App Secret, and the platform poll handle that collects WeChat's bot token. The server generates, holds, uses and discards them, and the client only receives a task handle, a URL to draw and a status.

- `POST …/scan` returns `{taskId, qrUrl, pollMs}`. Render `qrUrl` as a QR code: the QQ or WeChat app opens it, and nothing fetches it. For WeChat, `taskId` is a handle this server mints in place of the platform's poll handle. While the channel's connection is enabled, scan returns 409 `messaging_disable_before_scan`, because a scan replaces the whole credential under a live connector. When the platform refuses, it returns 502 `qq_scan_failed` or `wechat_scan_failed`.
- QQ's `scan/poll` status `completed` means the server has decrypted the App Secret and saved the binding; `expired` means start a new task.
- WeChat's `scan/poll` status is one of `pending`, `scanned`, `need_verify_code`, `blocked`, `expired`, `already_bound` and `completed`. `completed` means the server has saved the binding. `already_bound` is not a failure: the bot is already bound, and nothing new was issued. It does not say where, because the scan gives the platform no list of tokens, so it cannot tell a binding on this server from one anywhere else.
- In both channels, saving a binding does not enable it; enabling stays a separate step.
- `scan/verify` records the pairing code WeChat showed on the phone. The platform takes the code as a parameter of its status call, so the code rides along with the next poll instead of a request of its own. A wrong code shows up as the next poll reporting `need_verify_code` again.
- `scan/cancel` drops a scan the user walked away from, so its key or handle is forgotten at once instead of at the next cleanup.
- Tasks live in memory and belong to the Session that started them. Each Session has its own limit, so one caller's scans cannot push out another's. The poll that resolves a task claims it, so replaying that poll returns 404 (`qq_scan_task_unknown` or `wechat_scan_task_unknown`, also returned for an unknown task or another Session's task) rather than binding twice. A second concurrent poll of the same task also returns 404 on QQ, but `pending` on WeChat, because the upstream call there is a long poll that spans several client intervals.

Every scan route is owner only, because the flow ends in a stored credential however little of it the caller types.

### Delivery settings

`linePerMessage`, `finalReplyOnly` and `renderMarkdown` are the three saved fields that are not credentials. On a PUT, an omitted value keeps the stored one. None of them applies to notices or to the test message; in particular, the approval reminder is not a reply and arrives immediately whatever `finalReplyOnly` says.

- `linePerMessage` (default false) sends every non-blank line of a relayed assistant reply as its own message. Blank lines are dropped, each line is still split under the size cap, and past the cap of 20 messages per reply the remaining lines are combined into one last message. The messages go out 1 second apart.
- `finalReplyOnly` (default false) relays only the last completed assistant message of a run, when the run ends, instead of relaying each message as it completes. The working notes a run writes between tool calls stay in the Web App. The files that follow the reply are then read from that final message alone, since it is the only text the chat received. With both settings on, the final reply is the one split into lines.
- `renderMarkdown` (default true) renders the Markdown of a relayed reply in the channel's own markup instead of sending the characters as written. Chunking follows the setting: it cuts at block boundaries and re-opens a code block that spans messages, so no message opens a construct it does not close. If the channel refuses a formatted send, the same message is sent again as plain text, so the setting can cost formatting but never a reply.

Each channel renders what it can and degrades the rest deliberately, rather than showing Markdown source:

| Channel | How a reply is rendered |
| --- | --- |
| Telegram | `parse_mode: "HTML"`. No headings, lists or tables: a heading becomes a bold line, list markers stay as literal text, and a table becomes a `<pre>` block |
| Feishu | An interactive card carrying the JSON 2.0 rich-text component, which renders everything. Over-long tables become code blocks, so no row is silently dropped |
| QQ | `msg_type: 2` markdown. No code formatting and no tables: a fenced block becomes plain escaped lines, and a table becomes its rows |
| WeChat | WeChat reads Markdown itself, so rendering removes rather than translates: what the client will not show keeps its words and loses its markers (headings deeper than the fourth level, emphasis around CJK text, and inline images, which become links) |

### Inbound messages

Inbound messages can carry text, images and files.

- An image becomes an ordinary `image_url` input part. Each image is capped at the server's inline-image limit, and each binding has a rolling budget of image bytes: 40MB per 10 minutes, twice the inline-image cap. The budget exists because an inline image is written verbatim into the Trace, and unlike the composer, this path has no authentication in front of it.
- A file takes the composer's other attachment shape: it is written into the Session scratchpad and handed to the model as an `[attached file: <path>]` line, so its bytes never enter the conversation. It is subject to the same admin-configurable per-file and per-message caps as an authenticated upload, narrowed by any tighter limit of the channel itself: Telegram serves a bot no file over 20MB.
- Feishu delivers files sent as the `file` message type, and Telegram files in the `document` field: a file the sender chose to send as a file, which is also the only Telegram media field that carries the sender's own file name.
- On Feishu and Telegram, video, audio and voice are deliberately not delivered: nothing downstream decodes or transcribes them, and anything a sender wants the agent to have arrives as soon as they attach it as a file. WeChat is the exception, only because the platform does the work itself (see [WeChat](#wechat)).
- The caption of a message whose attachment is delivered (a photo or a document) is that message's text. A caption on any other kind of media is not, because the media never arrives, and running the model on the caption alone would make it answer about a file it never received.
- An image over the per-image limit, an image past the budget, and an image the channel refuses each get a different bilingual notice, as do a file over a cap, a batch over the per-message total, and a file the channel refuses. None of them runs half a message. When the bot's own permissions caused the refusal, the notice names the permission scopes to grant and links to the channel's console. On Feishu this is the usual case, because receiving messages and downloading their attachments are separate scopes.
- Every other message type gets the bilingual "not supported" reply.

### Outbound files

After a run finishes, its reply is followed by the files the reply mentioned and the run produced: path-like tokens anywhere in the reply that resolve inside the Workspace, exist, and were written at or after the start of the run. The mention picks which output was the point. The modification time keeps a reply, which anyone in the chat can steer, from becoming a way to read files, since a reply that declines to paste a file still names it.

- Images are sent as images and everything else as attachments, classified by the file actually read rather than by the name the reply wrote.
- A run sends at most 5 files, at most 10MB per image and 30MB per file (the tighter of each channel's own limits).
- A mentioned file that fails to arrive is never reported in the chat. It is filed under the Project as an error record instead, which the Cost Center's errors table shows: one record per reply for each cause, naming every file it covers, the channel and the reason.
  - `messaging_file_too_large` covers the files over a cap, `messaging_files_skipped` those past the count cap. Both are `expected`.
  - `messaging_file_send_failed` covers the uploads the channel refused, grouped by cause: uploads the channel can never carry (any file on QQ), a missing permission, and any other refusal. The permission record lists the scopes to grant and the console link once, in place of each file's own reason. Uploads the channel can never carry are `expected`; a missing permission and any other refusal are `unexpected`.
  - A name that matches no file in the Workspace, and a file the run did not write, are skipped silently and only logged, because a reply that names a file it read or merely described is the ordinary case.

### Connection status

When it connects, Telegram first drains the backlog, skipping messages sent while no connection existed. That matches Feishu, where missed events are simply gone.

Besides its state, a binding's runtime status reports what the live connection has actually seen:

- `lastInboundAt`: when a message last arrived; absent while none has arrived since this connection opened.
- `lastDeliveryError`: `{at, stage, detail}`, where `stage` is `inbound` when a message arrived but its Task never started, or `send` when a reply never reached the chat. A later success does not clear it.
- `lastConnectionError`: `{at, detail}` for the last connection failure, kept after the connection recovers. By contrast, `lastError` belongs to the `error` state and disappears as soon as the state leaves it.

All three live in the server process and reset on every connect or reconnect, and re-enabling the channel or saving credentials opens a new connection. An absent `lastInboundAt` therefore means "nothing since this connection opened", never "nothing ever". These fields exist because a channel that withholds messages still shows `connected` with no error.

## Terminals

Interactive shells on the server host. The Web App's terminals use these routes, and so can any client that needs to run a command and read the screen. Each terminal belongs to the user who opened it, and the other routes only find the caller's own terminals.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/terminals` | Lists the caller's terminals: `{terminals}` |
| POST | `/api/terminals` | Opens a terminal: `{cwd?, name?, shell?, cols?, rows?}` → 201 with the terminal's info |
| GET | `/api/terminals/:id` | One terminal's info |
| DELETE | `/api/terminals/:id` | Kills the terminal; 204 |
| GET | `/api/terminals/:id/capture?start=&end=` | The screen contents as plain text |
| POST | `/api/terminals/:id/keys` | Sends input: `{keys, literal?}` → `{ok: true}` |

- `cwd` defaults to the home directory, and `shell` to the user's login shell.
- `keys` is literal text or a key token: `Enter`, `Tab`, `Escape`, `Backspace`, `Space`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `PageUp`, `PageDown`, `Delete`, or a control chord such as `C-c`. With `literal: true`, the text is sent exactly as given. A terminal whose shell has exited returns `409` `terminal_exited`.
- The byte stream does not use these routes: it is a WebSocket at `GET /api/terminals/:id/stream` (an Upgrade request).
- A request without a valid session or token returns `401` `unauthorized`.

## Desktop Shell, Hot Update and Web Contributions

Routes that serve the desktop shell, hot updates and the Web App's own module system rather than general clients.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/desktop/shutdown` | Shuts the server down gracefully, at the desktop shell's request; 202 |
| GET | `/api/desktop/update` | The desktop app updater's status: `{status}` |
| POST | `/api/desktop/update/check`, `/api/desktop/update/download`, `/api/desktop/update/install` | Relays the command to the desktop shell; 202 |
| GET / PUT | `/api/desktop/tray` | Reads the tray-icon preference: `{status}` / relays a change: `{showTrayIcon?, locale?}` → 202 |
| POST | `/api/hmr/assets/probe` | Hot update: reports which blobs the store lacks |
| PUT | `/api/hmr/blobs/:sha` | Hot update: uploads one blob under its sha256 |
| POST | `/api/hmr/upgrade` | Hot update: moves the platform, CLI and web bundles to a new version together |
| GET | `/api/contributions` | The pages and tabs that server modules and plugins contribute to the Web App, as data |

- Outside desktop mode, the desktop routes return `404` `not_found`.
- `POST /api/desktop/shutdown` does not use the cookie session. It authenticates with the desktop shell's own Bearer token (`401` `unauthorized` otherwise), answers first, and starts the graceful shutdown right after.
- The update and tray routes answer only the desktop shell's own window: any other session gets `403` `desktop_shell_only`. When the shell is not listening, they return `503` `shell_unreachable`. `PUT /api/desktop/tray` returns `400` `invalid_show_tray_icon` for a non-boolean `showTrayIcon`, `400` `invalid_locale` for a `locale` other than `zh` or `en`, and `400` `empty_tray_patch` when neither field is given. The PUT only acknowledges the change; read the result back with GET.
- The `/api/hmr` routes are admin only (`403` `forbidden`). On a non-loopback bind they also require HTTPS and otherwise return `403` `hmr_disabled`. `X-Forwarded-Proto` counts only when `PENGUIN_TRUST_PROXY=1`. A completed upgrade sends `web_updated` to every connected client, so they reload.

## Streaming (SSE)

Real-time delivery uses Server-Sent Events, not WebSocket, on two kinds of channel. For the ordering semantics of what the channels carry, see [Message Flow & Ordering](/message-flow).

| Channel | Path | Contents |
| --- | --- | --- |
| Per Session | `GET /api/sessions/:sessionId/stream` | The Session's message stream and run events, including `session_created` for its subagent Sessions and the goal-mode events |
| Per user | `GET /api/events` | The `hello` handshake and notifications across Sessions: `session_state`, `session_background`, `session_title`, `schedule_fired`, `schedule_queued`, `web_updated` and company mode's `org_*` events |

### Wire Format

Default (unnamed) SSE events carry raw OmniMessage envelopes as single-line JSON: the same protocol the SDK yields and the Trace stores (see [OmniMessage Protocol](/omni-message)). Events named `server_event` carry the `ServerEvent` union:

```ts
export type ServerEvent =
  | { type: "approval_request"; toolCall: OmniMessage<ToolCallPayload>; origin?: string[] }
  | {
      type: "task_state";
      state: "idle" | "running" | "compacting";
      queued?: number;
      pendingSteering?: PendingSteeringInfo[];
      returnedSteering?: PendingSteeringInfo[];
      pendingFollowUps?: PendingFollowUpInfo[];
      subagents?: SubagentRuntimeInfo[];
    }
  | { type: "session_title"; sessionId: string; title: string }
  | { type: "session_state"; sessionId: string; state: "idle" | "running" | "compacting"; lastActiveAt: string; hasTrace: boolean }
  | { type: "session_background"; sessionId: string; processes: number; subagents: number }
  | { type: "resync_required" }
  | { type: "credentials_updated" }
  | { type: "hello" }
  | { type: "web_updated"; rev: string }
  | { type: "session_created"; projectId: string; agentId: string; sessionId: string; source: SessionSource }
  | { type: "schedule_fired"; projectId: string; agentId: string; name: string; sessionId: string }
  | { type: "schedule_queued"; projectId: string; agentId: string; name: string; sessionId: string }
  | { type: "goal_started"; sessionId: string; objective: string; budget: number }
  | { type: "goal_round"; sessionId: string; round: number; used: number; budget: number }
  | { type: "goal_finished"; sessionId: string; outcome: "complete" | "blocked" | "budget_limited" | "aborted"; rounds: number; used: number }
  | { type: "org_run"; projectId: string; orgId: string; agentId: string; sessionId: string; kind: OrgTriggerKind }
  | { type: "org_channel"; projectId: string; orgId: string; channelId: string; message: OrgChannelMessage }
  | { type: "org_ticket"; projectId: string; orgId: string; ticketId: string; change: string }
  | { type: "org_budget"; projectId: string; orgId: string; agentId: string; state: "warned" | "paused" | "resumed"; ratio: number };
```

| Event | Fired when |
| --- | --- |
| `approval_request` | A tool call needs human approval |
| `task_state` | The Session's run state changes (`idle` / `running` / `compacting`) |
| `session_title` | The model-generated title is saved after the first turn |
| `session_state` | A Session's run state changes; the user-channel counterpart of `task_state` |
| `session_background` | A Session's background-task counts change |
| `resync_required` | The `Last-Event-ID` was evicted from the buffer; the client must refetch history |
| `credentials_updated` | The Project's model credentials changed |
| `hello` | Handshake on the user channel |
| `web_updated` | A hot update replaced the served web assets; clients reload |
| `session_created` | A new Session was registered, such as a subagent Session |
| `schedule_fired` | A scheduled task fired and its prompt was delivered |
| `schedule_queued` | The target Session is running, so this firing was queued |
| `goal_started` | A goal run began, before its first round |
| `goal_round` | A goal round is starting |
| `goal_finished` | The goal reached a terminal state |
| `org_run` | An organization's work run (desk session) or ticket session started |
| `org_channel` | A new channel message was posted |
| `org_ticket` | A ticket's status, owner, blocked state or contributing sessions changed |
| `org_budget` | An employee's budget was warned, paused or resumed |

- `approval_request` covers every call under `always-ask`, and calls with `rw` or unknown permission under `read-only`. Pending approvals are sent again on reconnect.
- `task_state` also carries the number of queued follow-ups (`queued`), the steering messages still waiting for delivery (`pendingSteering`), steering that the run ended without delivering (`returnedSteering`), the queued follow-ups themselves (`pendingFollowUps`) and the live subagent children (`subagents`). An absent field means none.
- `session_title` is sent on the Session's channel and on the user channels of the Project's owner and members.
- `session_state` names the Session by `sessionId`, so every row of a Session list stays live, not only the conversation a client has open. It carries the row fields needed to redraw the row without refetching: `lastActiveAt` as just stamped, and `hasTrace`, which is true whenever the state is `running` or `compacting`, because a running Session has by definition started a Task. It is sent to the user channels of the Project's owner and members.
- `session_background` fires when a command moves to the background past its yield window or starts with `run_in_background`, when a process exits or is stopped, and when a background subagent starts, settles or is released. It carries `SessionInfo.backgroundTasks` as it now stands (`processes` = background command sessions still running, `subagents` = subagent Sessions moved to the background and mid-round), zeros included, so a list can clear its mark without refetching. The list rows and the single-Session GET omit the field when both counts are zero. Its audience is the same as for `session_state`.
- `credentials_updated` follows `PUT /models` or a completed key-minting flow. Cached runtimes were invalidated, so the client clears any composer state disabled by an auth failure.
- `web_updated` carries the new web revision as `rev` and is sent to every user channel.
- `session_created` is sent on the parent Session's channel.
- `schedule_fired` names in `sessionId` the Session that received the prompt, which in new-Session mode is a new Session. A queued firing is sent once the Session is idle.
- `goal_round` carries `used`, the tokens counted so far.
- The `org_*` events are sent to the user channels of the Project's members. `org_channel` includes the message's mentions, so a client can tell whether it is addressed. These events are best effort; the organization routes carry the durable state.

### Delivery Guarantees

- Event ids increase monotonically per channel and have the form `<epoch>-<seq>`.
- Each channel keeps a bounded replay buffer: the most recent 10,000 events or 8MB.
- On reconnect with `Last-Event-ID`, the server replays the gap if the id is still in the buffer. Otherwise it first sends `resync_required`, and the client refetches `/messages` before continuing.
- A heartbeat comment line is written every 20 seconds.
- Event order: on a reconnect that carries `Last-Event-ID`, the replayed gap (or `resync_required`) arrives first, then the initial events (the authoritative `task_state` snapshot and any still-pending `approval_request`s), then the live stream. A fresh connection without `Last-Event-ID` skips the replay, so its first event is the `task_state` snapshot.

### Recommended Client Pattern

The bundled Web App connects in this order:

1. Connect to `/stream` first and buffer the incoming events.
2. GET `/messages` for the history.
3. If the response carries `live` (a Task is running), drop the buffered partial events the cursor already covers and apply `live.fragments` on top of the history. The in-progress message reappears with its streamed prefix intact.
4. Replay the buffer, removing the overlap.
5. Continue with the live stream.

## Type Imports

All DTO types can be imported, type-only, from the server package's `@prismshadow/penguin-server/api` subpath:

```ts
import type { ServerEvent, SessionInfo } from "@prismshadow/penguin-server/api";
```
