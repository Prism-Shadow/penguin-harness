# @prismshadow/penguin-server

The PenguinHarness Web backend — the Web implementation of the SDK's Human boundary. HTTP carries Prompt input, approvals and interrupts; Server-Sent Events stream the OmniMessage output. Adds multi-user auth, Project authorization, Session runtime, scheduling and usage accounting on top of `@prismshadow/penguin-core`.

## Architecture

- **HTTP**: Hono + `@hono/node-server`; `createApp(deps)` is pure assembly (no port bind — tests drive it via `app.request()`); `index.ts` is the startup entry (dotenv, graceful shutdown).
- **Storage**: SQLite via Node's built-in `node:sqlite` (WAL) holds only indexes and aggregates (users, auth sessions, Project authorization, Agent/Session indexes, usage, UI prefs, error records). Agent State, Traces and Workspaces stay as files under `~/.penguin/data/<project>/agents/<agent>/`, fully shared with the SDK and CLI.
- **Runtime**: a session manager keeps active Sessions (get-or-resume-or-heal, per-Session mutex, run/compact driving); approvals surface over SSE as `approval_request` and decisions re-read the stored approval mode each time; interrupts converge pending approvals to deny before aborting; a scheduler fires `agent_state/schedule/*.toml` tasks while the service runs.
- **SSE**: per-channel monotonic event ids with a bounded replay buffer (1000 events / 2MB); reconnects replay from `Last-Event-ID` or receive `resync_required`; heartbeat comment every 20s.
- **Usage**: `token_usage` events are persisted row by row; costs are computed at query time from current per-model pricing.

The full route tables and the SSE protocol are documented in the [Server API reference](https://prism-shadow.github.io/penguin-harness/docs/server-api). DTO types are exported for type-only import via `@prismshadow/penguin-server/api`.

## Environment

| Variable | Meaning | Default |
| --- | --- | --- |
| `PORT` / `HOST` | Listen port / address | `7364` / `127.0.0.1` |
| `PENGUIN_HOME` | Data root (shared with SDK/CLI) | `~/.penguin/data` |
| `PENGUIN_WEB_DB` | SQLite file path | `<root>/web.db` |
| `PENGUIN_WEB_DIST` | Front-end build dir (static hosting + SPA fallback when present) | `../web/dist`, or the bundled `web-dist/` in the npm package |

`.env` in the process cwd is loaded automatically.

## Running

```bash
pnpm --filter @prismshadow/penguin-server dev     # tsx watch (front end via the Vite dev proxy)
pnpm --filter @prismshadow/penguin-server build   # tsup → dist/
pnpm --filter @prismshadow/penguin-server start   # node dist/index.js
```

`pnpm typecheck / test` run tsc and vitest (tests use a temp root + in-memory DB; no ports, no live LLM calls).

## Security notes (known MVP limits)

- **CSRF**: session cookie is `SameSite=Lax` and writes accept only `Content-Type: application/json`; no CSRF token yet.
- **No login rate limiting**: add throttling at a reverse proxy for public deployments.
- **Built-in admin starts as `admin` / `admin123`**: change it immediately (a banner keeps reminding until you do).
- Passwords use `node:crypto` scrypt (`scrypt$N$r$p$salt$hash`, timingSafeEqual); login sessions renew on a 7-day sliding window; the DB stores only the token's sha256.
- Model credentials live in the Project's hidden 0600 config file; the API always masks them.
- Behind a reverse proxy, disable response buffering for SSE paths (the server already sends `X-Accel-Buffering: no`) and forward `x-forwarded-proto` to enable Secure cookies.

Part of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
