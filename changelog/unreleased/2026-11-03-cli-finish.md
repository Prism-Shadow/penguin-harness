# The CLI's static command registry dissolves into contributions next to their code

- **Date:** 2026-11-03
- **Type:** feature
- **Scope:** `cli`, `server`

[中文版](2026-11-03-cli-finish.zh.md)

The CLI's built-in commands no longer live in a central registry file. Each command file in
`commands/` now carries its own `@Component` class next to the code it registers — the class's
`contributes["CliCommandsModule.commands"]` entry is the command's data half (its key and
one-line summary) and its `@Bind` field is the code half. The list of those classes is
generated, not hand-kept: `gen:ifaces` gains a `--components-out` flag that scans both
packages for classes contributing to the slot and writes `src/cli-commands.gen.ts`, so
adding a command means editing one file and the table follows the source scan. The server
package's resource commands (agent/project/schedule/cost/config) take part through the same
generated table, imported via the `@prismshadow/penguin-server/cli` subpath.

Alongside this, the last command still owned by the CLI package moves to the server:
`penguin browser` and its shared helpers join the server's `src/cli`, contributed through a
`BrowserCommandsModule` the same way `org` is contributed through the company module. The
CLI boots it after the built-in and company commands. Adding a command no longer requires
touching the CLI package when the command's client layer already lives in the server.

One visible change: help now lists the built-in commands in source-file path order, so the
order of entries under `penguin --help` changes; `penguin browser` keeps its behavior.
