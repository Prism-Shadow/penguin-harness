# Media workspaces prototype

Runnable experiment for attaching several independent media worktrees to a session,
using one managed Git repository and its shared LFS object cache. Requires Node 24+,
Git with sparse checkout, and Git LFS. No npm dependencies are needed to run it.

## Run the local demonstration

From the PenguinHarness checkout:

```sh
node packages/server/prototypes/media-workspaces/demo.mts
```

The demonstration creates a small local LFS repository and independent media
worktrees in a new temporary directory. It exercises selective downloads, shared
storage, independent edits, download failure/retry, persistence and fetching new
revisions. It prints the checks and the resulting attachment state, and retains
the scratch data for inspection. It does not access the Waterford repository.

## Use a real media repository

Run each command from the checkout. Authentication uses your existing Git/SSH setup;
an SSH credential or LFS authentication failure is reported by Git. Interactive
Git prompts are disabled. Local repository paths are also supported as remotes.

```sh
node packages/server/prototypes/media-workspaces/cli.mts init --remote git@github.com:waterfordresearchinstitute/waf-media.git
node packages/server/prototypes/media-workspaces/cli.mts create --session example --name main --folder audio/example
node packages/server/prototypes/media-workspaces/cli.mts create --session example --name alternative --folder audio/example
node packages/server/prototypes/media-workspaces/cli.mts ensure --session example --name main --folder images/example
node packages/server/prototypes/media-workspaces/cli.mts status --session example
```

Replace the example folders with folders that exist in the chosen repository.
Use repository-relative paths (`audio/...`, not the preview URL prefix `media/...`).
Repeat `--folder` to select multiple folders. Selection is folder-based and includes
descendants. Cone-mode sparse checkout also places root/ancestor files in the
working tree, but only explicitly selected folders have their LFS content fetched.
Unselected LFS files can therefore remain pointer text.

Commands print Git progress to stderr and JSON results to stdout. A returned
attachment contains the session ID, workspace name, absolute path, branch, base
commit, selected folders and readiness. Agents can use that path as their working
directory. The prototype does not automatically attach it to a production session.

## Storage and lifecycle

Default scratch storage is `~/.penguin/PROTOTYPE-media-workspaces`. Supply
`--root <directory>` on every command to use another location. Choose a new, empty
directory. An existing development checkout must not be used as the prototype root.

```text
PROTOTYPE-media-workspaces/
  PROTOTYPE-registry.json
  repository/                 # managed clone; shared Git and LFS objects
  sessions/<session>/<name>/   # independent sparse working files and branch
```

- `init` clones metadata with LFS automatic downloads disabled. Repeating it with
  the same remote and branch reuses the initialized repository.
- `create` records an attachment and prepares the selected folders. A download
  failure remains visible as `failed` in `status`.
- `ensure` expands the folder selection without shrinking it. With no `--folder`,
  it retries the current selection. Existing modified asset files are preserved.
- `refresh` fetches the source branch for future attachments. It never merges,
  rebases or resets an existing attachment.
- `status` reports current branches, local changes, remaining selected LFS pointers
  and each worktree's LFS object directory. The readiness field records the last
  preparation attempt; it is not a continuous file-health monitor.

Edits belong to the individual worktrees. Hydrated files consume disk space in
each worktree in addition to the shared cache. The prototype never commits,
pushes, deletes a worktree or prunes objects. Keep the entire scratch directory
while any attachment contains work you need. Do not move its worktrees by hand.

An exclusive lock rejects overlapping manager commands; agent file edits are not
locked. After a hard process crash, inspect the PID in `PROTOTYPE.lock` and remove
the lock only after confirming the process is no longer running. A clone/setup
failure before the registry exists requires a fresh scratch root. Download
failures after attachment creation can be retried with `ensure`.

## Prototype boundary

This runs outside the server lifecycle. Session IDs are supplied manually, and the
registry is separate from production session data. There is no desktop UI,
credential onboarding, automatic scheduling, progress percentage, cancellation,
retention policy or publication flow. Keep experiments on this prototype branch.

Type-check the prototype with the repository's installed TypeScript:

```sh
pnpm exec tsc -p packages/server/prototypes/media-workspaces/tsconfig.json
```
