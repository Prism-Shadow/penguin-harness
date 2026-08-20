---
title: Server Boot and Subsystems
description: The assembly order from process entry to HTTP listen, each subsystem's external surface, and where extensions sit in the two-level process/App lifecycle.
---

`server/src/index.ts` is a side-effecting module: importing it starts the server — the contract the CLI relies on to run a server inside its own process. The startup order is written out in `main()`, one `PenguinServer` method per step, the method name being the step name. Assembly itself is split in two — `bootAppDeps(config)` builds the runtime core, publishes its capabilities and boots the platform (the business surface is assembled inside it), while `createApp(deps)` assembles the runtime shell's Hono route table without listening — so tests can take the full app and drive it via `app.request(...)` with no port involved and without going through `index.ts` at all.

This page answers two questions: in what order does the process bring each subsystem up, from entry to listen; and what is each subsystem's **external surface** — the way others depend on it: exported types, HTTP routes, events, or the context members extensions receive.

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
├─ ④ loadExtensions                   read <root>/extensions.json → import → fill this process's one ExtensionHost
├─ ⑤ buildDeps = bootAppDeps      open the DB → runtime core (auth, ChannelHub, HmrHost) → publish the
│                                  capabilities (db/auth/channels/config/proxy/desktop/extension host) →
│                                  hmr.ensure() boots the platform: its create() assembles the WHOLE
│                                  business surface (services, routes, scheduler) and delivers the hooks
├─ ⑥ applyPersistedProxy           the DB is open: align the dispatcher with the persisted settings
├─ ⑦ buildApp                      the runtime shell: guards, /api/auth, /api/desktop, /api/hmr, seam, static
├─ ⑧ seedAdmin                     built-in admin seed (initial-Project provisioning late-binds via the registry)
├─ ⑨ listen                        listening starts; the callback writes back the real port, takes the lock, writes the port file, opens the ::1 companion
└─ ⑩ installProcessHandlers        signals, the desktop quit path, the process-level error fallback
```

The order is not arbitrary — four of its constraints are hard: the proxy takes over global `fetch` before any outbound request can happen; the instance lock is checked **before** the database opens, because `web.db` is single-writer; extensions finish loading **before** ⑤, and the host enters the registry with the other capabilities before the platform boots, so they are present for the very first App creation; and the platform — the whole business surface with it — finishes booting before `listen`, so **no request is ever served before business and extensions are in place**. `installProcessHandlers` comes last, after `listen`, so shutdown can never fire before there is a listener for it to close.

Extension loading sitting after `ensureSoleInstance` is deliberate too: a process about to exit with code 3 has no business importing third-party modules and running their top-level side effects first.

## Two lifecycles: process and App

The runtime core (the DB, auth, the ChannelHub, the HmrHost) is built once and lives until the process exits. **Everything else is platform-level**: the whole business surface — services, routes, the SessionManager, the Scheduler — together with the terminal manager, extension delivery and workflow instances is rebuilt at every App creation (every boot and every hot swap, a new bundle pushed via `POST /api/hmr/upgrade`).

```text
Process-level (runtime mechanism, once)   App-level (the business surface, re-run per boot + per hot swap)
───────────────────────────              ─────────────────────────────────────────────────
SQLite · auth (AuthService)               every business service and route (services + http/routes)
ChannelHub (SSE survives swaps)           SessionManager · Scheduler
HmrHost · the resource registry           TerminalManager (adopts parked ptys)
extensions.json load + activate (⑤ pub.)     "initialize" / "create" event delivery · workflow instances
```

**Swap semantics: unparked state HARD-STOPS** — pending approvals are denied, active runs abort, the scheduler dies with its App, and the next App rebuilds everything from the claimed capabilities. Only resources that implement park/adopt (terminal ptys) ride across.

Resources carry an interface contract of their own — but it does not live on the kernel iface: the declaration is itself a registry entry (`resource-interfaces`, group→version by ID prefix, e.g. `{ terminal: 1, platform: 1 }`), written by each App's `create()` and left for its successor. Before adopting anything, the new App reads its predecessor's declaration and compares it with its own compiled-in one: a group both declare at the same version integrates and rides across; a group whose versions differ, or that this build stops declaring, is disposed entry by entry in **reverse registration order** and rebuilt fresh (live objects cannot be strict-parsed the way the context document is, so declaration agreement is the integration criterion). The kernel's park/validate/swap mechanism neither participates in nor knows about this convention — which means the reconciliation policy itself evolves by platform push. Runtime capabilities (`runtime:*`) get the symmetric defense on their side: a bundle carries the capability-contract version it was compiled against, and `claimRuntimeCapabilities` handshakes it against the runtime's published one before trusting any claim — a mismatch declines the whole set and degrades to terminals-only instead of a TypeError at use time.

The dividing line is the **resource registry**: it sits outside the reloadable platform tree, so it survives across Apps. The pty processes are parked in it and the new App merely reclaims their handles, which is why a hot swap is invisible to whoever is typing in a terminal; the ExtensionHost, the DB handle, the auth service and the SSE hub travel the same road — published by the runtime, claimed by each App.

This is not merely tidiness. A pushed bundle is compiled **standalone** — a self-contained ESM file (`bundle: true`, no externals) with its own module graph — so a module-level host singleton on the platform side would, after a push, be that bundle's own empty host, and every configured extension would silently vanish on the first hot push. Claiming rather than importing is what makes the packaged App and the pushed App drive the same host. When the runtime published none, the fallback is an empty host — the honest reading of "this runtime knows nothing about extensions". The same reasoning is spelled out in `terminal/identity.ts`.

## App creation: where extensions run

The full App-creation order is `platformImpl.create` in `server/src/hmr/platform.ts`:

```text
platformImpl.create
│
├─ new TerminalManager(resources)    # adopt the ptys the previous instance parked
├─ extensions = extensionHostFrom(resources)  # claim the host the runtime loaded in ④ (empty host if none was published)
├─ iface = { workflow, tool, sandbox }   # a fresh definition view per App
├─ extensions.emit("initialize", iface) # the definition view, to every handler, in activation order
├─ sandbox = new SandboxService(registered backends)   # rehydrated from the parked settings
├─ extensions.emit("create", {          # the instance view, assembled after registration closes
│    workflows: instantiateWorkflows(iface.workflow),  # every factory is called eagerly here
│    terminals,
│    sandbox: { configure, settings },
│  })
├─ caps = claimRuntimeCapabilities(resources)   # db/auth/channels/config/proxy/desktop
└─ business assembly (when caps are all present): buildAppDeps — the sandbox confiner
   rides in as an argument, into the session loader's spawn path → scheduler.start()
   → orphaned-Goal reconciliation → createApp (terminal + business groups in ONE Hono app)
   → one registry write publishes the {deps, app, shutdown} pointer
   → ctx.effect registers the hard stop for the next swap
```

Split by frequency, the extension lifecycle has three tiers:

| Moment                  | Frequency        | What happens                                                                                                   |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Load + `activate(ctx)`  | Once per process | Boot step ④ `loadExtensions`: resolve and import each specifier in `extensions.json`, then run its exported `activate` (awaited when async) — the only window where `ctx.on(...)` subscribes and `ctx.disposables` accepts cleanup. A failing entry is rolled back (its disposables run) and skipped; an unreadable or malformed `extensions.json` fails the boot |
| `"initialize"` event    | Once per App     | Handlers register workflow factories and sandbox backends into the fresh `iface` (the `tool` slot is reserved, unused) |
| Workflow instantiation  | Once per App     | `instantiateWorkflows` calls **every** factory synchronously before the emit — instances are born in one batch at App creation, not on first call |
| `"create"` event        | Once per App     | Handlers receive the instance view `ctx` (`workflows` + `terminals` + `sandbox`)                                |
| `workflows.run`         | Per call         | A plain function call: no Session, no approval, no streaming                                                    |
| Disposables             | Once per process | Awaited (≤5s) in the graceful shutdown; disposers may be async, run concurrently with failures isolated — so they must be mutually independent |

Several behavioral facts follow:

- **Per-App redelivery**: `"initialize"` and `"create"` are redelivered at every App creation, so registrations always land in the current instance — a post-swap App can never run with empty registrations.
- **Instances do not cross a swap**: factories re-run per App, so a stateful workflow never carries the previous instance's state across a hot swap.
- **The subscription window is `activate`, sealed on return**: a handler-time `ctx.on(...)` would accumulate one copy per hot swap, so it throws instead — at the packaged boot, loudly, not as a slow leak. Disposables seal with the same window for the same reason.
- **Handlers are synchronous and unwrapped**: extension *loading* failures (import, or a throwing/rejecting `activate`) are isolated per entry, but event handlers run without a try/catch — a throwing handler fails that platform boot, and a handler that returns a promise is refused for the same reason (an App is assembled synchronously around the emit, so its rejection could only escape unhandled).
- **A duplicate workflow name is refused**: `iface.workflow` is a registry whose `set` throws, so a name cannot change owner depending on `extensions.json` ordering.
- **The event vocabulary is typed and lives in one place**: `ExtensionEvents` maps each name to its payload — adding an event types the platform's emit and every handler at once.
- **Confinement is same-generation wiring**: the confiner reaches core as a plain argument to `buildAppDeps`, and the sessions spawning through it are hard-stopped with their App — what crosses the swap is the active settings on the parked context, so a push cannot silently un-confine a deployment.

The extension contract (`Extension` / `ExtensionContext` / `ExtensionEvents` / `PenguinInterface` / `PenguinContext`) is declared in the SDK, at `@prismshadow/penguin-core/extension`. `PenguinContext` and `PenguinInterface` are open: the harness contributes the members it owns — `terminals` — by augmenting that module, and re-exports both halves from `@prismshadow/penguin-server/extension`. Both subpaths emit types only. Which extensions exist is the deployment's `<root>/extensions.json`; the harness itself imports no extension.

## Subsystem inventory

Each subsystem's construction site and external surface (step numbers refer to the boot sequence above):

| Subsystem            | Constructed                                      | External surface                                                                                              |
| -------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Config               | `config.ts` `resolveServerConfig` (②)            | `ServerConfig`; its only post-listen mutation writes back the real port                                         |
| Single-instance lock | `lock.ts` (③ pre-check, ⑨ acquire)               | Package subpath `@prismshadow/penguin-server/lock`; the CLI and Desktop use it for pre-launch probing           |
| Database             | `db/database.ts` `openDatabase` (first step of ⑤)| Repo classes under `db/repos/*`; WAL, foreign keys, additive `ensureColumn` migrations                          |
| Auth                 | `auth/service.ts` (⑤, runtime mechanism)          | `/api/auth/*`, the cookie `authMiddleware`, and authentication of terminal WS upgrades                          |
| Project / Session    | `services/*` — **App-level** (assembled in create)| `/api/projects/**`, `/api/sessions/**` (route details in [Server API](/server-api))                             |
| Agent runtime        | `runtime/session-manager.ts` — **App-level**      | Task / approval / abort / compact routes and SSE `GET /:sessionId/stream`; delegates to core via `createAgent`  |
| Events               | `runtime/channel.ts` `ChannelHub` (⑤, runtime; SSE streams survive swaps)| User-level SSE `GET /api/events`; the `ServerEvent` type family                                                 |
| Scheduler            | `runtime/scheduler.ts` — **App-level** (started/stopped by create)| The schedules routes; publishes results into the ChannelHub                                                     |
| HMR host / platform  | `hmr/host.ts` (end of ⑤)                         | `PlatformApi` (`park` / `info` / `http` / `terminals` / `attachStream`); `POST /api/hmr/upgrade` is a runtime-owned route, never offered to the platform |
| Terminals            | `terminal/` — **App-level**             | `/api/terminals*` route group (registered into the platform's one Hono app), WS `GET /api/terminals/:id/stream`; ptys are parked and survive swaps |
| Extension host          | built by ④ `loadExtensions`, published to the registry in ⑤ | `activate(ctx: ExtensionContext)` + the `ExtensionEvents` registry; the configuration surface is `<root>/extensions.json` |
| Sandbox              | `sandbox/service.ts` — **App-level** (built in create, over the backends extensions registered) | `iface.sandbox.registerProvider` / `ctx.sandbox.{configure,settings}`; enforcement reaches commands through core's spawn seam, and backends are extension packages named in `extensions.json` |
| Model catalog        | No boot-time construction — static core data     | `/api/projects/:projectId/models`; the catalog itself lives in `core/src/state/model-catalog.ts`                |

One request-time path is worth knowing: the platform's HTTP seam offers every request to the current App's `http(request)` first, and only a `null` return falls through to the runtime's own routes; while a hot swap is in flight, requests queue at the seam for the new App instead of hitting a half-disposed one.

For the overall layering and the core engine boundary see the [Architecture overview](/architecture); for the HTTP route details see the [Server API](/server-api).
