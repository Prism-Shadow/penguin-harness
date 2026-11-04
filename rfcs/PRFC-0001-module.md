# PRFC-0001 Module

[中文版](PRFC-0001-module.zh.md)

> **Source**: `rfcs/PRFC-0001-module.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Rev**: v1.0.0 (migrated into the main repository); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `module`
- Start Date: 2026-09-02
- PRFC PR: [Prism-Shadow/penguin-harness-design#117](https://github.com/Prism-Shadow/penguin-harness-design/pull/117)
- Implementation PR: [Prism-Shadow/penguin-harness#543](https://github.com/Prism-Shadow/penguin-harness/pull/543) (kernel and generator), [Prism-Shadow/penguin-harness#599](https://github.com/Prism-Shadow/penguin-harness/pull/599) (the server-side conversion)

## Summary
[summary]: #summary

Module is the unit in which this harness assembles code — a mechanism, not a directory convention. It has only three primitives: **Interface** states what is needed, **Component** exports itself, **Module** exports others. The interfaces between nodes are expressed as **signature-level data**, and the whole tree is validated before any node's code runs. The server's business surface is its first application, and the catch-all `AppDeps` wrapper it used to carry is retired along with it.

## Motivation
[motivation]: #motivation

### An assembly mechanism has to satisfy three things

Anywhere that puts a pile of parts together has to answer three questions: how a part **states what it needs**; how to **swap one out** without touching the rest; and when the two halves of an assembly come from **two independent compilations**, how to tell before joining them whether they fit together.

The third is specific to this harness, and it is the hardest one. Platform code can be pushed online onto a running runtime, with the two sides compiled separately; a plugin package is the product of a third party's compilation; in the future, a workflow is code the Agent itself wrote. These boundaries have one thing in common: **once crossed, the only thing still comparable is data**.

### The server is the first place these three questions arise

Before this mechanism, every route and every service on the server took what it needed from an object called `AppDeps` — it eventually grew to some forty members, and anyone could reach into it. All three things were therefore out of reach.

A node **had nowhere to declare what it needs**. Which members of `AppDeps` `AuthService` uses is knowable only after reading its implementation to the end; conversely, whether something is still used by anyone can only be answered by a global search.

**Swapping one out was impossible**. A test that needs a fake clock has to thread it in through `AppDeps`; and once that can be threaded in, the production dependency graph has the same seam in it.

**The two halves of a hot push had no way to be checked against each other**. At the time, the kernel's interface comparison compared method names only: matching names with mismatched signatures still fit together, then blew up on the first call.

### An example

A sandbox backend has to keep working after a hot push. The platform side requires the backend to have `confine(argv, policy)`, while the backend side provides `confine(argv, policy, extra)` — same name, different signature. A name-only check waves it through, and the argument mismatch is discovered only when some command really is spawned — by which time the command is already running, not stopped before it ran. Crossing this boundary calls for "refuse on the spot when it does not fit, and say which parameter of which method".

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

Three primitives, one sentence each: **Interface** is a set of method and field signatures, written as an abstract class purely to serve as a handle — declare its own members with `@Interface()`, be an existing type with `extends Interface<T>()`; **Component** is the node that exports itself, its instance being its own provision; **Module** is the node that exports others, it has children, and re-exports a portion of the interfaces from its children, with the rest of the subtree's provisions private to the outside.

A node declares what it wants with `@Use()` fields, what it gives with `@Provide()` fields, hands over the code half of a contribution with `@Bind()`, and hands over the state to be retained with `park()`. Dependencies finish injecting before the optional `setup()`; the lifecycle hook is named `setup()` rather than `create()`, because the repo itself already has a domain method named `create`.

**A node is named by its class**, so there is no second place where names are minted; and therefore nodes are written in the very files they belong to, with no separate `modules/` directory: `AuthService` is in `auth/service.ts`, the session module is at the end of `runtime/session-manager.ts`, and the components of a group of routes are at the end of that group's route files.

At build time, `gen-ifaces` reads these decorators and field annotations statically — never executing the files it reads — projecting each component's public surface and each interface class into signature data, written into `ifaces.json`. At startup, the booter checks the whole tree against this table before letting the first node run. If the table is stale, startup halts with a named error.

To use a component outside the tree (scripts, tests), `wire(Cls, { …fields })` assembles one by hand: what used to be `new UsersRepo(db)` becomes `wire(UsersRepo, { db })`.

The server's business surface is organized this way: most services and all repos are components; the runtime adapter layer, the session runtime, messaging, sandbox, terminal, machines, HTTP, and Web are each a module. The same mechanism is also how plugins plug in (see below), and how the frontend tree will be judged in the future.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### The three primitives

The whole mechanism has only three things: **Interface** says "what is needed"; **Component** and **Module** are the two kinds of nodes on the tree.

#### Interface: a set of method signatures, and signatures are data

An interface is written as an abstract class. There are two forms, each for a different thing.

**The interface declares its own members** — with the `@Interface()` decorator, the members are exactly this class's members, and their doc comments sit on the members themselves:

```ts
@Interface()
export abstract class Db {
  /** Statements are host objects. */
  abstract prepare(sql: string): Opaque<"StatementSync", StatementSync>;
  abstract close(): void;
}
```

The return value of `prepare` is a **host object**, so it is written as `Opaque<…>`: this is not optional decoration, but the formal way of saying "structure is not checked here" — the generator rejects class types it does not recognize, and writing `Opaque` is what lets it through (see "The boundaries of projection" below).

The decorated class **must be exactly a declaration**: an abstract class that inherits nothing and implements nothing, every member abstract, public, and non-static. An inheritable base class, or a member with a function body, amounts to putting implementation into the contract, and which one the party actually wants is not something to guess — so the generator refuses rather than deciding for them.

**The interface is an existing type** — the decorator cannot express this case; use the base-class form:

```ts
export abstract class Config extends Interface<ServerConfig>() {}

export abstract class Sandbox extends Interface<
  Pick<SandboxService, "configure" | "currentSettings" | "backends" | "confiner">
>() {}
```

Why two forms at all: TypeScript has no way to carry a decorator's type parameters into the instance type, so an interface that "is itself a `ServerConfig`" or "is a view over a few methods of `SessionManager`" — once written with the decorator — has members invisible to every consumer. The two forms thus separate exactly two things: **interfaces that declare their own members**, and **framing over an existing type**.

`ServerConfig` is all fields without a single method, which is exactly why `IfaceDecl` needs `fields`; mapped types are projected by the shape they expand into, so the `Pick<…>` line introduces nothing new — it simply says "I need these four methods".

The two forms are the same call: the handle returned by `Interface()` can serve both as a base class and as a class decorator. It is an ordinary function rather than a class, because a class cannot be invoked as a decorator without `new`.

The projection itself does not vary by form — the generator reads the class's instance type, and the instance type of the decorated class is exactly its abstract members; only the means of recognition changes, plus the guard above. **The class name is preserved under both forms**, and this matters: the class name is part of the contract, and a parked module document is keyed by precisely it.

An interface's key in the table is `<declaring package>#<export name>`. It is a class only to serve as a **handle** — manifests can name it by reference instead of writing strings. Nothing can be constructed from it, and nothing anywhere checks it with `instanceof`: the judgment is structural.

The generator projects it into an `IfaceDecl`: a `name` (used only for messages and lookup — the identity is the member set itself), a `methods: Record<string, Sig>`, and optional `fields`. `fields` exists because TS interfaces have non-method members, and a published configuration object often has nothing but fields — Go has no such item; fields are compared by **presence and type**, never by value.

A signature is `Sig { params: TypeExpr[]; returns: TypeExpr }`: positional parameters plus a return type.

`TypeExpr` is the heart of this design: it compresses "a type" into a set of serializable cases:

| Case | What it is |
| --- | --- |
| `{ data }` | An arktype definition — primitives, literals, unions, arrays, tuples, plain objects |
| `{ iface }` | A **live object** satisfying another interface; the value is the key in the interface table |
| `{ fn }` | A callback, containing a `Sig` |
| `{ promise }` | The unwrapped type of a Promise |
| `{ stream, returns? }` | `AsyncIterable<T>`; an async generator's return value goes in `returns` |
| `{ void: true }` | No return |
| `{ array }` | An array whose elements are **not data** (a series of callbacks, a series of handles) |
| `{ map }` | `Map<K, V>`: a live key-value collection; the value is the two `TypeExpr`s `[K, V]`, compared by key type and value type respectively |
| `{ set }` | `Set<T>`: a live collection, compared by element type |
| `{ object, optional? }` | An object with at least one non-data member, compared member by member |
| `{ maybe }` | A non-data `T` wrapped in `null` / `undefined` |
| `{ oneOf }` | A union with at least one non-data member |
| `{ opaque }` | A host object compared only by **name** |

The split into "data" and "non-data" is necessary: data types can be expressed by arktype and compared by assignability, whereas a callback, a live handle, or a stream has no value-level pattern to speak of — each can only become its own case and be compared recursively.

#### Component: the node that exports itself

```ts
@Component()
export class AuthService implements Auth {
  @Use() private readonly users!: Users;
  @Use() private readonly authSessions!: AuthSessions;
  @Use() private readonly state!: AuthState;
  // …
}
```

`implements Auth` is not just for TypeScript to see: the generator reads this clause and records `Auth` into this node's `provides`, so wiring goes by **declaration** first and by structure only second.

A component **is named by its class**, and the instance itself is its provision: consumers name it by its own class (`@Use() auth!: AuthService`), and its interface is exactly the public surface the generator projects. So there is no `AuthModule` to construct it, no `modules/auth/module.ts`, and no `Pick<AuthService, …>` interface class — **it is that node**. The name is the class's **declared name**, not the runtime `Function.name`: the generator reads it into the table from the source, and the decorator context hands the same word to the kernel as a string literal — the two come from one source, and whether the artifact is minified or not cannot change it. The name carries identity only — parked documents are keyed by it, wiring and slots address by it — and the satisfiability judgment never looks at it; renaming the class amounts to changing the identity, and parked documents must migrate accordingly.

The four annotations each have their own job:

- **`@Use(From?)`** — the field's type is the required interface, and the decorator's argument is the module wired in to provide it. **When the argument is omitted**, it is provided by the module that structurally satisfies it within the visible scope, and this holds only when exactly one does. The field finishes injecting before `setup()`.
- **`@Provide()`** — assigned inside `setup()` and read afterwards; leaving it unassigned is a startup error, naming the field.
- **`@Bind("<id>")`** — the code half of a contribution, likewise assigned inside `setup()`.
- `park()` — hands over the state to be retained.

`setup(ctx, context)` is the only lifecycle hook, and it is optional. It is not named `create`, because the repo itself already has a domain method named `create`.

Whether a thing should be a component or a module comes down to one rule: **if a class's inputs cannot be provided by any interface** — a computed closure, an assembled path — then it has to be built by a Module. That is exactly what "exports others" means.

To use a component outside the tree, `wire(Cls, { …fields })` assembles the fields the way the booter injects them; **nothing is checked, and `setup()` is not called either**. What used to be `new UsersRepo(db)` is `wire(UsersRepo, { db })`.

#### Module: the node that exports others

A module has two extra things: `children` are the node classes beneath it, and `exports` are the interfaces it re-exports from its children — **the rest of the subtree's provisions are private to the outside**. This is how "the whole group is swappable" and "nodes within the group are not exposed to each other" are implemented.

A module used purely for grouping has an empty class body:

```ts
@Module({
  children: [UsersRepo, AuthSessionsRepo, ScryptHasher, AuthService, AdminService, AdminRoutes, MeRoutes],
  exports: [Users, AuthSessions, Auth, Admin, PasswordHasher],
})
export class IdentityModule {}
```

It does nothing itself: of the seven child nodes, the five interfaces named by `exports` are visible from the outside, and the rest (the two groups of routes) stay within the group.

And a module that also has something of its own to provide uses `@Provide` plus `setup`:

```ts
@Module({ context: { version: 1, schema: { "settings?": { mode: "…" } } } })
export class SandboxModule {
  @Provide() sandbox!: Sandbox;
  setup({ contributions }: ClassCtx, context: Json) {
    // Assemble a SandboxService from the providers contributed into its own slot, and assign it to this.sandbox
  }
}
```

`setup`'s two parameters are all it receives: `ClassCtx` (`contributions`, `resources`, `effect`; the requires are already injected as fields) and its own share of the parked document.

#### The manifest: the static half is a JSON document

The annotations above are **read statically** by the generator (never executing the files it reads) and written out as a manifest:

```jsonc
{
  "name": "agents",
  "requires": { "projects": { "iface": "ProjectsNeeded", "from": "projects" } },
  "provides": { "agents": "Agents" },
  "contributes": { "http.routes": [{ "id": "agents.routes", "prefix": "/api/…", "auth": "user" }] },
  "context":  { "version": 1, "schema": "{ collapsed?: string[] }" },
  "children": ["vault", { "keyed": "workbenches" }],
  "exports":  ["agents"],
  "kind": "module"
}
```

Each item of `requires` has two halves: `iface` is **the required shape** — it can be an interface the consumer declares in place (the Go habit: interfaces belong to the consumer), or `<package>#<export name>`; `from` only says **who** provides it, and the judgment itself remains structural. The keys of `contributes` are `<module>.<slot>`, each item carrying a unique `id`, pure data. `{ keyed: … }` in `children` denotes a set of child nodes whose shape is static and whose cardinality is dynamic.

### Slots and contributions

A slot is written `Slot<Data, Code>` and projected into `SlotDecl { data, code? }`: `data` is the data shape a contribution carries in the manifest (`id` excluded — the framework adds it), and `code` is the shape of the implementation to be bound when one is needed.

The consumer receives `Contributed { id, from, data, code? }` by slot name — `from` is the contributing module's name. Routes are the first slot; sandbox backends and messaging connectors take the same shape.

### Visibility is lexical

A module can see **its siblings, its ancestors, and its ancestors' siblings**. An ancestor itself is **not** one of its providers — the ancestor's exports face outward. The capabilities the host publishes are visible everywhere, as virtual root-level siblings.

### Ordering is not the shape of the tree

A module is created after two things: everything it `requires`, and **every module that contributes to its slots carrying a code half** — because a contribution's code half is the contributor's `bind[id]`, which exists only once the contributor has been created. A data-only contribution is data in the manifest, present before any node is created, and determines no ordering; so a module can contribute to a pure-data slot while also `requires`-ing that slot's owner (a plugin declaring its own settings group and then reading the value back is exactly this).

Siblings are created in whatever order the edges permit. A cycle is a startup error, naming every module on the cycle.

### Validation: the whole tree, seven kinds of problems

`checkTree` runs to completion **before any node is created**, and every problem carries its path in the tree:

`unresolved` (a requires finds no provider in the visible scope), `mismatch` (a provider is found but some method signature does not match, naming the method), `unknown-iface` (references an interface not present in the table), `no-such-slot` (contributed to a nonexistent slot), `bad-contribution` (the contribution's data does not fit the slot's shape), `duplicate-id` (a contribution id collides), `duplicate-module` (a module name collides).

### The judgment rules

Go's assignability rules, enforced across compilation boundaries: every method the consumer names exists, and its signature is assignable — parameters contravariant, returns covariant. Data types are compared by **TypeScript's assignability**, not by arktype's intersection-identity `extends`, which would judge `{ a }` ⊆ `{ a, meta? }` as not holding.

### The boundaries of projection

Host objects (`AbortSignal`, `Request`, and anything declared in a `.d.ts`) and this package's own classes written as `Opaque<"Name">` are compared by name only, and the generator qualifies the name with **the declaring package** — so two packages' respective `Resources` are never equal. The generator rejects class types it does not recognize rather than guessing: writing `Opaque<…>` is exactly how a declaration says "structure is not checked here". `Map` / `Set` (and their `Readonly` forms) are not in that category: they have no arktype form, but their element types are comparable, so they project as `{ map }` / `{ set }` and compare structurally — a node's in-memory state (PRFC-0015's `AgentState`) can therefore enter the interface table without being written as `Opaque`. `WeakMap` / `WeakSet` are still rejected: their keys are object identity, which cannot be compared across generations. Generic methods erase to `unknown` with a warning. Named data types are emitted only once, into the `types` table, and referenced everywhere else via `$ref`; recursive types are simply references pointing back at themselves.

### park and migration

What each module's `park()` returns is stored into a table keyed by module name; on the next startup, `bootModules` takes the table back, runs that module's own `migrations` (chained from the starting version, 1→2→3), and then hands its share of the document back to it. This table is the platform node's `modules` field.

### That table is a generated artifact

`ifaces.json` is not checked into version control: `typecheck`, the server-side `build` and `test`, and `deploy.mjs` each regenerate it. It is a build artifact rather than source, because it must stay in sync with the code — and anything that depends on people to synchronize will sooner or later fall out of sync.

### Extensions are modules, not a second mechanism

An extension package provides a set of Modules: `package.json#penguin.modules` carries the manifest, the default export is `{ modules: { <name>: { create } } }`, the modules are paired by name and started as children of the platform root. The four sandbox backends have already been rewritten this way, and the old `activate(ctx)` contract is retired.

### Relation to hot updates

Introducing this mechanism does not by itself change the runtime. The tree starts inside the existing platform kernel node, and at park time each module's document is written into the newly added `modules` field. Parked documents are not reversioned — fields are only added — so a data root parked by this version of the platform can still accept an older platform pushed back onto it. The only place the runtime is touched is the extension loader, which reads one more thing: `package.json#penguin`.

## Drawbacks
[drawbacks]: #drawbacks

**One more generated artifact**, and four separate paths each responsible for regenerating it. Forget to regenerate, and startup fails with a named error instead of silently going wrong — but it is still a failed startup.

**Decorators and static reading** mean this metadata holds only for TypeScript; the generator has to follow TS's type system, and it can only reject constructs it does not recognize.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**Comparing method names only** is the former approach, and the cheapest one. It does not catch signature mismatches — and signature mismatch is precisely the kind of error hot pushing most readily produces: the two sides evolve independently, and method names are often the last thing to change.

**Hand-written manifests** (each module maintaining its own JSON description) need no generator, but they require a person to keep manifest and code in sync, and that kind of sync breaks at the first schedule crunch. The generator projects from the code, so the two cannot disagree.

**Runtime reflection**: read the actual objects at startup and see whether the methods are there. It cannot cross the push boundary — the pushing side does not have the other side's objects in its own process, and the check must happen before the parts are joined.

**Do nothing**: `AppDeps` keeps growing, and hot pushes keep blowing up at runtime instead of being rejected at startup.

## Prior art
[prior-art]: #prior-art

**Go's structural interfaces** are the prototype of the judgment rules, and this design lifts them directly: satisfaction looks only at the method set — no names, no versions, no belonging. The difference is that Go judges within one compilation while we must cross two independent compilations, so signatures must first become serializable data.

**VS Code's contribution points** are the prototype of contribution slots: extensions declare what they contribute as data in their manifest, the host assembles from that, and it knows what they provide without executing extension code. Our route slot, sandbox slot, and messaging slot take the same shape.

**NestJS's and Angular's dependency injection** likewise use classes as injection tokens and decorators to declare dependencies — very close in shape. The difference is that they resolve only within one compilation, with no cross-boundary structural validation — which is exactly the extra layer here.

**OSGi's service registry** has done cross-boundary service contracts, but it goes by the type identity of Java interfaces, supported by one ClassLoader per bundle; see PRFC-0005's Prior art for the cost. Signature-level data comparison needs no such isolation.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

**The sender-side preflight is not done yet.** Today's validation happens at startup and in CI; the ideal place is before the push — check once against the table the target runtime has published, and do not push at all when it would not fit. This requires the runtime to publish `describe(tree)`.

## Future possibilities
[future-possibilities]: #future-possibilities

Agent Workbench (formerly Workflow) describes its backend and UI in one declaration, following the same module mechanism; application distribution and the host contract are covered in [PRFC-0020](PRFC-0020-agent-workbench.md).

The frontend has a tree of its own too: `web/src/module.json` is already the App's manifest — each page's route, navigation position, whether it is admin-only, and its renderer name are all in there, and the routes and the sidebar are exported from it; `GET /api/contributions` returns, as data, what the server contributes to the frontend slots, and the frontend renders only the renderers it recognizes. The possibility of both trees using the same set of judgment rules is left for another piece.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.
