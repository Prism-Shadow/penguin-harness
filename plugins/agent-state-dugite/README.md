# Native Git (dugite) for Agent State

Records an Agent's workbench versions with native Git instead of the harness's built-in
pure-JavaScript engine. The versions, the repository and the history the Web App shows are the
same either way: both engines write the same commits, so the plugin can be installed or removed
at any time.

Where the host already has a `git`, the agent-state-gitcl plugin records versions with it and
needs no download; this plugin is the fallback for a host without one.

## What it changes

The harness keeps every cheap step of the Agent State repository (`<agentDir>/agent_state.git/`)
in-process — reading HEAD, telling whether a load changed anything, walking the history. An
engine does the two steps whose cost grows with a workbench, and this plugin runs each through
Git:

| Step | How |
| --- | --- |
| Writing a version | the standard git commands a script uses — the files' blobs, the tree, the commit, the branch move — one process each |
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

Those processes address only the Agent's repository (`--git-dir`), and they are plumbing
commands: they run no hook, and they store the objects loose, as the built-in engine stores them.
Who a version is by is the harness's decision and comes in the commit itself: the member who
asked for it, else the server's Git identity.

## The Git it runs

GitHub Desktop's build of Git, as [dugite](https://github.com/desktop/dugite) pins it: dugite's
`embedded-git.json` names one archive of
[dugite-native](https://github.com/desktop/dugite-native) per platform, with its sha256. The
first time the plugin runs on a host, it downloads that archive (24–65 MiB), verifies it, keeps
only the `git` program (on Windows also the DLLs it loads) under
`<data root>/cache/agent-state-dugite.engine/`, and deletes the archive. The kept copy is 3.4–7.1
MiB. Until it is in place, and on any host where it cannot be, the built-in engine records
versions; the server log says which engine is in use and why.

Nothing is downloaded when the harness is built or installed: `pnpm install` does not run dugite's
own postinstall (`pnpm-workspace.yaml`), and the packaged plugin carries no binary.

| Platform | Download | Kept |
| --- | --- | --- |
| Linux x64 / arm64 / arm / x86 (glibc 2.34 or later, with zlib; the amd64 and arm64 Docker images included) | 64.4 / 24.1 / 27.0 / 26.5 MiB | 4.1 / 4.0 / 3.6 / 4.9 MiB |
| macOS x64 / arm64 | 64.3 / 60.6 MiB | 3.7 / 3.4 MiB |
| Windows x64 / arm64 / x86 | 44.8 / 42.3 / 45.8 MiB | 6.4 / 5.9 / 7.1 MiB |
| Linux on musl (Alpine), other architectures, the BSDs | none: the built-in engine records versions | |

Two of dugite's own knobs apply:

- `LOCAL_GIT_DIRECTORY` names a Git in dugite's layout to use as it is, with nothing downloaded.
- `DUGITE_CACHE_DIR` names a directory that may already hold the verified archive, for a host with
  no route to GitHub.

Git is GPL-2.0; it is downloaded from dugite-native's releases on the host that runs it, and this
package redistributes none of it.

## Install

It ships with the harness build. On the Plugins page, an administrator installs it on the server:
the App re-assembles itself, no restart. Written by hand, it is a row of a Project's
`.project_config.toml`:

```toml
[plugins]
"@penguinharness/agent-state-dugite" = "*"
```

## Development

```bash
pnpm --filter @penguinharness/agent-state-dugite test    # fetches the Git into node_modules/.cache once
pnpm --filter @penguinharness/agent-state-dugite bench   # the two engines, step by step
```

The tests run the server's own Agent State suite with this engine, and check that it writes the
very commits the built-in engine writes. Where the host cannot get the Git they skip, unless
`PENGUIN_MUST_RUN` names `agent-state-dugite` (CI does).

## License

Apache-2.0.
