# PRFC-0024 CLI Modules

[中文版](PRFC-0024-cli-modules.zh.md)

- Feature Name: `cli-modules`
- Start Date: 2026-11-02
- PRFC PR: none yet (native to this repository)
- Implementation PR: — (the design travels with the proposal's implementation branch `feat/cli-command-contributions` until the RFC pull request opens)

## Summary
[summary]: #summary

The `penguin` command line becomes a set of command contributions under the module mechanism ([PRFC-0001](./PRFC-0001-module.md#the-three-primitives)). A command is one contribution of a `@Component` class: its data half sits in the manifest — a **command key**, the argv path the command answers, plus a one-line summary in each language — and its code half is the class's `@Bind` field, the same class shape a sandbox backend is written with. Two hosts collect such contributions, each in its own process. The CLI's own commands are contributions to the CLI's `CliCommandsModule.commands` slot, booted statically and fixed by the build. A plugin's commands are contributions to the server's `PluginCliCommandsProvider.commands` slot: the server is the one that knows them and the one that runs them, through two routes the CLI reads the way the web app reads its contributions. Ownership follows the process — a command belongs to the process that can run it, and the CLI never loads plugin code to dispatch one.

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

A command contributes the way everything else contributes ([PRFC-0001](./PRFC-0001-module.md#slots-and-contributions)): a **data half** in the manifest, read without executing any code, and a **code half** bound on the contributing class.

- The data half is a **command key** — `a.b.c`, the argv segments the command answers (`penguin a b c ARGS`) — and a **summary**, one line per language, which is what help prints.
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
    this.command = { register: (command, ctx) => registerAuthCommand(node(command), messages(ctx.language)) };
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

- **One plugin answers.** The CLI asks a server that is already running for the command list (it does not start one), finds exactly one package whose commands answer the words, runs it through the server, and prints what came back as if it were its own.
- **Two or more answer.** That is ambiguity. The CLI prints one copyable `penguin exec <package> …` line per package, exits 2, and runs nothing — the caller says which it meant.
- **None answers.** The command line goes back to the CLI's own parse, which reports the unknown command as it always has.

`penguin exec <package> [args…]` is the unambiguous form: the package is named, so there is nothing to disambiguate. It resolves npm full names exactly, and a short name while exactly one contributing package carries it. Like every command that needs a server, it starts one when none is running.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### The contract in the core plugin package

The command contract lives in `@prismshadow/penguin-core/plugin`, so a contributor depends on no CLI package:

- `CliCommandSummary` — `{ en, zh }`, the one-line summaries.
- `CliCommandData` — `{ key, summary }`, the slot's data type.
- `CliCommandEntry` — the data half plus the manifest's `id`, as a collected contribution carries it.
- `CliCommandProgram` — the command node the host located by the key, with the summary already set as its description. It is `Opaque<"Command">`: the contributor types it with the commander its own package depends on, so the contract pins no commander version.
- `CliCommandContext` — what the code half may use from the host: the resolved `language`, `write` / `writeErr`, and `setExitCode`.
- `CliCommandCode` — `{ register(command, ctx) }`, the code half's shape.
- `cliCommandKeyFault(key)` — the shared key grammar: lowercase `[a-z][a-z0-9-]*` segments joined by dots, `null` when the key passes. Dispatch, attribution and the key's translation into command nodes all read this one judgment.

### The CLI host

The CLI boots `CliCommandsModule` once per invocation, reads the contributions off the slot, turns each key into its command node on the program, writes the summary as the node's description, and calls the bound register with that node. The language the invocation resolved (`PENGUIN_LANG`, English by default) is handed to every register through the context. The host owns help, version, `exec`, `update`, `auth`, `plugin` and the serve group like any other node owns its own surface — there is no second place where command names are minted.

The table is a generated artifact in the same sense as every other manifest: `gen:ifaces` projects both slots — `CliCommandsModule.commands` in the CLI package and `PluginCliCommandsProvider.commands` in the server package — into `ifaces.json`, and the same regeneration paths (`typecheck`, build, test, `deploy.mjs`, `release-npm.sh`) keep it in step with the code.

### The server's slot and the two routes

`PluginCliCommandsProvider` owns the slot, contributes the routes to `HttpModule.routes` under `/api/cli/commands`, and reads the contributions off its slot at boot. Three things drop a contribution, each with a warning naming the module and the id: the contributing module has no loaded plugin package behind it; the key fails `cliCommandKeyFault`; one package contributes the same key twice — both entries go, so that package's commands stay unambiguous. Attribution to packages is claimed per call, so a plugin table change is visible without a re-boot of the tree.

The run side builds a fresh commander program per request — every command of the named package, each on the node its key locates and described by its summary — then parses the argv against that program alone. With no arguments it prints the package's help; commander's own help and usage errors answer with commander's exit codes, passed through; a command's own failure is caught in the controlled call chain, written to the response's stderr with exit code 1, and never escapes into the server. Output is buffered into the response — the run answers with strings, not with a live process. This is request-level containment, not process isolation: a plugin runs in the same process as the platform, and installing one means trusting its code ([PRFC-0003](./PRFC-0003-plugin.md#principles)). What the boundary guarantees is that ordinary failures — thrown errors, rejected promises, usage errors, help — come back as a response instead of a broken request.

Authorization is two-layered: the routes carry `auth: "user"`, so listing is open to any signed-in user; the run handler refuses anyone but an admin with `403 admin_required`, and a refused request never reaches a command's register. An unknown package answers `404 unknown_package`; a malformed body answers with the request validation's own names.

### Dispatch, by example

The CLI's implicit dispatch is a pure function of the argv and the listing. The **command words** are the argv's leading words up to its first option. A key **answers** an argv when its segments and the command words agree for as far as both go:

- `tool sub` answers `tool sub x`, and also `tool` and `tool --help`, where the words stop first.
- `tool sub` does not answer `tool other`.
- A package with several commands is one candidate: the match is per package, deduplicated.
- `tool` (package A) and `tool sub` (package B) both answer `tool sub x` — two packages, so ambiguous. Words that one package prefixes and another extends are not a tiebreaker; `penguin exec` exists to break ties by name.

The ambiguity report prints one line per package — `penguin exec <full-package-name> -- <original argv>` — with each word quoted the way a POSIX shell reads it back, and `--` present whenever the argv carries an option, so the CLI hands the option to the plugin instead of reading it itself. The report goes to stderr with exit code 2, and nothing runs.

`penguin exec` resolves the name against the listing: an exact npm full name wins; a short name (the part after the last `/`) works while exactly one contributing package carries it; a collision names the full names, an unknown name lists the candidates, and both exit 1 without running anything. The request carries `prog` — `penguin` for implicit dispatch, `penguin exec <name>` for the explicit form — so usage lines print as the caller invoked them, and `language`, so the summaries and the command's own text come back in the caller's language.

One degradation is stated openly: when the listing cannot be fetched — no server running, or the query fails — the CLI cannot know whether a plugin would have answered, and it falls back to its own parse, which reports the unknown command. Implicit dispatch treats "cannot ask" the same as "no answer"; `penguin exec` exists precisely so a caller who needs the command does not depend on that fallback.

## Invariants
[invariants]: #invariants

### The data half names the path

> However a command reaches a command line — the CLI's own table or a plugin's through the server — the [command key](./PRFC-0024-cli-modules.md#guide-level-explanation) is still the only thing that locates its node, and the [code half](./PRFC-0001-module.md#slots-and-contributions) still receives that node: a register never builds its own path.

The key in the manifest is the single source of a command's path; the summary the help prints sits beside it in the same entry. The alternative — a register that calls `program.command("…")` itself — puts the path in two places, and the two disagree the first time someone edits one of them: help says one thing, dispatch answers another. Break this and the data half stops being data: nothing can be listed, checked, or projected without running the code.

### A plugin's commands belong to the server

> However the CLI dispatches, a plugin's commands are still discovered and run by the server, and the CLI still reaches them only through the [server's command API](./PRFC-0024-cli-modules.md#guide-level-explanation) — it never loads plugin code to dispatch one.

This is the ownership decision the RFC exists to record. The CLI is the client; discovery and execution live in the process whose tree the contributions are on, and the trust model is the plugin platform's own ([PRFC-0003](./PRFC-0003-plugin.md#principles)) — one process, one trust decision — instead of a second, weaker one growing inside the CLI. Break this and every future plugin surface (skills, tools, hooks) has to re-answer "which process runs plugin code", and the CLI becomes a plugin host that must be pushed to be right.

### Implicit dispatch never guesses

> However many packages answer the same words, an [implicit dispatch](./PRFC-0024-cli-modules.md#guide-level-explanation) still runs nothing unless exactly one package answers: the rest is a report, and no hit at all still falls back to the CLI's own parse.

The convenience form must never resolve an ambiguity silently. Running the first candidate turns a user's typo into a plugin's action; the report-then-exit-2 shape keeps the command line predictable — the same words either do the one thing they mean or stop with a copyable line naming every candidate. Break this and the terminal becomes the one surface in the harness where a name collision is resolved by luck.

## Drawbacks
[drawbacks]: #drawbacks

Twenty command components boot statically, which the one-file assembly did not: `penguin version` measured about 60 ms slower, the price of the entry's boot. One command is now a class plus a manifest entry — more ceremony for a contributor than a function call, bought for a table that can be listed, checked and served. Implicit dispatch requires a running server to see plugin commands at all; offline, the CLI knows only its own. Buffered output holds a run's stdout and stderr in memory, unbounded. The fallback conflates "cannot ask the server" with "no plugin answers" — a failed listing reports an unknown command where naming the degradation would be kinder. And exit code 2 becomes part of the CLI's public contract, which scripts may now observe.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**The earlier draft of this design** — the CLI reads each package's generated table and executes plugin code in its own process — was rejected because it made the CLI a second plugin host: it had to understand plugin resolution, and it split the trust decision between two processes. Ownership by process replaced it.

**The server collects the builtin commands too** — one host for everything — was rejected because the builtin table is fixed by the build, and the build that starts the server is the CLI's; collecting builtins in the server's tree would make `penguin --help` depend on a server being reachable, or on shipping the table twice.

**Keeping the hand-written registration** costs nothing today and every command later: the host keeps growing, help and dispatch and (someday) completion each re-read the registration by hand, and plugins remain shut out of the terminal entirely.

## Prior art
[prior-art]: #prior-art

**VS Code's contribution points** are the shape of the data half: commands declared in the manifest as data — id plus a title per language — while the extension registers the handler in code; the workbench lists what is declared without executing the extension. Our slot takes the same shape, with the key playing the id's role.

**Git, kubectl, cargo and gh** all dispatch subcommands to named executables: `git-remote-*` on `PATH`, `kubectl-*` and `cargo-*` found there too, `gh` running extensions by name. The named form is universally the reliable one, and the discovery form varies in strictness — kubectl warns on collisions, cargo refuses ambiguous short names. `penguin exec <package>` is the named form; the implicit dispatch is the discovery form, held to the strictest of these standards: it runs nothing on ambiguity rather than picking.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- Should a failed listing be named? A degraded implicit dispatch that says "the server could not be asked" is more honest than an unknown-command error, and costs a second error path in the CLI.
- Should the run response's buffer have a cap, and what does a run that exceeds it answer?
- Shell completion from the data half: the keys and summaries are machine-readable already; the completion surface is out of scope here.
- Should authorization refine below admin — per command, per package — once a real consumer needs it?

## Future possibilities
[future-possibilities]: #future-possibilities

Completion and help can be served from the data half alone, for builtins and plugins alike, including `penguin exec <package>`'s no-argument help, which already is. Aliases — a second key answering the same entry — would let a package rename a command without breaking scripts. If the desktop ever grows a command palette over the same table, it reads the two routes and the local table with no new mechanism.

---

## Changes

### v1.0.0

- Initial version
