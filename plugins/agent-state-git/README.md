# Native Git for Agent State

Records an Agent's workbench versions with native Git instead of the harness's built-in
pure-JavaScript engine. The versions, the repository and the history the Web App shows are the
same either way: both engines write the same commits, so the plugin can be installed or removed
at any time.

## What it changes

The harness keeps every cheap step of the Agent State repository (`<agentDir>/agent_state.git/`)
in-process — reading HEAD, telling whether a load changed anything, walking the history. An
engine does the two steps whose cost grows with a workbench, and this plugin does each in one
Git process:

| Step | How |
| --- | --- |
| Writing a version | one `git fast-import`: the folder's files, the commit and the branch move |
| Reading a version back (restore) | one `git cat-file --batch` for every tree and file of it |

It takes a step only from the folder size at which it measured faster than the built-in engine
(`fasterFrom`, set per platform from `bench/`), because what decides is the cost of starting a
process — about 4 ms on Linux, 7 ms on macOS and 34 ms on Windows:

| Platform | Commits from | Restores from |
| --- | --- | --- |
| Linux | 1 file | 150 files |
| macOS | 30 files | 100 files |
| Windows | 300 files | 150 files |

A smaller step, an unchanged load, the history and a removal stay with the built-in engine.

Those processes address only the Agent's repository (`--git-dir`). They drop every `GIT_*`
variable of the server's environment, read no system or global Git config, never run a hook, never
sign, and sync what they write (`core.fsync=objects,reference`). Objects are stored loose, as the
built-in engine stores them. Who a version is by is the harness's decision and comes in the commit
itself: the member who asked for it, else the server's Git identity.

## The Git it runs

The plugin includes Git for macOS (Intel and Apple silicon), glibc Linux (x86, x64,
ARM and ARM64) and Windows (x86, x64 and ARM64). Installation and activation work offline.
An administrator can still set `LOCAL_GIT_DIRECTORY` to a Git in dugite’s directory layout;
otherwise the plugin extracts its own platform payload into the Agent State engine cache.
The macOS desktop app is the exception: Apple notarizes an app only when every program in it is
signed, so that app carries the Git for its own architecture as files, signed with the app, and
the plugin runs it from there.
The server checks `git version` before choosing the native engine. Unsupported platforms and
unusable programs retain the built-in engine.

When packing the plugin, the build verifies GitHub Desktop’s archives against the SHA-256
digests in the locked dugite package. `DUGITE_CACHE_DIR` can supply verified archives to the
packaging machine. See [Third-party notices](THIRD-PARTY-NOTICES.md) for the Git sources
and redistribution information.

## Install

It ships with the harness build. On the Plugins page, an administrator installs it on the server:
the App re-assembles itself, no restart. Written by hand, it is a row of a Project's
`.project_config.toml`:

```toml
[plugins]
"@penguinharness/agent-state-git" = "*"
```

## Development

```bash
pnpm --filter @penguinharness/agent-state-git test    # stages the current platform for the live suites
pnpm --filter @penguinharness/agent-state-git bench   # the two engines, step by step
```

The tests run the server's own Agent State suite with this engine, and check that it writes the
very commits the built-in engine writes. Where the host cannot get the Git they skip, unless
`PENGUIN_MUST_RUN` names `agent-state-git` (CI does).

## License

The plugin adapter is Apache-2.0. The bundled Git program and libraries retain their own licenses.
