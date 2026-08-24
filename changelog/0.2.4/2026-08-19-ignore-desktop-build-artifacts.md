# Desktop packaging artifacts are ignored on every branch

- **Date:** 2026-08-19
- **Type:** process
- **Scope:** `desktop`
- **PR:** [#331](https://github.com/Prism-Shadow/penguin-harness/pull/331)

[中文版](2026-08-19-ignore-desktop-build-artifacts.zh.md)

`packages/desktop/.gitignore` now names every path a desktop packaging run writes — `bin/`, `out/`, `skills/` and `stage/` — so a run leaves nothing untracked behind on any branch.

## Details

- `bin/` holds the generated `penguin` / `penguin.cmd` launchers, `out/` is electron-builder output, `skills/` is a copy of `packages/skills/skills`, which is tracked at its source, and `stage/` is the assembled app directory on branches that stage before packing.
- The scripts that write those paths do not exist on every branch, and each branch's `.gitignore` covered only what its own scripts produce. The artifacts outlive a branch switch, so a working copy on any other branch held them untracked and unignored — 340 MB of unpacked application one `git add -A` away from a commit.
