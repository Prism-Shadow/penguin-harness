# Desktop: a dev run coexists with an installed release build

An unpackaged (source) desktop shell — `pnpm desktop`, or `pnpm --dir packages/desktop start` — now takes a dev-suffixed identity, so hacking on the desktop app no longer collides with a running installed build (#292).

- Dev runs set the app name to `PenguinHarness-Dev`, which gives them their own userData directory — and with it their own Chromium profile, `preferred-port` / `server-port` state, and Electron single-instance lock. Previously the lock path was shared with the installed build, so a dev launch while the release app was running quit immediately into the release instance's window (and vice versa).
- The data root now defaults to `~/.penguin/dev-data` inside the shell itself when unpackaged; before, only the root `pnpm desktop` script set it, and a bare `pnpm --dir packages/desktop start` would find the release install's `server.lock` on `~/.penguin/data` and attach the dev window to the running RELEASE server (or spawn its own server over the release's data). An explicit `PENGUIN_HOME` still wins in both forms.
- Windows dev runs stamp a dev-suffixed AppUserModelID (`com.prismshadow.penguinharness.dev`) instead of claiming the installed app's taskbar/toast identity.
- Ports never needed a knob: the embedded server keeps its `PORT=0` allocator with per-userData stickiness, so the split userData directories give each instance its own stable port. Auto-update and the CLI-install offer already stood down on unpackaged runs.
- Release builds are byte-for-byte unchanged in behavior: same name, AppUserModelID, userData, and shared CLI data root; a new unit test pins the release identity to electron-builder.yml's `productName`/`appId` (previously a comment-only contract).
