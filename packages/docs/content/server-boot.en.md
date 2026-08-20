---
title: Server Boot and Subsystems
description: The assembly order from process entry to HTTP listen, each subsystem's external surface, and where plugins sit in the two-level process/App lifecycle.
---

`server/src/index.ts` is a side-effecting module: importing it starts the server — the contract the CLI relies on to run a server inside its own process. The startup order is written out in `main()`, one `PenguinServer` method per step, the method name being the step name. Assembly itself is split in two — `buildAppDeps(config)` builds the service object graph, `createApp(deps)` assembles the Hono route table without listening — so tests can take the full app and drive it via `app.request(...)` with no port involved and without going through `index.ts` at all.

This page answers two questions: in what order does the process bring each subsystem up, from entry to listen; and what is each subsystem's **external surface** — the way others depend on it: exported types, HTTP routes, events, or the context members plugins receive.

## Process entry

| Entry                                   | Mechanism                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Direct                                  | `node dist/index.js` (`start` in `server/package.json`)                                                                                          |
| CLI (`penguin server` / `penguin web`)  | Sets `PORT`/`HOST` env vars, then `import("@prismshadow/penguin-server")` **in the same process** — no fork; `penguin web` additionally polls for readiness and opens the browser |
| Desktop                                 | `utilityProcess.fork` launches a **separate** server process, injecting `PENGUIN_HOME`, `PORT`, `PENGUIN_DESKTOP_TOKEN`, `PENGUIN_PORT_FILE` via env |

All three converge: the same env vars drive the same module. The server's own configuration comes from environment variables only (`server/src/config.ts`); `system_config.yaml` is Agent-level state, read when a Session runs — it plays no part in server boot.

## Boot sequence

```text
main()  —— one PenguinServer method per line
│
├─ ① loadEnv · installProxy        dotenv first (.env may define HTTP_PROXY itself), then the proxy takes over fetch
├─ ② readConfig                    env only: PENGUIN_HOME, PORT, HOST, PENGUIN_WEB_DB …
├─ ③ ensureSoleInstance            data root held by another live instance → exit code 3 (before the DB opens)
├─ ④ buildDeps                     object graph: SQLite → repos → services → SessionManager → HmrHost
├─ ⑤ applyPersistedProxy           the DB is open: align the dispatcher with the persisted settings
├─ ⑥ buildApp                      middleware and route table (assembly only, no listen)
├─ ⑦ bootPlatform                  hmr.ensure() = the first App creation: plugins load and receive delivery here
├─ ⑧ seedAdmin · startScheduler · reconcileOrphanedGoals
├─ ⑨ listen                        listening starts; the callback writes back the real port, takes the lock, writes the port file, opens the ::1 companion
└─ ⑩ installProcessHandlers        signals, the desktop quit path, the process-level error fallback
```

The order is not arbitrary — three of its constraints are hard: the proxy takes over global `fetch` before any outbound request can happen (persisted settings are re-read only after the DB opens in ④, and nothing in between makes an outbound call); the instance lock is checked **before** the database opens, because `web.db` is single-writer; and `bootPlatform` completes before `listen`, so **no request is ever served before plugins are in place**. `installProcessHandlers` comes last, after `listen`, so shutdown can never fire before there is a listener for it to close.

## Two lifecycles: process and App

Most subsystems are built once in ④ and live until the process exits. The **platform layer** is different: it is the hot-swappable unit (a new bundle pushed via `POST /api/hmr/upgrade`), and every boot and every hot swap creates a fresh **App** — the terminal manager, plugin delivery, and workflow instances all live at App level.

```text
Process-level (built once)               App-level (re-run at every boot + every hot swap)
──────────────────────────              ─────────────────────────────────────────────────
SQLite and all repos                     TerminalManager (adopts parked ptys)
Auth / Project / Session services        plugin definition view iface{ workflow, tool }
SessionManager · ChannelHub              onCreateApp delivery
Scheduler · HmrHost                      workflow instances (all built eagerly)
plugins.json load + pluginHost.use()     "create" event delivery
```

The pty processes themselves are parked in the runtime's resource registry and survive across Apps — the new App merely reclaims their handles, which is why a hot swap is invisible to whoever is typing in a terminal.

## App creation: where plugins run

The full App-creation order is `platformImpl.create` in `server/src/platform/platform.ts`:

```text
platformImpl.create
│
├─ new TerminalManager(resources)    # adopt the ptys the previous instance parked
├─ ensureConfiguredPlugins(root)     # first App only: read <root>/plugins.json → import → pluginHost.use()
├─ iface = { workflow: new Map(), tool: new Map() }   # a fresh definition view per App
├─ pluginHost.createApp(iface)       # every plugin's onCreateApp, synchronously, in registration order
└─ pluginHost.emit("create", {       # the only event the platform emits yet
     workflows: instantiateWorkflows(iface.workflow),  # every factory is called eagerly here
     terminals,
   })
```

Split by frequency, the plugin lifecycle has three tiers:

| Moment                  | Frequency        | What happens                                                                                                   |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Module load             | Once per process | Resolve and import each specifier in `plugins.json`; a failing entry is isolated and logged, never fatal        |
| onCreateApp             | Once per App     | Plugins register workflow factories into the fresh `iface` (the `tool` slot is reserved, unused)                |
| Workflow instantiation  | Once per App     | `instantiateWorkflows` calls **every** factory synchronously before the emit — instances are born in one batch at App creation, not on first call |
| `"create"`              | Once per App     | Plugins receive the instance view `ctx` (`workflows` + `terminals`)                                             |
| `workflows.run`         | Per call         | A plain function call: no Session, no approval, no streaming                                                    |

Several behavioral facts follow:

- **Per-App redelivery**: `onCreateApp` and `"create"` are redelivered at every App creation, so registrations always land in the current instance — a post-swap App can never run with empty registrations.
- **Instances do not cross a swap**: factories re-run per App, so a stateful workflow never carries the previous instance's state across a hot swap.
- **Hooks are synchronous and unwrapped**: plugin *loading* failures are isolated (skipped and logged), but `onCreateApp` / `subscribe` run without a try/catch — a throwing hook fails that platform boot.
- **Event names are an open set**: `"create"` is the only event the platform emits so far.

The plugin type surface (`RawPlugin` / `PenguinInterface` / `PenguinContext`) is exported types-only via the package subpath `@prismshadow/penguin-server/plugin`; which plugins exist is the deployment's `<root>/plugins.json` — the harness itself imports no plugin.

## Subsystem inventory

Each subsystem's construction site and external surface (step numbers refer to the boot sequence above):

| Subsystem            | Constructed                                      | External surface                                                                                              |
| -------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Config               | `config.ts` `resolveServerConfig` (②)            | `ServerConfig`; its only post-listen mutation writes back the real port                                         |
| Single-instance lock | `lock.ts` (③ pre-check, ⑨ acquire)               | Package subpath `@prismshadow/penguin-server/lock`; the CLI and Desktop use it for pre-launch probing           |
| Database             | `db/database.ts` `openDatabase` (first step of ④)| Repo classes under `db/repos/*`; WAL, foreign keys, additive `ensureColumn` migrations                          |
| Auth                 | `auth/service.ts` (④)                            | `/api/auth/*`, the cookie `authMiddleware`, and authentication of terminal WS upgrades                          |
| Project / Session    | `services/*` (④)                                 | `/api/projects/**`, `/api/sessions/**` (route details in [Server API](/server-api))                             |
| Agent runtime        | `runtime/session-manager.ts` (④)                 | Task / approval / abort / compact routes and SSE `GET /:sessionId/stream`; delegates to core via `createAgent`  |
| Events               | `runtime/channel.ts` `ChannelHub` (④)            | User-level SSE `GET /api/events`; the `ServerEvent` type family                                                 |
| Scheduler            | `runtime/scheduler.ts` (assembled ④, started ⑧)  | The schedules routes; publishes results into the ChannelHub                                                     |
| HMR host / platform  | `hmr/host.ts` (end of ④)                         | `PlatformApi` (`park` / `info` / `http` / `terminals` / `attachStream`); `POST /api/hmr/upgrade` is a runtime-owned route, never offered to the platform |
| Terminals            | `platform/terminal/` — **App-level**             | `/api/terminals*` routes (mounted into the main app through the platform HTTP seam), WS `GET /api/terminals/:id/stream`; ptys are parked and survive swaps |
| Plugin host          | `platform/plugin.ts` module-level singleton (process-level) | `RawPlugin` / `PenguinInterface` / `PenguinContext`; the configuration surface is `<root>/plugins.json` |
| Model catalog        | No boot-time construction — static core data     | `/api/projects/:projectId/models`; the catalog itself lives in `core/src/state/model-catalog.ts`                |

One request-time path is worth knowing: the platform's HTTP seam offers every request to the current App's `http(request)` first, and only a `null` return falls through to the runtime's own routes; while a hot swap is in flight, requests queue at the seam for the new App instead of hitting a half-disposed one.

For the overall layering and the core engine boundary see the [Architecture overview](/architecture); for the HTTP route details see the [Server API](/server-api).
