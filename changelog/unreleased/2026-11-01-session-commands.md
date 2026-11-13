# Resource commands move into the server package

- **Date:** 2026-11-01
- **Type:** refactor
- **Scope:** `server`, `cli`

[中文版](2026-11-01-session-commands.zh.md)

The CLI's five resource commands — `agent`, `project`, `schedule`, `cost` and `config` — and the shared pieces they run on (the connection client and its connection resolution, the sign-in session, approval prompting, the root option, the language tables and the listing helpers) move from the CLI package into the server's `src/cli/`, each command keeping its contribution shape: the same `@Component` entry with a `cli.<key>` id and a `@Bind`-bound register. The CLI imports them through `@prismshadow/penguin-server/cli`; its own commands, including the serve group and `session`, stay where they were.

The `config` command is split into its command tree, model subcommands, group-connection helpers and list formatting, so every moved or split file stays small enough to read in one pass. The CLI's message table (`i18n.ts`) is a special case: it moves into the server whole — one file, interface and both language tables inline — rather than being split. No behavior changes: every command answers with the same words and the same data paths it did before.
