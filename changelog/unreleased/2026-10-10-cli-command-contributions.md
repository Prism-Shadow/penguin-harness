# CLI commands become contributions: `cli.commands`, the serve group moves into the server package

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `server`, `cli`

[中文版](2026-10-10-cli-command-contributions.zh.md)

The CLI stops being one block of hard-wired registrations and becomes a host plus command contributions. A package contributes commands through the same two halves every other contribution has: a **data half** — manifest entries under `contributes: { "cli.commands": [...] }`, each a `key` (`a.b.c` answers `penguin a b c ARGS`) and a one-line summary in each language — read without executing the package, so help and completion answer from data alone; and a **code half** — the package entry's `registerCliCommands(program, ctx)` export, imported only when a dispatch names one of its keys. Everything a contributed command may reach lives on the `CliContext` it is handed: the resolved language, this invocation's data root, the output and table helpers, the API client (connection resolution and auto-start included, auth the host's) and the remembered login session — never the token itself. The contract types live in the core plugin contract (`@prismshadow/penguin-core/plugin`), so a contributor depends on no CLI package.

## Discovery, ownership, dispatch

On every start the host reads the data halves of the resolved module set: the CLI's own table, the server package's declaration module, and the plugin closure of the data root — each plugin's generated table read the way the server's plugin host reads it, never importing the plugin. Help lists everything from these alone.

Ownership rules what a package may register. The host keeps `help`, `version`, `exec`, `update`, `auth` and `plugin` for itself; another package's key owns its subtree unless the owner declared it open, and the server package opens `server.*`. Malformed entries and a package's own duplicate keys drop out; an invalid registration is ignored — it never reaches help or dispatch — and is kept for review. The **same key from two packages is not an error**: both stay, and the invocation is the moment that says which one.

Dispatch matches keys against argv: a key is a hit when its segments are argv's leading segments. Hits from **one package** execute — commander's own nesting handles `server` + `server.status` from a single package. Hits from **two or more packages** (a prefix overlap included) are ambiguous: the host reports one copyable `penguin exec <package> …` line per candidate, the original argv shell-quoted, and a note to tell the user afterwards which package's command ran — exit code 2, nothing executes.

## The new host commands

- **`penguin exec <package> [args…]`** runs one contributing package's command by naming the package: an exact npm name always resolves, a short name while exactly one contributor carries it, a collision lists the full names to use. The package's own parse handles the rest, so `exec` is never ambiguous.
- **`penguin plugin check`** reviews the contributions in one report: ambiguous keys (with every package that contributes each), invalid registrations (with the rendered reason — a reserved root, a foreign subtree not open, a duplicate, a malformed entry), skills that call an ambiguous command (file and line — a skill saying `penguin x y` fixes no ambiguity by being written down), and the faults that kept a source out of the discovery. Exit 0 when nothing is found, 1 when anything is.

## The serve group moves into the server package

`server`, `web`, `server status`, `server stop` and `server reset-admin-password` — the service commands the server package is the natural owner of — move from the CLI package into the server package as its own `cli.commands` contribution, arriving with the server's every push instead of waiting for a CLI reinstall. Behavior is unchanged: the same options, the same output, the same exit codes, the same `--root` > `PENGUIN_HOME` > default priority. The descriptions a listing prints are the contribution's own summaries, read back by the code half from the same declaration, so help and the registered command cannot drift. The CLI's remaining commands (config, run, chat, ls, input, logs, agent, project, cost, schedule, org, browser) stay in the CLI package but now ride the same dispatch — data halves from a table in the package, code halves imported lazily per key.

**Compatibility.** No user-visible behavior changes for an install whose packages ship together (a release, a push). Two mixes are worth naming: an install whose **server package predates this change** (a machine mid-upgrade) contributes no serve group — `penguin server` reports an unknown command until the server package catches up, and `penguin plugin check` names the fault; and a **development checkout** must rebuild the server package before the CLI's dev runs resolve its new subpath exports.

**Stable surfaces unchanged.** The entry contract holds: `cli(argv)` exported and returning an exit code, `--version` answered by the host — the desktop's server launch (`mod.cli(["server"])`) and the pushed-CLI check both run through exactly these.
