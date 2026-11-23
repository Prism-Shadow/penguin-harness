# PRFC-0024 CLI Modules

[中文版](PRFC-0024-cli-modules.zh.md)

- Feature Name: `cli-modules`
- Start Date: 2026-11-02
- PRFC PR: none yet (native to this repository)
- Implementation PR: — (the design travels with the proposal's implementation branch `feat/cli-command-contributions` until the RFC pull request opens)

## Summary
[summary]: #summary

The `penguin` command line becomes a set of command contributions under the module mechanism ([PRFC-0001](./PRFC-0001-module.md#the-three-primitives)). A command is one contribution of a `@Component` class: its static half sits in the manifest — a **command key**, the argv path the command answers, plus a one-line summary in each language — and its code half is the class's `@Bind` field, the same class shape a sandbox backend is written with (a [slot](./PRFC-0001-module.md#slots-and-contributions) is written `Slot<Data, Code>` — the data carried in the manifest and the bound implementation are exactly the two halves of one contribution). Two hosts collect such contributions, each in its own process. The CLI's own commands are contributions to the CLI's `CliCommandsModule.commands` slot, booted statically and fixed by the build. A plugin's commands are contributions to the server's `PluginCliCommandsProvider.commands` slot: the server is the one that knows them and the one that runs them, through two routes the CLI reads the way the web app reads its contributions. Ownership follows the process — a command belongs to the process that can run it, and the CLI never loads plugin code to dispatch one.

A plugin the CLI ships with — one of the CLI package's own dependencies — can also carry commands that run in the CLI's process: its `./cli` export is a **CLI module** the CLI's build lists and compiles in, so the CLI still never loads plugin code at runtime ([v1.2.0](#v120)).

## Motivation
[motivation]: #motivation

### The CLI is one hand-written registration

The CLI's program is assembled by one file that imports every command's `register` and calls each in order. A command is a function call in the host, not a node on a tree: its help text lives beside the registration, nothing states what it needs before its code runs, and adding one command means editing the host. The rest of the harness left this shape behind when the server's business surface became a module tree; the CLI is the last surface still assembled by hand.

### A plugin's commands previously had no owner

Commands a plugin offers the terminal have to be discovered and executed somewhere, and the earlier draft of this design put both halves in the CLI: the CLI would read each plugin package's generated table, match the command line itself, and execute the plugin's code in its own process. That made the CLI a second plugin host — it had to understand plugin resolution, import plugin modules, and answer for what plugin code did — only so the command could run without a server. The web app reads its contributions as data, through `GET /api/contributions`, and runs none of them in the browser; the terminal deserves the same answer.

The fact that settles it: the CLI that a push carries is the same code that starts the server. Builtin commands are identical from both processes' points of view, because both see one build. What differs between the processes is dynamic state — and a plugin's commands are exactly that: they live in the server's module tree, the way routes and skills and settings groups do. So the split is by ownership: builtins belong to the CLI process, plugin commands belong to the server process, and the CLI is a client of the server for them.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### The two halves of a command

A command contributes the way everything else contributes ([PRFC-0001](./PRFC-0001-module.md#slots-and-contributions)): a **static half** in the manifest, read without executing any code, and a **code half** bound on the contributing class.

- The static half is a **command key** — `a.b.c`, the argv segments the command answers (`penguin a b c ARGS`) — and a **summary**, one line per language, which is what help prints.
- The code half is a `register(node, ctx)` function: the host has already located the command node the key names and written the summary as its description; the register adds the options, arguments and action. A register never builds its own path.

```ts
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      { id: "cli.auth", key: "auth", summary: { en: "Sign in…", zh: "登录…" } },
    ],
  },
})
export class AuthCommand {
  @Bind("cli.auth") command!: CliCommandCode;
  setup() {
    this.command = { register: (command, ctx) => registerAuthCommand(node(command), ctx.messages) };
  }
}
```

### The CLI's own commands: a table fixed by the build

Each of the CLI's own twenty commands is one `@Component` class like the one above, contributing to the `CliCommandsModule.commands` slot; the CLI entry boots that module statically once per invocation. The CLI bundle is the code that starts the server, so this table is the same in the CLI process and in the server's, and the serve group — `server`, `web`, `server status`, `server stop`, `server reset-admin-password` — stays a set of CLI commands in the CLI package. Nothing about the surface moves; `penguin --help` prints what it always printed.

### A plugin's commands: contributions to the server's tree

A plugin contributes a command with the same class shape, to the server's `PluginCliCommandsProvider.commands` slot. The commands live in the server's module tree with the rest of the plugin, so the server is the one that knows them. Two routes serve the slot:

- `GET /api/cli/commands` lists every command with its package, its key and its summary — open to any signed-in user, the way the web reads its slots.
- `POST /api/cli/commands/run` runs one argv against one plugin's commands on the server — an admin-only operation. The answer carries what the run printed on stdout and stderr, and its exit code.

A command that cannot run drops out at boot with a warning: a module no loaded plugin package stands behind, a key that is not a command path, and a key one package contributes twice. Nothing half-registered is ever listed.

### How the CLI dispatches

When the first word of the command line names one of the CLI's own commands, the CLI runs it as always. Otherwise:

- **One package answers.** The CLI asks a server that is already running for the command list (it does not start one). A command *answers* a command line when its key's segments agree with the line's leading words (the exact judgment is in Reference); the CLI finds exactly one package whose commands answer the words, runs it through the server, and prints what came back as if it were its own.
- **Two or more packages answer.** That is ambiguity. The CLI prints one copyable `penguin exec <package>:<id>` line per package, exits 2, and runs nothing — the caller says which it meant.
- **None answers.** The command line goes back to the CLI's own parse, which reports the unknown command as it always has.

`penguin exec <id> [args…]` names a plugin command directly by its dotted id — `sandbox.wsl.restart`, two segments or more — and every option after the id, `--help` included, belongs to that command. When two plugins contribute the same id, the full npm package names it: `penguin exec <package>:<id>`, scope included. `penguin exec ls [package]` lists the ids the plugins contribute, summaries beside them. Like every command that needs a server, it starts one when none is running.

### A shipped plugin's commands: a CLI module the build fixes

Some commands act on the terminal that runs them: `penguin browser` reads an exec script from stdin, saves screenshots and values at whatever path it was given, and prints as it goes. A server run cannot do that: it has no stdin, it can hand files back only into the one directory a command's output option names, and its output arrives buffered in the reply. So a plugin the CLI ships with can carry commands that run in the CLI's own process, the way the CLI's own do.

Its package exports a `./cli` subpath, a **CLI module**: the command classes, the table its build generated over its CLI sources (not the server table its `.` entry ships), and the message groups the commands read. The classes are written like any other command, contributing to the CLI's `ShippedCommandsModule.commands`:

```ts
// plugins/<name>/src/cli/index.ts — the package's "./cli" export
@Component({
  contributes: {
    "ShippedCommandsModule.commands": [
      { id: "demo.cli", key: "demo", summary: { en: "Say hello", zh: "打招呼" } },
    ],
  },
})
export class DemoCommand {
  @Bind("demo.cli") command!: CliCommandCode<DemoMessages>;
  setup() {
    this.command = { register: (command, ctx) => registerDemo(node(command), ctx.messages) };
  }
}

export default {
  modules: [DemoCommand],
  ifaces: table, // this package's own gen-ifaces output over src/cli
  messages: { en: demoEn, zh: demoZh },
} satisfies CliModule;
```

The CLI's build lists every plugin among the CLI package's dependencies — the `@penguinharness/*` packages, as the plugin library host reads them — that exports `./cli`, and compiles those modules into the CLI; at startup the CLI boots each one and adds its commands after its own. They appear in `penguin --help`, parse their own arguments, and read and write the caller's terminal. A plugin installed on a server later never reaches this list: its commands are the server's, as above.

A CLI module's code uses the host through one library package, `@prismshadow/penguin-library-cli` — the connection resolution, the server client and its error, terminal input, the text helpers, and the host message groups their words come from. It never imports the server package or the CLI package: both depend on the plugins they ship, so an import back would close a cycle.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### The contract in the core plugin package

The command contract lives in `@prismshadow/penguin-core/cli`, beside the plugin contract in the core SDK, so a contributor depends on no CLI package:

- `CliCommandSummary` — `{ en, zh }`, the one-line summaries.
- `CliCommandData` — `{ key, summary }`, the slot's data type.
- `CliCommandEntry` — the static half plus the manifest's `id`, as a collected contribution carries it.
- `CliCommandProgram` — the command node the host located by the key, with the summary already set as its description. It is `Opaque<"Command">`: the contributor types it with the commander its own package depends on, so the contract pins no commander version.
- `CliCommandMessages` — what every host's bundle guarantees: `language`, the locale the host resolved the invocation into. A command never resolves a locale; the rest of the bundle is the host's own vocabulary, and the CLI's is its full `Messages`.
- `CliCommandContext<M>` — what the code half may use from the host: the host's message bundle, resolved once per invocation. Output is not in the contract: a command writes to the process's own stdout and stderr and sets `process.exitCode`, and what those mean is the host's to decide — the CLI's own invocation for a builtin command, the response's strings for a server run.
- `CliCommandCode<M>` — `{ register(command, ctx) }`, the code half's shape; a contributor types `M` with the host whose slot it contributes to.
- `cliCommandKeyFault(key)` — the shared key grammar: lowercase `[a-z][a-z0-9-]*` segments joined by dots, `null` when the key passes. Dispatch, attribution and the key's translation into command nodes all read this one judgment.

### The CLI host

The CLI boots `CliCommandsModule` once per invocation, reads the contributions off the slot, turns each key into its command node on the program, writes the summary as the node's description, and calls the bound register with that node. The CLI resolves the invocation's locale once (`PENGUIN_LANG`, English by default) and hands its message bundle to every register through the context — no command resolves a locale itself. The host owns help, version, `exec`, `update`, `auth`, `plugin` and the serve group like any other node owns its own surface — there is no second place where command names are minted.

The table is a generated artifact in the same sense as every other manifest: `gen:ifaces` projects both slots — `CliCommandsModule.commands` in the CLI package and `PluginCliCommandsProvider.commands` in the server package — into `ifaces.json`, and the same regeneration paths (`typecheck`, build, test, `deploy.mjs`, `release-npm.sh`) keep it in step with the code.

### The server's slot and the two routes

`PluginCliCommandsProvider` owns the slot, contributes the routes to `HttpModule.routes` under `/api/cli/commands`, and reads the contributions off its slot at boot. Three things drop a contribution, each with a warning naming the module and the id: the contributing module has no loaded plugin package behind it; the key fails `cliCommandKeyFault`; one package contributes the same key twice — both entries go, so that package's commands stay unambiguous. Attribution to packages is claimed per call, so a plugin table change is visible without a re-boot of the tree.

The run side builds a fresh commander program per request — every command of the named package, each on the node its key locates and described by its summary — then parses the argv against that program alone. Every register receives the host's message bundle; the server holds no shared command vocabulary yet, so its bundle carries the locale the caller resolved. With no arguments it prints the package's help; commander's own help and usage errors answer with commander's exit codes, passed through; a command's own failure is caught in the controlled call chain, written to the response's stderr with exit code 1, and never escapes into the server. For the duration of a run the server redirects this process's stdout and stderr into the response's strings — a command writes to the process; what the process's streams mean is the host's to decide — and restores them after, and runs are serialized so two concurrent runs never capture each other's output. The run answers with strings, not with a live process. This is request-level containment, not process isolation: a plugin runs in the same process as the platform, and installing one means trusting its code ([PRFC-0003](./PRFC-0003-plugin.md#principles)). What the boundary guarantees is that ordinary failures — thrown errors, rejected promises, usage errors, help — come back as a response instead of a broken request.

Authorization is two-layered: the routes carry `auth: "user"`, so listing is open to any signed-in user; the run handler refuses anyone but an admin with `403 admin_required`, and a refused request never reaches a command's register. An unknown package answers `404 unknown_package`; a malformed body answers with the request validation's own names.

### Dispatch, by example

The CLI's implicit dispatch is a pure function of the argv and the listing. The **command words** are the argv's leading words up to its first option. A key **answers** an argv when its segments and the command words agree for as far as both go:

- `tool sub` answers `tool sub x`, and also `tool` and `tool --help`, where the words stop first.
- `tool sub` does not answer `tool other`.
- A package with several commands is one candidate: the match is per package, deduplicated.
- `tool` (package A) and `tool sub` (package B) both answer `tool sub x` — two packages, so ambiguous. Words that one package prefixes and another extends are not a tiebreaker; `penguin exec` exists to break ties by name.

The ambiguity report prints one line per package — `penguin exec <package>:<id>`, the id being the longest key of that package's commands that answers the argv — followed by the part of the argv the key does not name, with each word quoted the way a POSIX shell reads it back. A pasted line therefore runs the plugin command with the same arguments, options included, no `--` needed. The report goes to stderr with exit code 2, and nothing runs.

`penguin exec` resolves the id against the listing: an id is a dotted key of at least two segments, and it matches exactly — no prefix or suffix matching. A bare id works while exactly one contributing package carries it; a collision names the packages, an unknown id lists the ids, and both exit 1 without running anything. The prefixed form `<package>:<id>` takes the full npm name — the scope is not optional — and reads as that package's id. `penguin exec ls` lists every command with its package and summary; with a package it lists that package's commands. The request carries `prog` — `penguin` for implicit dispatch, `penguin exec <name>` for the explicit form — so usage lines print as the caller invoked them, and `language`, so the summaries and the command's own text come back in the caller's language.

One degradation is stated openly: when the listing cannot be fetched — no server running, or the query fails — the CLI cannot know whether a plugin would have answered, and it falls back to its own parse, which reports the unknown command. Implicit dispatch treats "cannot ask" the same as "no answer"; `penguin exec` exists precisely so a caller who needs the command does not depend on that fallback.

### Shipped plugins' CLI modules

- **The contract.** `CliModule` in `@prismshadow/penguin-core/cli`: `{ modules, ifaces, messages? }` — the command classes, the package's own generated table for them, and optional message groups `{ en, zh }`. The classes contribute to `ShippedCommandsModule.commands`, whose data half is `CliCommandData` and whose code half is `CliCommandCode`, as in the CLI's own slot. A shipped command contributes to this slot rather than to `CliCommandsModule.commands`, so the CLI's generated table of its own commands never lists one.
- **The list.** The CLI package's `gen:ifaces` also writes `cli-modules.gen.ts`: every `@penguinharness/*` entry of the package's `dependencies` whose `package.json` `exports` names `./cli`, in package-name order, each entry importing its module when the CLI asks for it, so a module that throws while it evaluates fails alone. A plugin that adds `exports` keeps `./package.json` among them, since the library host resolves it. A dependency that is not installed is an error, not a module left out. The CLI's tsup build bundles the `./cli` modules it lists, and the push's compile inlines everything, so the artifact carries the code it runs.
- **The boot.** Once per invocation and per module, a tree rooted at the CLI's `ShippedCommandsModule`, the module's classes its extra children, each paired with its manifest from the module's own table. The tree is checked against the CLI's table with the module's folded in, the CLI's entry standing on a key both carry — the fold the server applies to a plugin's table. A module that does not boot (a class missing from its table, a failed check) contributes nothing, and the CLI writes one warning naming its package to stderr; the rest of the CLI runs.
- **The commands.** Registered after the CLI's own and the server package's, in list order, each on the node its key locates. Each is checked against the program as it stands when its turn comes. A command whose key fails `cliCommandKeyFault`, repeats a key its module already contributed, or names at any level a command or alias already on the program (the CLI's own, or one an earlier module added; `help` included) is dropped with a warning: a shipped module adds commands, and never extends or replaces one the CLI has.
- **The messages.** The register receives the host's bundle with the module's groups for the invocation's locale added; a group the host's bundle already has stays the host's, with a warning. The CLI resolves the locale; the module never does.
- **What is caught at run time, and what only at build time.** At run time each of these costs only the module or the command it concerns, with one warning naming the package on stderr, and the rest of the CLI runs: a module whose evaluation throws, a module whose classes do not boot, a command dropped by the checks above, and a register that throws — its node, and any group its key created and left empty, comes off the program again. A shipped command that fails later, while it runs, fails the way any command does: one error line and exit code 1, for that invocation only. Only the build catches the rest: a listed plugin that is not installed (the generator refuses it), a module that does not compile or bundle, and a default export that is not a `CliModule` (the typecheck of the generated list).
- **The face.** `@prismshadow/penguin-library-cli` is a private library package below the server, the CLI and the plugins: the server's `cli` subpath re-exports it for the server package's own commands, and a plugin's CLI module bundles it.
- **In place.** `penguin browser` is such a module before it moves into its plugin: it still lives in the server package, booted against the server's table, and the CLI lists it by hand after the generated list.

## Invariants
[invariants]: #invariants

### The static half names the path

> However a command reaches a command line — the CLI's own table or a plugin's through the server — the [command key](./PRFC-0024-cli-modules.md#guide-level-explanation) is still the only thing that locates its node, and the [code half](./PRFC-0001-module.md#slots-and-contributions) still receives that node: a register never builds its own path.

The key in the manifest is the single source of a command's path; the summary the help prints sits beside it in the same entry. The alternative — a register that calls `program.command("…")` itself — puts the path in two places, and the two disagree the first time someone edits one of them: help says one thing, dispatch answers another. Break this and the static half stops being data: nothing can be listed, checked, or projected without running the code.

### The CLI never loads plugin code at runtime

> However a plugin's commands reach a command line, the CLI still runs only the plugin code its build compiled in — the [CLI modules](./PRFC-0024-cli-modules.md#shipped-plugins-cli-modules) of the plugins it ships with — and still reaches every other plugin's commands only through the [server's command API](./PRFC-0024-cli-modules.md#guide-level-explanation): it never loads plugin code at runtime.

This is the ownership decision the RFC exists to record. A shipped CLI module is code of the same standing as the CLI's own commands — reviewed, versioned and released in one artifact — so running it in the CLI's process adds no trust decision. What the CLI never becomes is a plugin host at runtime: discovery and execution of what an admin installed live in the process whose tree the contributions are on, and the trust model is the plugin platform's own ([PRFC-0003](./PRFC-0003-plugin.md#principles)) — one process, one trust decision — instead of a second, weaker one growing inside the CLI. Break this and every future plugin surface (skills, tools, hooks) has to re-answer "which process runs plugin code", and the CLI becomes a plugin host that must be pushed to be right. Reading a package is not running it: the CLI does resolve the plugins it ships to read their library content (core's plugin library host), and that stays within the promise.

This invariant replaces *A plugin's commands belong to the server*, declared in v1.0.0 and retired in v1.2.0. That one promised that the server discovers and runs every plugin command. Since shipped CLI modules run their commands in the CLI's own process, it no longer holds as written. What it protected, that the CLI never becomes a plugin host at runtime, is the promise above.

### Implicit dispatch never guesses

> However many packages answer the same words, an [implicit dispatch](./PRFC-0024-cli-modules.md#guide-level-explanation) still runs nothing unless exactly one package answers: the rest is a report, and no hit at all still falls back to the CLI's own parse.

The convenience form must never resolve an ambiguity silently. Running the first candidate turns a user's typo into a plugin's action; the report-then-exit-2 shape keeps the command line predictable — the same words either do the one thing they mean or stop with a copyable line naming every candidate. Break this and the terminal becomes the one surface in the harness where a name collision is resolved by luck.

## Drawbacks
[drawbacks]: #drawbacks

Twenty command components boot statically, which the one-file assembly did not: `penguin version` measured about 60 ms slower, the price of the entry's boot. One command is now a class plus a manifest entry — more ceremony for a contributor than a function call, bought for a table that can be listed, checked and served. Implicit dispatch requires a running server to see plugin commands at all; offline, the CLI knows only its own. Buffered output holds a run's stdout and stderr in memory, unbounded; and while a run is in flight the server's own stdout and stderr are redirected into that response, so anything else the server prints in the window is captured with it. The fallback conflates "cannot ask the server" with "no plugin answers" — a failed listing reports an unknown command where naming the degradation would be kinder. And exit code 2 becomes part of the CLI's public contract, which scripts may now observe.

Each shipped CLI module boots a tree of its own on every invocation, so each adds to the startup cost the CLI's own table already pays. And a shipped module's commands change only with a CLI build: a plugin update that arrives through the server does not reach them.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**The earlier draft of this design** — the CLI reads each package's generated table and executes plugin code in its own process — was rejected because it made the CLI a second plugin host: it had to understand plugin resolution, and it split the trust decision between two processes. Ownership by process replaced it.

**The server collects the builtin commands too** — one host for everything — was rejected because the builtin table is fixed by the build, and the build that starts the server is the CLI's; collecting builtins in the server's tree would make `penguin --help` depend on a server being reachable, or on shipping the table twice.

**Keeping the hand-written registration** costs nothing today and every command later: the host keeps growing, help and dispatch and (someday) completion each re-read the registration by hand, and plugins remain shut out of the terminal entirely.

**Running a shipped plugin's commands through the server** too — one path for every plugin — was rejected for commands that act on the caller's terminal. A server run knows the caller's Project and Session and exchanges the files its options name relative to the caller's directory, but it still has no stdin, saves only into the one output directory a command's option names rather than at any path given, and returns its output buffered in the reply. **Letting the CLI import a shipped plugin's CLI half from the server package**, where the browser's lived, keeps the code where it is but closes a dependency cycle — the server and the CLI depend on the plugin for its library content — so the face moved into a library package below all three. **One tree for all shipped modules** was rejected because one module that fails to boot would take the others with it; a tree per module keeps the failure that module's.

## Prior art
[prior-art]: #prior-art

**VS Code's contribution points** are the shape of the static half: commands declared in the manifest as data — id plus a title per language — while the extension registers the handler in code; the workbench lists what is declared without executing the extension. Our slot takes the same shape, with the key playing the id's role.

**Git, kubectl, cargo and gh** all dispatch subcommands to named executables: `git-remote-*` on `PATH`, `kubectl-*` and `cargo-*` found there too, `gh` running extensions by name. The named form is universally the reliable one, and the discovery form varies in strictness — kubectl warns on collisions, cargo refuses ambiguous short names. `penguin exec <id>` is the named form; the implicit dispatch is the discovery form, held to the strictest of these standards: it runs nothing on ambiguity rather than picking.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- Should a failed listing be named? A degraded implicit dispatch that says "the server could not be asked" is more honest than an unknown-command error, and costs a second error path in the CLI.
- Should the run response's buffer have a cap, and what does a run that exceeds it answer?
- Shell completion from the static half: the keys and summaries are machine-readable already; the completion surface is out of scope here.
- Should authorization refine below admin — per command, per package — once a real consumer needs it?

## Future possibilities
[future-possibilities]: #future-possibilities

Completion and help can be served from the static half alone, for builtins and plugins alike, including `penguin exec ls`'s listing, which already is. Aliases — a second key answering the same entry — would let a package rename a command without breaking scripts. If the desktop ever grows a command palette over the same table, it reads the two routes and the local table with no new mechanism.

---

## Changes

### v1.2.0

- Note: v1.1.0 is the revision for member plugin commands, carried by [#1639](https://github.com/Prism-Shadow/penguin-harness/pull/1639) and design PR [#485](https://github.com/Prism-Shadow/penguin-harness-design/pull/485); whichever of the two lands second takes the next number.
- Added: a plugin the CLI ships with can carry commands that run in the CLI's process — its `./cli` export is a CLI module (`CliModule`) whose classes contribute to the CLI's `ShippedCommandsModule.commands`, listed from the CLI package's dependencies at build time and booted against the module's own table, with its own message groups (§ Guide-level "A shipped plugin's commands: a CLI module the build fixes", § Reference-level "Shipped plugins' CLI modules", a paragraph in § Summary).
- Added: the library package `@prismshadow/penguin-library-cli`, the face a CLI module's code uses instead of the server package.
- Removed: the invariant "A plugin's commands belong to the server", retired by name. Shipped CLI modules run their commands in the CLI's own process, so the server no longer discovers and runs every plugin command.
- Added: the invariant "The CLI never loads plugin code at runtime", which keeps what the removed one protected.
- Added: which failures of a shipped module the CLI catches at run time, and which only the build catches (§ Reference-level "Shipped plugins' CLI modules").
- Added: the startup and update costs under § Drawbacks, and the rejected alternatives under § Rationale and alternatives.

### v1.0.0

- Initial version
