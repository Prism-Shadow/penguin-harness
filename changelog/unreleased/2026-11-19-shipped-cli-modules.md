# A plugin the CLI ships can carry commands that run in the CLI

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `cli`, `server`, `core`, `library`
- **PR:** [#1645](https://github.com/Prism-Shadow/penguin-harness/pull/1645)

[中文版](2026-11-19-shipped-cli-modules.zh.md)

A plugin the CLI depended on could carry commands that ran in the CLI's own process, beside the CLI's own. Its package exported a `./cli` CLI module (`CliModule` in `@prismshadow/penguin-core/cli`) with the command classes, the table its build generated for them and their message groups. `penguin browser` became the first such module while it still lived in the server package. Nothing a user typed or saw changed: the same commands, flags, output, exit codes, help and languages.

## Details

- The CLI's build listed every plugin dependency (`@penguinharness/*`) that exported `./cli` in a generated `cli-modules.gen.ts` and bundled those modules. At startup each module booted in a tree of its own against its own table, and its commands followed the CLI's own and the server package's.
- A module that failed to boot was left out with one warning naming its package, and so was a command with a malformed key or a first word the CLI already had. The rest of the CLI ran.
- A module's commands received the CLI's message bundle with the module's own groups for the invocation's language. The CLI's message table no longer carried the browser's group.
- The server connection, the API client and its error, terminal input, `cutText` and `renderTable` moved into the new private library package `@prismshadow/penguin-library-cli`, together with the readers of `server.lock` and `cli-session.json`. A CLI module's code used that package instead of the server package. The server's `cli` and `lock` subpaths re-exported everything under the same names.
- PRFC-0024 moved to v1.1.0. It described the shipped CLI modules, and its invariant "A plugin's commands belong to the server" became "The CLI never loads plugin code at runtime".
