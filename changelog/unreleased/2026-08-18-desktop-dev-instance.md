# Desktop: a dev run coexists with an installed release build

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `desktop`, `docs`
- **PR:** [#318](https://github.com/Prism-Shadow/penguin-harness/pull/318)
- **Issue:** [#292](https://github.com/Prism-Shadow/penguin-harness/issues/292)

[中文版](2026-08-18-desktop-dev-instance.zh.md)

An unpackaged (source) desktop shell — `pnpm desktop`, or `pnpm --dir packages/desktop start` — took a dev-suffixed app identity and its own data root, so hacking on the desktop app stopped colliding with a running installed build.

## The dev instance

- Dev runs set the app name to `PenguinHarness-Dev`, which gives them their own userData directory, and with it their own Chromium profile, `preferred-port` / `server-port` state, Electron single-instance lock and — since Electron derives these from userData — their own `logs`, `sessionData` and `crashDumps` paths. Under the shared lock a dev launch had quit immediately into the running release instance's window, and vice versa; dev runs had also shared, and overwritten the port memory in, the installed app's Chromium profile.
- The data root defaults to `~/.penguin/dev-data` inside the shell itself when unpackaged, rather than only under the root `pnpm desktop` script: a bare `pnpm --dir packages/desktop start` had found the release install's `server.lock` on `~/.penguin/data` and attached the dev window to the running release server, or spawned its own server over the release's data. An explicit `PENGUIN_HOME` still wins in both forms.
- Windows dev runs stamp a dev-suffixed AppUserModelID (`com.prismshadow.penguinharness.dev`) instead of claiming the installed app's taskbar and toast identity.
- Crash and startup-failure dialogs title themselves with `app.name` rather than the hard-coded release name, so a failing dev run is attributable when both instances are up.
- Every unpackaged launch prints the pair it picked: `[shell] dev instance '<name>' on data root <root>`.
- Ports needed no new knob: the embedded server kept its `PORT=0` allocator with per-userData stickiness, so the split userData directories give each instance its own stable port. Auto-update and the CLI-install offer already stood down on unpackaged runs.

## Release builds

Release behavior is unchanged — same name, AppUserModelID, userData directory and shared CLI data root. Two unit tests were added to hold that: one pins the release identity to electron-builder.yml's `productName` and `appId`, previously a comment-only contract; the other pins the data-root precedence rule (explicit `PENGUIN_HOME` first, then the CLI root when packaged and the dev root when not), which had lived untestable inside the Electron-importing entry file.

## Compatibility

Contributors take a one-time move, documented in CONTRIBUTING.md and the installation docs. A bare `pnpm --dir packages/desktop start` had run on `~/.penguin/data`, so sessions made that way are not in the dev window — pass `PENGUIN_HOME=~/.penguin/data` to work against the release root deliberately. And because userData moved with the app name, the dev window's origin-scoped preferences and its remembered port start fresh once. The dev identity is one fixed name rather than one per checkout, so two working copies still share an instance lock.
