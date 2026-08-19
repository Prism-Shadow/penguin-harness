# Desktop packaging artifacts are ignored on every branch

- **Date:** 2026-08-19
- **Type:** process
- **Scope:** `desktop`
- **PR:** [#331](https://github.com/Prism-Shadow/penguin-harness/pull/331)

[中文版](2026-08-19-ignore-desktop-build-artifacts.zh.md)

`packages/desktop/.gitignore` gained `bin/`, `out/` and `skills/` alongside the existing `stage/`, so a desktop packaging run leaves nothing untracked behind.

## Details

- `bin/` holds generated `penguin` / `penguin.cmd` launchers, `out/` is electron-builder output, and `skills/` is a copy of `packages/skills/skills`, which is tracked at its source.
- The scripts that write those paths live on the branches that introduced them, and each carried the same three rules in its own `.gitignore`. The artifacts outlive a branch switch, so a working copy on any other branch held them untracked and unignored — 340 MB of unpacked application one `git add -A` away from a commit.
