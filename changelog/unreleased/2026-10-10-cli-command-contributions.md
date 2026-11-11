# Plugin commands for the CLI: contributions to the server's tree, run through the server

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `server`, `cli`

[中文版](2026-10-10-cli-command-contributions.zh.md)

The `penguin` CLI becomes a program of command contributions. The CLI's own twenty commands are each one `@Component` class whose `contributes["CliCommandsModule.commands"]` entry is the command's data half — a `key` (the command path, `a.b.c` answering `penguin a b c ARGS`) and a one-line summary in each language — and whose `@Bind(entry.id)` field is its code half, the same class shape the sandbox backends are written with. A static boot of `CliCommandsModule` collects them: the host turns each key into its command node on the program, writes the summary as the node's description and calls the bound register. A register never names its own path; the contract types live in the core SDK's CLI command contract (`@prismshadow/penguin-core/cli`), so a contributor depends on no CLI package. The serve group — `server`, `web`, `server status`, `server stop` and `server reset-admin-password` — stays a set of CLI commands, and the CLI package is the one that carries it: the CLI is the code that starts the server, so what it collects is fixed by the build and the same in the CLI process and the server's.

## A plugin contributes commands to the server

A plugin contributes a command the way it contributes anything else: a class whose `contributes["PluginCliCommandsProvider.commands"]` entry is the data half and whose `@Bind(entry.id)` field is the code half. The commands live in the server's tree with the rest of the plugin, so the server is the one that knows them — and the one that runs them. Contributions that cannot run drop out with a warning: a module no loaded plugin is behind, a key that is not a command path, and a key one package contributes twice (both entries go, so the package's commands stay unambiguous).

The server serves the commands on two routes. `GET /api/cli/commands` lists every plugin command with its package, open to any signed-in user — the way the web app reads its slots from `GET /api/contributions`. `POST /api/cli/commands/run`, admin only, parses an argv against one package's commands on a fresh program and answers with what they printed and their exit code: with no arguments the package's help, a usage error as commander prints it, and a command's own failure as exit code 1 on stderr — a run never escapes into the server. Output is buffered, not streamed; it arrives in the response when the run ends.

## Dispatch, ambiguity, `penguin exec`

A first word that names none of the CLI's own commands is looked up among the plugins before the CLI reports an unknown command: the listing is matched against it, one package answering runs, and the run's output and exit code are the caller's. The lookup asks only a server that already runs — one that is not running is not started for an unproven word, and a listing that answers nothing leaves the command line to the CLI's own parse, which reports the unknown command as it always has. Two or more packages answering the same words is ambiguous: the report lists one copyable `penguin exec <package>:<id> …` line per package — the id being the longest key of that package's commands that answers the argv, the argv's remainder pasted after, each word quoted the way a POSIX shell reads it back — and exits with code 2, nothing runs.

**`penguin exec <id> [args…]`** names a plugin command directly by its dotted id — `sandbox.wsl.restart`, two segments or more — resolved exactly against the listing: no prefix, suffix or short-form matching, and every option after the id, `--help` included, belongs to the plugin command. When two plugins contribute the same id, the full npm package names it: `penguin exec <package>:<id>`, scope included. `penguin exec ls [package]` lists the ids the plugins contribute, summaries beside them. Unlike the bare lookup, `penguin exec` starts a server that is not running, as any command that needs one does.

**Compatibility.** The entry contract holds: `cli(argv)` exported and returning an exit code, `--version` answered by the host. The CLI's command surface for an install whose packages ship together is unchanged; what changes is how the commands are collected and where a plugin's commands come from.
