# A plugin the CLI ships can carry commands that run in the CLI

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `cli`, `server`, `core`, `library`
- **PR:** [#1645](https://github.com/Prism-Shadow/penguin-harness/pull/1645)

[中文版](2026-11-19-shipped-cli-modules.zh.md)

A plugin the CLI depended on could carry commands that ran in the CLI's own process, beside the CLI's own. Its package exported a `./cli` CLI module (`CliModule` in `@prismshadow/penguin-core/cli`) with the command classes, the table its build generated for them and their message groups. `penguin browser` became the first such module while it still lived in the server package. Nothing a user typed or saw changed: the same commands, flags, output, exit codes, help and languages.

## Details

- The CLI's build listed every plugin dependency (`@penguinharness/*`) that exported `./cli` in a generated `cli-modules.gen.ts` and bundled those modules, each imported only when its turn came. At startup each module booted in a tree of its own against its own table, and its commands followed the CLI's own and the server package's.
- Nothing a shipped module did could stop the CLI. A module that threw while it evaluated, or whose classes did not boot, was left out with one warning naming its package. So was a command with a malformed key, a key its module repeated, or a name or alias already on the program. A command whose register threw was taken off the program again. The rest of the CLI ran, `penguin server` included.
- A module's commands received the CLI's message bundle with the module's own groups for the invocation's language; a group named like one of the CLI's kept the CLI's, with a warning. The CLI's message table no longer carried the browser's group.
- The server connection, the API client and its error, terminal input, `cutText` and `renderTable` moved into the new private library package `@prismshadow/penguin-library-cli`, together with the readers of `server.lock` and `cli-session.json`. A CLI module's code used that package instead of the server package. The server's `cli` and `lock` subpaths re-exported everything under the same names.
- `scripts/check-publishable.mjs` also read the `library/` packages, so a published package that listed one of them as a runtime dependency failed the check.
- The design was PRFC-0024 v1.2.0, amended in its own pull request, [#1649](https://github.com/Prism-Shadow/penguin-harness/pull/1649).
