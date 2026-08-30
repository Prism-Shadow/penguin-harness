# The server is a module tree, checked by signature before it boots

- **Date:** 2026-08-29
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `tooling`
- **PR:** [#543](https://github.com/Prism-Shadow/penguin-harness/pull/543)
- **Breaking:** the `@prismshadow/penguin-server` package no longer exports `AppDeps`, `buildAppDeps` or `createApp`; the `activate(ctx)` plugin contract is replaced by `Plugin { modules }`

[中文版](2026-08-29-module-tree.zh.md)

The business surface of the server — every service, every repo, every route group, the session runtime, the terminal manager — is now a tree (`packages/server/src/platform.ts`) of the classes themselves — there is no `modules/` directory; each node is declared in the file of the thing it is. Most nodes are **components**: a service or repo class that exports itself. `@Component()` on the class — a node is named by its class, `AuthService` is the node `AuthService`, so nothing is named twice — one `@Use()` field per dependency, typed by the class or interface it needs — `@Use() private readonly users!: UsersRepo` — and injected before the optional `setup()`; the class's public surface is its interface. A **module** is the other kind of node: a class that exports *other* things, `@Module({ contributes?, context?, children? })` with `@Provide() sessions!: Sessions` fields assigned in `setup()`. Both may carry `@Bind("HostAssembly.routes") routes!: Hono` for a contribution's code half and `park()` for state. `AuthService` and the module that only existed to construct it are the same class now; the `modules/<name>/` wrapper directories for repos and plain services are gone, and so are their `Pick<Impl, …>` interface classes — a consumer names the component class itself, or declares the narrow interface it needs where it consumes it (`abstract class ScheduleTaskRunner extends Interface<…>() {}`, declared beside the scheduler). `pnpm gen:ifaces` reads the decorators and field annotations statically — never executing the file — into the same table as the interfaces, projecting a component's public members as its contract; the booter checks each class against that table (a field it does not know is a stale-table error), so the tree is checked before any class code runs, then created in dependency order. A component wanted outside a tree — a script, a test — is built with `wire(Cls, { …fields })`.

## Interfaces at signature level

A component's interface is its class, projected; anything else is an abstract class `extends Interface<…>()`, wherever it is declared. `pnpm gen:ifaces` projects every such interface into `packages/server/src/ifaces.json` — parameters and return types included, not just method names; named data types are emitted once and referenced, so a recursive type is a reference to itself. The table is generated, not committed: `typecheck`, `build`, `test` and the deploy script regenerate it. A requirement is satisfied by Go's rule: every method the consumer names exists on the provider with an assignable signature (parameters contravariant, returns covariant). A module may declare the narrow interface it needs where it consumes it; the scheduler's `ScheduleTaskRunner` is one, satisfied by the session runtime's wider `SessionManager`.

Host objects (`AbortSignal`, `Request`, a class of this package written as `Opaque<"Name">`) compare by name only, and the generator says so rather than guessing.

## Contributions are manifest data

A route group is a line in a manifest — `"HttpModule.routes": [{ id: "agents.memory", prefix: "/api/…", auth: "user", order: 190 }]` — and the module binds the handler by that id. The `http` module assembles the whole surface from those lines; adding an endpoint no longer touches a central route table. Sandbox backends and messaging connectors enter through the same kind of slot.

## Plugins are modules

A plugin package is a set of modules: `package.json#penguin.modules` carries the manifests, the default export is `{ modules: { <name>: { create } } }`, paired by name, and the modules boot as children of the platform's tree at every App creation. The `activate(ctx)` contract — `initialize` / `create` events, `PenguinInterface`, `PenguinContext` — is gone; what it registered (a sandbox backend, a workflow factory) is now a contribution or a provided interface, and what it reached (`terminals`, `sandbox`) is a requirement checked at signature level. The four sandbox backends are converted.

## Mechanisms, not implementations: the runtime split and the end of `Overrides`

The single `RuntimeModule` that exported ten unrelated things is gone: each claimed capability is a node of its own (`RuntimeConfig`, `RuntimeDb`, `RuntimeChannels`, `RuntimeProxy`, `RuntimeHmr`, `RuntimeDesktop`, `RuntimeAuthState`, `RuntimeResourceGroups`), and what most nodes actually wanted from the config is its own mechanism, `Paths` (`root`). Time is a mechanism (`Clock`, `SystemClock`), so is the log (`Log`, `ConsoleLog`), password hashing (`PasswordHasher`, `ScryptHasher`), the messaging pacing knobs (`MessagingTuning`), each connector's network transport (`FeishuSdkHandle`, `TelegramTransportHandle`, `QQTransportHandle`, `QQScanTransportHandle`), the session loader and title generator (`SessionLoaders`, `TitleGenerators`) and the update check's network (`HttpFetch`). A component says what it implements — `class SystemClock implements Clock` — and the generator records it; a provider that declares the interface wins the wiring over one that merely has the shape.

`BuildDepsOverrides` — the bag of test doubles that thirteen production nodes read at boot — is deleted. A test stands in for a node instead: `bootAppDeps(config, [[SystemClock, { now }]])`, a list of **replacements** the platform boots in place of the classes they name, checked against the same table as the classes themselves. `createTestApp` keeps its option names and turns them into replacements.

## The table as a page

`pnpm ifaces:page` renders `ifaces.json` into one self-contained HTML page (`dist-ifaces/index.html`): the module tree, every node's requires / provides / contributes, every interface at signature level, with the table's sha256 in the title and the JSON beside it. CI renders it for every commit, publishes it under the commit's sha on the `ifaces-pages` branch, and links it from the job summary and a pull-request comment — the page's `ifaces.json` is the table that commit builds, hash for hash.

## Compatibility

The platform node's parked document keeps its version: the module tree's documents are an added `modules` field, and the pty handle ids and sandbox settings are still written where the first platforms parked them — so a data root a newer platform has parked on still boots any older platform pushed to it, terminals and confinement intact.

`AppDeps`, `buildAppDeps` and `createApp` are gone from `@prismshadow/penguin-server`, and so is the `activate(ctx)` plugin form: an installed plugin written against it fails to load with "not a plugin package" until it is rewritten as modules. A test that needs a service reaches it through `flattenForTests(boot)` in the server's test helpers, or through `boot.tree.api(module, alias)` — a component's alias is its class name (`tree.api("AuthService", "AuthService")`); a slot is `<Class>.<slot>` (`HttpModule.routes`, `SandboxModule.providers`). Service and repo classes no longer take their dependencies in the constructor: `new UsersRepo(db)` becomes `wire(UsersRepo, { db })` from `@prismshadow/penguin-core/kernel`.
