# Code plugins reach the server through one face, and contribute WebSocket endpoints, own-origin routes and owned prefs keys

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `server`

[中文版](2026-11-19-plugin-server-seams.zh.md)

The server gained the generic seams a code plugin needs to serve what the agent browser serves today. The browser code stayed in `packages/server/src/builtin-browser/`, and it now reaches the host only through them. Routes, status codes, WebSocket close codes and error messages did not change.

## Details

- **The plugin face.** `@prismshadow/penguin-server/plugin` now exports more than the interfaces it carried before:
  - the capability interfaces a plugin module `@Use`s, as types: `Channels`, `Clock`, `Config`, `Db`, `Desktop`, `Log`, `Paths`, `Users`, `SessionDrivers`, `SessionIndex`, `Settings` and `UiPrefsStore`;
  - the types `AppEnv`, `ShellPort`, `WebSocketUpgrade` and `OwnedPref`;
  - the values `HttpError`, `errorBody`, `badRequest`, `publicOriginOf`, `requireHuman`, `userChannelKey`, `ensureInstallId`, `shellPortOf` and `profileFromEnv`.

  `requireHuman` and `userChannelKey` moved into modules of their own, and their old import paths re-export them.
- **HttpError across copies.** `HttpError` carries the global brand `Symbol.for("penguin.http-error")`. The App's error handler and the error log recognise any copy that carries it, such as the one a plugin bundles. Such an error is answered with its own status, code, message, details and `Retry-After`, and is logged as expected. An unbranded error that only calls itself `HttpError` is still answered 500 `internal`.
- **Own-origin route groups.** A `HttpModule.routes` group may declare `origin: "own"`. The same-origin rule for writes then does not apply to the paths it covers, because the group judges its callers' origin itself. A path belongs to the most specific group that covers it. This replaced the hard-coded exemption for the extension's pairing route, which now declares the field. The runtime's own copy of the check, in front of the seam, asks the current generation through `Http.ownOrigin`.
- **WebSocket endpoints.** The new slot `HttpModule.upgrades` takes a `{ prefix }` and a code half. The code half receives the raw upgrade and owns the handshake. The runtime attaches one upgrade seam per listener (`hmr/upgrade-seam.ts`) and hands each upgrade to the current generation through `Http.upgrade`. It never offers its own terminal-stream and API-socket paths. The browser's extension socket is now such an endpoint. A path below `/api/builtin-browser/extension/ws` is now answered 404; no listener answered it before.
- **Owned prefs keys.** The new data slot `MeRoutes.ownedPrefs` takes a `{ key, message }`. `PUT /api/me/prefs` refuses a write that names the key with 400 `bad_request` and that message, and stores nothing of it. The browser's refusal of `browserBackend` moved into this slot.
- **Older platforms.** A runtime can restore a platform pushed before these seams. For such a platform, the runtime still finds the extension's gate by the names `BuiltinBrowserModule` / `BrowserExtensionGate`, and still exempts the pairing route by its path (`hmr/legacy-browser.ts`). The browser module keeps both names for installed runtimes that only do that lookup. Both fallbacks stay until 1.0.
- **Tests.** The shell-port fake every desktop suite uses moved to `test/helpers/fake-shell-port.ts`. Test apps take any node double through a generic `nodes` option, and the browser's shell-port double sits beside the browser tests.
