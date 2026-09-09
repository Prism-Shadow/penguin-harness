# Verification detail

Loaded on demand from `SKILL.md`, which carries the decision itself — the table of what to run
for what you changed. This file is what that decision leans on when something goes sideways:
the known flakes, the two ways a test proves nothing, the CI-polling traps, and how to run a
suite on another machine when the user asks for that.

## Known platform failures that are not your diff

`ci-windows` runs the same chain minus `format:check`, plus `scripts/test-installer.ps1`. Two
failures there are known: a bare `Failed` worker crash, and an `environment.test.ts`
truncation-timing assertion — rerun before debugging. An `EBUSY` on removing a directory that is
some child process's cwd is real, not a flake.

The local server suite drops a few tests under full parallel load — they time out and pass on
their own. Rerun the file alone before blaming the diff.

## Two ways a test proves nothing

**A fake that is kinder than the real thing hides the bug it was written for.** Transports are
faked at a seam here — `createSocket`, `createClient`, a stubbed `globalThis.fetch` — and the
half that drifts is the failure contract, not the happy path. A fake that hands back a fresh
cursor where the adapter returns the one it was given, or that resolves where production parks,
passes a test whose subject is exactly that path. Write the fake's failure branches from the
adapter's, not from what the assertions need.

**A structural assertion that was already true at the base commit is not a test.** Reading source
text in a test is house style here (20 web test files do it), which makes it easy to assert a
shape the file already had. Replay each new assertion against `git show <base>:<path>` and keep
the ones that fail there.

## Reading CI without fooling yourself

**On a conflicting PR, waiting for CI is waiting for nothing.** The workflows run against the
merge commit GitHub builds from the branch and `main`, and it does not build one while the two
conflict — the checks never start, so polling `statusCheckRollup` returns the same pending or
empty list forever. Read the state before the checks: `gh pr view <n> --json
mergeable,mergeStateStatus` answers `CONFLICTING` / `DIRTY`. Merge `origin/main` into the branch,
resolve, push, and only then expect checks.

**A queued run registers no checks at all**, so "every check is non-pending" is trivially true in
the seconds after a PR opens, and a rollup holding two unrelated fast checks reads as a green
matrix. Poll the run, not the checks — `gh run list --branch <branch> --workflow CI --limit 1
--json status,conclusion,databaseId` — and treat `queued` / `in_progress` as not done. Sanity-check
the check count against a sibling PR before calling anything green.

Two more things that pass silently and are worth checking in the same pass: an auto-merged file is
not a correct file, so read the merged result where two PRs touched one region; and a test constant
pinned to a count the other PR changed fails for a reason that has nothing to do with either change
— derive the count instead of re-pinning it.

**A piped command reports the pipe's exit code.** `pnpm … | tail` succeeds when the build fails.
Check a real artifact, or set `pipefail`, before believing a piped run.

## Running the suite somewhere other than this machine

**Default: run tests here.** Move them to another machine only when the user asks for that in so
many words. A remote run is not a silent optimisation — it changes which environment the result
describes, and a green run elsewhere is not evidence about here unless that was the point.

When asked, `.agents/scripts/remote-test.sh` does the round trip:

```sh
.agents/scripts/remote-test.sh <worktree> [--build "<pkg> <pkg>"] -- <pnpm args>
```

It reads the destination from `PENGUIN_TEST_HOST` — an ssh alias or `user@host`, whatever the
caller's ssh config already resolves — and hard-codes none: the address belongs to the person
running it, not to this repo. It rsyncs sources (`node_modules`, `dist` and `.git` stay behind),
installs with the frozen lockfile, optionally builds, then runs pnpm there.

Four things that each cost a round trip if you assume them away:

- **A non-login ssh shell loads neither a version manager nor corepack.** `ssh <host> node -v` can
  report a Node below this repo's `>=24` engine while the intended one sits under a version
  manager. Source the environment inside the remote command rather than trusting PATH.
- **Resolve the remote home; never spell it.** rsync does not expand `$HOME` in a remote
  destination, and a `~` inside double quotes is not expanded by the remote shell either — both
  silently create a directory named after the variable.
- **Build what the suite reads a `dist` of**, not just core. `SKILL.md`'s table says which; a
  suite importing another package's subpath exports fails to resolve them otherwise.
- **The synced tree may need `git init`.** One core test resolves the checkout root beside
  `pnpm-workspace.yaml`, and a worktree's `.git` is a pointer file, so syncing it verbatim leaves
  a dangling gitdir.

**A difference between the two machines is a finding, not noise.** A suite that passes here and
fails there has usually caught a real environment assumption — a locale-dependent sort, a
filesystem or Node-version difference. Report it and fix the assumption. Pinning the remote
environment to make it green is the same mistake as a fake kinder than the real thing.
