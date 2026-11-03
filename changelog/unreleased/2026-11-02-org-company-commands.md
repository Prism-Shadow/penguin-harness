# The org command moves into the server package, contributed through a company module

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `server`, `cli`

[中文版](2026-11-02-org-company-commands.zh.md)

`penguin org` is now owned by the server package. The command joins the client layer the
resource commands already share in the server's `src/cli` — the HTTP/SSE client with the
auto-start of a stopped server, the stored login session, the table renderer, the message
tables — together with the one session-info helper it needs, which the CLI re-exports so
its own callers do not change. The command itself is a contribution: a
`CompanyCommandsModule` in the server owns a `commands` slot, `OrgCommand` is one child
component whose `contributes["CompanyCommandsModule.commands"]` entry carries the data half
and whose `@Bind` field carries the code half, and `bootCompanyCommands()` boots that module
against the server's generated table and returns the collected commands. The CLI boots these
commands after its own, so `penguin org` behaves as before; the one visible change is that
help now lists `org` after the built-in commands instead of between `schedule` and
`browser`. The server can now add company commands without the CLI shipping first, and
other packages can contribute their own commands to the same slot the same way.
