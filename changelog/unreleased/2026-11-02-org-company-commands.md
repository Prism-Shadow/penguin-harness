# The org command moves into the server package, contributed like any server command

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `server`, `cli`

[中文版](2026-11-02-org-company-commands.zh.md)

`penguin org` is now owned by the server package. The command and the client layer it is
built on — the HTTP/SSE client with the auto-start of a stopped server, the stored login
session, the table renderer and the relative-time formatter, the message tables the moved
code reads — moved from the CLI package into the server's `src/cli`, exported as the
`@prismshadow/penguin-server/cli` subpath. The command itself is a contribution: a
`CompanyCommandsModule` in the server owns a `commands` slot, `OrgCommand` is one child
component whose `contributes["CompanyCommandsModule.commands"]` entry carries the data half
and whose `@Bind` field carries the code half, and `bootCompanyCommands()` boots that module
against the server's generated table and returns the collected commands. The CLI boots these
commands after its own, so `penguin org` behaves as before; the one visible change is that
help now lists `org` after the built-in commands instead of between `schedule` and
`browser`. Embedders that already import the client helpers from the CLI package switch to
the server's subpath; the server can now add company commands without the CLI shipping first.
