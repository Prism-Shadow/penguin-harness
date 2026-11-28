# Git CLI for Agent State

Records an Agent's workbench versions with the Git command line the host already has, instead of
the harness's built-in pure-JavaScript engine. The versions, the repository and the history the
Web App shows are the same either way: both engines write the same commits, so the plugin can be
installed or removed at any time.

## What it changes

The plugin contributes one engine to the server's `AgentStateHistoryModule.engines` slot: of the
engines a harness has, the harness's own side prefers this one. It runs the `git` on the
host's `PATH` — probed once, and the answer remembered for the process — the standard git
commands a script uses, one process each, for the two steps that grow with a workbench: writing
a commit, and reading a version's files back. Nothing is downloaded and nothing is kept; the
host's Git finds its own exec path, and the plugin sets no `GIT_EXEC_PATH` for it. Where there
is no `git` on the `PATH`, or it does not run,
this engine says so and the harness falls back: to the agent-state-dugite plugin's engine when
that plugin is installed (it fetches a build of its own), else to the built-in engine.

## Install

An administrator installs it on the Plugins page, like any server plugin. Building and testing
inside this repository:

```sh
pnpm --filter @penguinharness/agent-state-gitcl build
pnpm --filter @penguinharness/agent-state-gitcl test
```

The live suites (a workbench recorded and read back through the host's `git`, and the objects
each step writes checked against the built-in engine's) run where a `git` exists and are skipped
elsewhere, the same gate the other plugins' suites use (`PENGUIN_MUST_RUN`).
