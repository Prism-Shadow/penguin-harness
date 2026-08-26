# A command whose working directory is gone says so, instead of blaming the shell

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `core`
- **PR:** [#484](https://github.com/Prism-Shadow/penguin-harness/pull/484)

[中文版](2026-08-27-missing-workspace-error.zh.md)

`exec_command` answered `[spawn error: spawn bash ENOENT]` when the Session's Workspace directory had disappeared. The working directory is now checked before the spawn, so the failure names the directory.

## Details

- Node reports an unusable `cwd` as `spawn <command> ENOENT` — the error carries the command's name, not the directory's, so a deleted or moved Workspace was indistinguishable from a missing shell.
- `CommandSessionManager.spawn` now rejects a working directory that is missing or is not a directory, before starting the child. The message names the path and what to do about it, and the same check covers an `exec_command` `workdir` argument that does not resolve.
- The directory is not auto-created, matching `Agent.createSession` and the server's Workspace guard: a Workspace is never conjured, so a typo cannot silently start working in the wrong place.
