# Native Git for Agent State

Records an Agent's workbench versions with native Git: the plugin contributes the engine that
writes a version and reads it back, in one Git process each.

## What it does

The harness keeps every cheap step of the Agent State repository (`<agentDir>/agent_state.git/`)
in-process — reading HEAD, telling whether a load changed anything, walking the history. An
engine contributes the two steps whose cost grows with a workbench, and this plugin does each in
one Git process:

| Step | How |
| --- | --- |
| Writing a version | one `git fast-import`: the folder's files, the commit and the branch move |
| Reading a version back (restore) | one `git cat-file --batch` for every tree and file of it |

Every engine writes the same bytes, so the same load is the same commit under any of them: a
repository keeps its history across an engine's installation, and what one engine writes another
reads. The agent-state-gix plugin's interchange suite pins this by commit id equality against
real Git.

Those processes address only the Agent's repository (`--git-dir`). They drop every `GIT_*`
variable of the server's environment, read no system or global Git config, never run a hook, never
sign, and sync what they write (`core.fsync=objects,reference`). Objects are stored loose. Who a
version is by is the harness's decision and comes in the commit itself: the member who asked for
it, else the server's Git identity.

## The Git it runs

The plugin includes Git for macOS (Intel and Apple silicon), glibc Linux (x86, x64,
ARM and ARM64) and Windows (x86, x64 and ARM64). Installation and activation work offline.
An administrator can still set `LOCAL_GIT_DIRECTORY` to a Git in dugite's directory layout;
otherwise the plugin extracts its own platform payload into the Agent State engine cache.
The macOS desktop app is the exception: Apple notarizes an app only when every program in it is
signed, so that app carries the Git for its own architecture as files, signed with the app, and
the plugin runs it from there.
The server checks `git version` before it opens the engine. A platform without the payload, or a
program that does not answer, leaves the deployment without an engine — nothing writes versions
behind it, and the server says so.

When packing the plugin, the build verifies GitHub Desktop's archives against the SHA-256
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
pnpm --filter @penguinharness/agent-state-git bench   # this engine, step by step
```

The tests run the server's own Agent State suite with this engine. Where the host cannot get the
Git they skip, unless `PENGUIN_MUST_RUN` names `agent-state-git` (CI does).

## License

The plugin adapter is Apache-2.0. The bundled Git program and libraries retain their own licenses.
