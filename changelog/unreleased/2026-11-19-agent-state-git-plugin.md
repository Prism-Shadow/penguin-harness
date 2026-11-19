# Workbench versions name who made them, and native Git can record them

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `core`, `plugins`, `docs`
- **PR:** [#1608](https://github.com/Prism-Shadow/penguin-harness/pull/1608)

[中文版](2026-11-19-agent-state-git-plugin.zh.md)

A workbench version's commit in `agent_state.git/` names its author: the member whose request
recorded it, else the server's Git identity. A new server plugin, `agent-state-git`, has native
Git write those commits and read versions back in place of the built-in isomorphic-git engine,
which stays the default.

## Who a version is by

- A version recorded by a member's request (a restore, a reload, a zip import, a switch, the App
  Center switch, a removal) is authored under the member's display name. A member without a
  display name, and every field the account does not hold (accounts have no email), takes the
  server's own identity.
- The server's identity is read the way git reads it, field by field: `GIT_AUTHOR_*` /
  `GIT_COMMITTER_*`, then `author.*` / `committer.*`, then `user.*` in the repository's `config`
  over the global file (`$GIT_CONFIG_GLOBAL`, else `$XDG_CONFIG_HOME/git/config` and
  `~/.gitconfig`), then `EMAIL` for the email, then `PenguinHarness <penguin@localhost>`. Only the
  `[user]`, `[author]` and `[committer]` sections are read, an `include` is not followed, and no
  config is written.
- Versions an agent's own edit records carry the server's identity. The committer is always the
  server's.

## The engine slot

- The server's module tree gained `AgentStateHistoryModule` with an `engines` slot, and core's
  plugin contract the `AgentStateEngine` types. An engine writes one commit and reads blobs back;
  reading HEAD and trees, the no-change check, the history walk and removals stay in the server.
- An engine is used once its source answers with it, from the folder size it declares it is
  faster from (`fasterFrom`). One that cannot start is replaced by the built-in engine for that
  step, with a log line; git refusing a write is reported as itself. Both engines write the same
  commits.

## The agent-state-git plugin

- `@penguinharness/agent-state-git` runs GitHub Desktop's build of Git as dugite 3.3.3 pins it
  (Git 2.56.1). The first time it runs on a host it downloads that platform's archive (24–65
  MiB), verifies its sha256, and keeps only `git` (and on Windows the DLLs it loads), 3.4–7.1 MiB, under
  `<data root>/cache/agent-state-git.engine/`. `LOCAL_GIT_DIRECTORY` and `DUGITE_CACHE_DIR` work
  as in dugite. No build or install downloads anything: the workspace does not run dugite's
  postinstall.
- It takes a commit from 1 file on Linux, 30 on macOS and 300 on Windows, and a restore from 150,
  100 and 150 files, where its bench measured it faster than the built-in engine; smaller steps
  stay built-in.
- A commit is one `git fast-import`, a restore one `git cat-file --batch`. Each process addresses
  only the Agent's repository, drops every `GIT_*` variable, reads no system or global config, runs
  no hook, does not sign, and syncs objects and refs.
- On a host with no build (musl, other architectures), when the download fails, or when the
  program does not start, the built-in engine records versions and the log says why.
- The plugin is on the Plugins page with no category; an admin installs it on the server.
- The plugin runs the server's Agent State suite with its engine, and checks that every step
  writes the same objects as the built-in engine. `pnpm --filter @penguinharness/agent-state-git
  bench` compares the two engines step by step.
- The Skills & Plugins docs describe who a version is by and the plugin.
