# Unreleased

Changes since v0.1.4. The version number is assigned at release, when this folder is renamed.

- [2026-07-27] Windows: the `win32-x64` package bundles MinGit under `git/`, so `exec_command` has a real bash even on a machine with no Git for Windows — the shell stops depending on what happens to be installed. A user's own Git for Windows still wins (its MSYS userland is the fuller one); the bundle is the floor, and PowerShell is now reached only by npm installs. GPLv2 obligations are recorded in a new root `THIRD-PARTY-NOTICES.md`. ([details](2026-07-27-windows-bundled-shell.md))

- [2026-07-27] Core and tooling: `PORT` / `HOST` and the internal CLI plumbing no longer reach commands the Agent runs, so a dev server started by `exec_command` picks its own port instead of binding the harness's; and the development backend moves to 7368, so `pnpm dev` no longer collides with an installed `penguin web` — or, quieter and worse, proxies to it. ([details](2026-07-27-harness-port-isolation.md))

- [2026-07-27] Sites: the 0.1.4 release post in both languages, with a capture script for its screenshots. ([details](2026-07-27-sites-and-blog.md))
