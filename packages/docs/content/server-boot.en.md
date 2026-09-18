---
title: Server Boot and Subsystems
description: The assembly order from process entry to a serving App, each subsystem's external surface, and where plugins sit in the two-level process/App lifecycle.
---

`server/src/index.ts` is a side-effecting module: importing it starts the server. That is the contract the CLI relies on to run a server inside a Node process of its own choosing.

The startup order is written out in `main()`: one `PenguinServer` method per step, and the method name is the step name. Assembly itself is split in two:

- `bootAppDeps(config)` builds the process core: the database, the channel hub and the HMR host. It publishes them into the resource registry and boots the platform. The business surface is assembled inside the platform.
- `createApp(boot)` assembles the layer's own Hono app: network guards, the platform seam and static hosting. It does not listen. Tests can take the full app and drive it via `app.request(...)`, with no port involved and without going through `index.ts` at all.

This page answers two questions:

- In what order does the process bring each subsystem up, from entry to a serving App? See [Process entry](#process-entry) and [Boot sequence](#boot-sequence).
- What is each subsystem's **external surface**, meaning the way others depend on it: exported types, HTTP routes, events, or the interfaces plugin modules may require? See [Subsystem inventory](#subsystem-inventory).

## Process entry

Four mechanisms start the server. All of them converge: the same env vars drive the same module.

| Entry | Mechanism |
| --- | --- |
| Direct | `node dist/index.js` (`start` in `server/package.json`) |
| CLI (`penguin server` / `penguin web`) | Sets `PORT`/`HOST` and exports `PENGUIN_CLI_ENTRY`, then runs the server as a **supervised child process** that imports `@prismshadow/penguin-server` |
| CLI auto-start | A CLI command that finds no running server spawns a detached `server` subcommand with `PORT=0` and attaches once the root's lock is live |
| Desktop | `utilityProcess.fork` launches a separate server process with the server's env injected |

The supervised child runs as `node <entry> server …`, marked `PENGUIN_SERVE_CHILD=1` and told `PENGUIN_SUPERVISED=1`. The parent forwards the terminal's signals, exits with the child's code, and relaunches the child when it exits with the restart code that **Restart to update** asks for. A dev run through tsx cannot be re-spawned by node, so the CLI imports the server in-process instead. `penguin web` additionally polls for readiness and opens the browser.

Auto-start output goes to `<root>/logs/server-auto-<date>.log`.

The desktop process injects `PENGUIN_HOME`, `HOST`, `PORT`, `PENGUIN_DESKTOP_TOKEN` and `PENGUIN_PORT_FILE` via env, plus `PENGUIN_WEB_DIST` and `PENGUIN_CLI_ENTRY` when the app pins them.

> [!NOTE]
> The server's own configuration comes from environment variables only (`server/src/config.ts`). `system_config.yaml` is agent-level state, read when a Session runs; it plays no part in server boot.

## Boot sequence

`main()` writes the order out, one `PenguinServer` method per line:

```text
main()  —— one PenguinServer method per line
│
├─ ① loadEnv · installProxy        dotenv first (.env may define HTTP_PROXY itself), then the proxy takes over fetch
├─ ② readConfig                    env only: PENGUIN_HOME, PORT, HOST, PENGUIN_WEB_DB …
├─ ③ ensureSoleInstance            data root held by another live instance → exit code 3 (before the DB opens)
├─ ④ listen                        bind the port now; answer 503 "starting" until ⑧. The callback writes back
│                                  the real port, takes the lock, and opens the ::1 companion on a loopback bind
├─ hmrMain(createHost(), replace, start)          the HMR layer's entry runs start, then makes the first generation current
│  ├─ ⑤ loadPlugins                a shim for platforms that predate loading their own plugins: import what the
│  │                               Projects' [plugins] tables name into a host the first App can reuse
│  ├─ ⑥ buildDeps = bootAppDeps    open the DB → process core (ChannelHub, auth state + local API token, CLI shim) →
│  │                               publish the capabilities (interfaces descriptor, config, db, auth state, channels,
│  │                               proxy, HMR host + control, desktop, lifecycle, plugin host) → hmr.ensure() boots
│  │                               the platform: its create() assembles the WHOLE business surface
│  ├─ ⑦ applyPersistedProxy        the DB is open: align the dispatcher with the persisted settings
│  ├─ ⑧ buildApp                   the layer's app: guards, the platform seam, static hosting; terminal WS on each listener
│  ├─ ⑨ seedAdmin                  built-in admin seed; decides whether a first-login link is due
│  ├─ ⑩ installProcessHandlers     signals, the desktop quit path, restart-to-update, the process-level error fallback
│  └─ ⑪ printFirstLoginNotice      the one-time sign-in link, when one is due
└─ ⑫ announce                      write the port to PENGUIN_PORT_FILE: the App is up
```

The order is not arbitrary, and its constraints are hard:

- The proxy takes over global `fetch` before any outbound request can happen.
- The instance lock is checked **before** the database opens, because `web.db` is single-writer.
- The plugin host enters the registry with the other capabilities before the platform boots, so the plugin objects ⑤ imported are there for the first App to reuse, as each App's are for the next.
- The platform, with the whole business surface in it, finishes booting before ⑧ hands the listener its app.
- The port is bound early on purpose. Until ⑧, every request gets `503 penguin-server is starting` with `retry-after: 1`, so a client that arrives early sees "starting" rather than a refused connection. **No business request is ever served before the platform and plugins are in place.**
- The port announcement comes last, because the desktop shell opens its window on it.
- `installProcessHandlers` comes after `listen`, so shutdown can never fire before there is a listener for it to close.

Plugin loading sits after `ensureSoleInstance` by design as well: a process about to exit with code 3 has no business importing third-party modules and running their top-level side effects first.

## Process and App lifecycles

The process core is built once and lives until the process exits. It contains the SQLite handle, the ChannelHub, the process-scoped auth values such as the local API token, and the HMR host with its resource registry.

Everything else is platform-level. The whole business surface — services, routes, the AuthService, the SessionManager, the Scheduler — is rebuilt at every App creation, together with the terminal manager, the plugin host and the plugin modules. An App creation happens at every boot, at every hot swap, where a new bundle is pushed via `POST /api/hmr/upgrade`, and at every change to a Project's plugin list, where the App [re-assembles itself](#re-assembly) from the same bundle.

```text
Process-level (HMR layer, once)           App-level (the business surface, re-run per boot + per hot swap + per re-assembly)
───────────────────────────────           ─────────────────────────────────────────────────
SQLite · auth state (API token …)         every business service and route (AuthService included)
ChannelHub (SSE survives swaps)           SessionManager · Scheduler · messaging bridge
HmrHost · the resource registry           TerminalManager (adopts parked ptys)
the plugin host (imported objects)        plugin lists read + imported, modules created as children of the tree
```

The dividing line between the two levels is the **resource registry**. It sits outside the reloadable platform tree, so it survives across Apps. The pty processes are parked in it, and a new App merely reclaims their handles; that is why a hot swap is invisible to whoever is typing in a terminal. The DB handle, the auth state and the SSE hub travel the same road: published by the process, claimed by each App. The plugin host is handed on the same way: each App registers the host it built, and the next App claims it to reuse the plugin objects it holds.

### Swap semantics

**Unparked state HARD-STOPS** at a swap. Pending approvals are denied and active runs abort. The scheduler, the messaging bridge and machine connections stop with their App, and the next App rebuilds them from the claimed capabilities. Between the old App's dispose and the new App's boot, the kernel waits for the aborted runs to drain, for up to 5 s.

What rides across:

| What survives | How |
| --- | --- |
| Terminal ptys | Parked in the registry; the new App reclaims their handles |
| Machine tunnels | ssh child processes the successor adopts by pid |
| Process-level singletons | Live in the process core, outside every App |

### Resource interface contracts

Resources carry an interface contract of their own, but the contract does not live on the kernel iface. The declaration is itself a registry entry, `platform.resourceInterfaces`. It is a descriptor that names a family, `penguin`, and, per ID-prefix group, the members its adopters use. The `terminal` group lists every member a parked pty is reached through. Each App's `create()` writes the declaration and leaves it for its successor.

Before adopting anything, the new App reads its predecessor's declaration and compares it with its own compiled-in one:

- A group declared in the same family that offers every member this build needs integrates, and its resources ride across.
- Any other group — a different family, a missing member, or a group this build no longer declares — is disposed entry by entry in **reverse registration order** and rebuilt fresh.

Live objects cannot be strict-parsed the way the context document is, so declaration agreement is the integration criterion.

The decision is taken first but acted on only once the new App is fully built. A boot that fails midway can therefore still hand the live resources back to the previous generation.

The kernel's park/validate/swap mechanism neither participates in nor knows about this convention. The reconciliation policy itself therefore evolves by platform push.

### Capability claims

The process capabilities get the symmetric defense on their side. The process publishes a descriptor, `platform.interfaces`, naming per capability the members a claimer reaches for. Before trusting a claim, `claimHmrCapabilities` checks the descriptor, and the live objects behind it, against the copy compiled into the bundle.

A mismatch refuses the claim, so the boot fails and the push is rolled back, instead of surfacing as a `TypeError` at use time. A descriptor of the same family that offers none of the capabilities declares a bare kernel, which boots terminals only.

Claiming from the registry, rather than importing, is not merely tidiness. A pushed bundle is compiled **standalone**: a self-contained ESM file (`bundle: true`, no externals) with its own module graph. A module-level singleton on the platform side would, after a push, be that bundle's own fresh copy, holding none of what the process built. Claiming rather than importing is what makes the packaged App and the pushed App drive the same database, channel hub and auth state. The plugin host follows the same rule: a pushed App can reuse the plugin objects an earlier App imported only because it claims them. When nothing was published, the claim yields an empty host — the honest reading of "this runtime knows nothing about plugins".

## App creation

App creation lives in `server/src/hmr/platform.ts`. `platformImpl.create` boots the App proper, `createInner`, as an inner instance behind a shell the runtime holds, which is what lets the App [re-assemble itself](#re-assembly). The full order of `createInner`:

```text
createInner
│
├─ claim = claimHmrCapabilities(resources)   # refused → throw (the boot fails); bare → terminals only
├─ migrate(caps.db, { swapPath: true })      # a pushed platform brings its own migrations
├─ decide which parked resource groups to adopt (platform.resourceInterfaces)
├─ plugins = loadPluginHost(resources, root, assetsDir)
│    # read the Projects' [plugins] tables and import what they name, reusing the objects of the
│    # host an earlier App registered; a bare kernel keeps the claimed host (empty if none)
├─ tree = bootModules(platformDef(caps, adoptable, plugin modules, replacements, reassemble), { ifaces, resources, parked })
│    # THE TREE (server/src/platform.ts): every service and repo is a @Component
│    # (a class that exports itself), the session runtime, the terminal manager and the
│    # http assembly are @Modules (classes that export others). Their manifests (read off
│    # the decorators by gen-ifaces) are checked first — requires resolved by signature,
│    # contributions validated against their slots — then setup() runs in dependency
│    # order. Plugin modules (a package's ifaces.json) are children of the same tree.
├─ ctx.effect: manager.shutdown drain + tree.dispose() (every module's effects, reverse order)
└─ commit: dispose the groups not adopted, register this build's resource declaration and this App's plugin host
```

### What a plugin is

A plugin is a set of modules: the unit the harness itself is built from, written the same way. Plugin code uses `@Component` / `@Module` classes with `@Use` / `@Provide` / `@Bind` fields.

A package's manifests are generated, not written. The package's build runs `gen-ifaces` over its own tsconfig and ships the resulting `ifaces.json` beside its `package.json`. That table is the package's module payload, and a package is a plugin by being listed in a Project's `[plugins]` table.

The default export is `{ modules?: [<class>, …], replaces?: [<class>, …] }`:

- `modules` — the nodes the package adds.
- `replaces` — the nodes it stands in for: a class of the replaced node's name, which can be a component, a module, or a whole group.

Each class named in the default export is checked against its manifest in the table at load. A stand-in is not checked when it is put in place. The tree it results in is checked as one before any node runs, and it is refused by name if the stand-in offers less than its consumers need.

### The plugin lifecycle

Split by frequency:

| Moment | Frequency | What happens |
| --- | --- | --- |
| Load | Once per App | The platform's `create()` reads the closure, the union of every Project's `[plugins]` table. It resolves each specifier (from the data root's `plugins/` prefix, the plugins shipped with the version being booted, or the installation) and imports it, reads the `ifaces.json` beside its `package.json` (absent = no modules), and checks each class the default export names against its manifest there. An entry an earlier App imported from the same, unchanged file is reused instead of imported again. A package that names classes without a table (never built), or one whose class and table disagree (a stale build), is skipped with its reason, which the Project's plugin list reports; a Project whose `.project_config.toml` cannot be read or parsed contributes nothing |
| Check + create | Once per App | The platform adds the plugin modules to its tree; the whole tree is checked as data first (requirements resolved by signature, contributions validated against their slots), then created in dependency order — so a module is created fresh per boot, per hot swap and per re-assembly |
| Dispose | Once per App | A module's `effect()` registrations run in reverse creation order when the App is disposed; nothing of a plugin survives into the next generation |

### Re-assembly

A change to a Project's plugin list applies without restarting the process. The runtime holds the shell that `platformImpl.create` returns, and every member of its API forwards to the inner App of the moment. `reassemble()` runs the kernel's own `upgrade` over that inner instance with the same bundle and the same parked document: the swap a hot push performs, without a new bundle. Everything under [Swap semantics](#swap-semantics) applies, so agent runs in progress are stopped in every Project.

The plugin routes hand their edit to the re-assembly, which writes it in its own queue, so two edits of one file never interleave. When the new App fails to boot, the edit is undone first and the previous App is booted again from its document, so the list reads as it did before the change. Nothing in `packages/hmr` takes part, which is why re-assembly works on every runtime. The routes are listed in [Server API](/server-api#plugin-registry-and-project-plugins).

### The plugin contract

The plugin contract — `Plugin`, the decorators, and the sandbox vocabulary — is declared in the SDK at `@prismshadow/penguin-core/plugin`. `@prismshadow/penguin-server/plugin` exports the interfaces a plugin module may require (`Sandbox`, `Terminals`, `Sessions`, `AgentService`, `Messaging`, `Http`, …), types only.

The decorators are the SDK's only runtime a plugin carries. They record on the class itself, so the copy in a plugin's bundle and the host's read the same thing.

Which plugins run is decided by the Projects' `[plugins]` tables, which the Web App's **Plugins** page writes; the harness itself imports no plugin.

A component's interface is its class's public surface. A module's provisions and a consumer's narrow requirements are abstract classes (`extends Interface<…>()`) declared beside the code that owns them. `pnpm gen:ifaces` projects both into `src/ifaces.json` — generated, not committed; `typecheck`, `build` and `test` regenerate it. That is the table the tree is checked against.

## Subsystem inventory

Each subsystem's construction site and external surface. Step numbers ① to ⑫ refer to the [boot sequence](#boot-sequence) above.

| Subsystem | Constructed | External surface |
| --- | --- | --- |
| Config | `config.ts` `resolveServerConfig` (②) | `ServerConfig`; its only post-listen mutation writes back the real port |
| Single-instance lock | `lock.ts` (③ pre-check, ④ acquire in the listen callback) | Package subpath `@prismshadow/penguin-server/lock`; the CLI and Desktop use it for pre-launch probing |
| Database | `db/database.ts` `openDatabase` (first step of ⑥) | Repo classes under `db/repos/*`; WAL, foreign keys, ordered versioned migrations (`db/migrations.ts`, stamped in `PRAGMA user_version`) |
| Auth | `auth/service.ts` — **App-level** (built per App); the process-scoped values (`auth/runtime-state.ts`, the local API token among them) are published in ⑥ | `/api/auth/*`, the cookie and Bearer-token `authMiddleware`, and authentication of terminal WS upgrades |
| Project / Session | `services/*` — **App-level** (assembled in create) | `/api/projects/**`, `/api/sessions/**` (route details in [Server API](/server-api)) |
| Agent runtime | `runtime/session-manager.ts` — **App-level** | Task / approval / abort / compact routes and SSE `GET /api/sessions/:sessionId/stream`; delegates to core via `createAgent` |
| Events | `runtime/channel.ts` `ChannelHub` (⑥, process-level; SSE streams survive swaps) | User-level SSE `GET /api/events`; the `ServerEvent` type family |
| Scheduler | `runtime/scheduler.ts` — **App-level** (started/stopped by create) | The schedules routes; publishes results into the ChannelHub |
| HMR host / platform | `@prismshadow/penguin-hmr` (`HmrHost`, `hmrMain`) and `hmr/platform.ts` (the platform) | `PlatformApi` (`info` / `log` / `http` / `terminals` / `attachStream` / `business` / `shutdown` / `drained`, plus the kernel's `park`); `/api/hmr/*`, including `POST /api/hmr/upgrade`, is a route group the platform contributes — a pushed generation that does not serve it is refused before commit |
| Terminals | `terminal/` — **App-level** | `/api/terminals*` route group, WS `GET /api/terminals/:id/stream`; ptys are parked and survive swaps |
| Plugin host | built by each App's `create()` and registered at its commit for the next App to reuse; ⑤ `loadPlugins` publishes one in ⑥ for platforms that predate this | an npm package: its generated `ifaces.json` (the module payload), a default export `{ modules?: [<class>, …], replaces?: [<class>, …] }`; the configuration surface is the `[plugins]` table of each Project's `.project_config.toml`, written through `/api/projects/:projectId/plugins/installed` |
| Sandbox | `sandbox/service.ts` — **App-level** (a module; backends contribute to its `providers` slot) | a `SandboxModule.providers` contribution from a plugin module; enforcement reaches commands through core's spawn seam |
| Module tree | `src/platform.ts` — **App-level** (booted by create over the claimed capabilities) | `@Component()` on each service / repo class (a node is named by its class) with `@Use()` fields for its dependencies; `@Module({ children, exports })` groups (`IdentityModule`, `ProjectsModule`, …) whose exports are what their children offer the rest of the tree; `@Module({ … })` classes with `@Provide()` fields where one class builds several things; narrow consumer interfaces as abstract classes beside their consumer (`extends Interface<…>()`); no `modules/` directory — each node lives in the file of the thing it is; `src/ifaces.json` generated; `GET /api/contributions` lists what reached the web slots |
| Model catalog | No boot-time construction — static core data | `/api/projects/:projectId/models`; the catalog itself lives in `core/src/state/model-catalog.ts` |

### The HTTP seam at request time

The platform's HTTP seam offers every request to the current App's `http(request)` first. Behavior by case:

| Case | Behavior |
| --- | --- |
| The current App returns `null` | Falls through to the layer's own tail: static hosting and the SPA fallback |
| The current App throws | Answered `500` rather than falling through |
| No generation is current | Answered `503` |
| A hot swap is in flight | Requests wait at the seam for the new App instead of hitting a half-disposed one |

For the overall layering and the core engine boundary, see the [Architecture overview](/architecture). For the HTTP route details, see the [Server API](/server-api).
