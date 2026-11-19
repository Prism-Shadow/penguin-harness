# Code plugins reach the server through one face, and contribute WebSocket endpoints, own-origin routes and owned prefs keys

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#1644](https://github.com/Prism-Shadow/penguin-harness/pull/1644)

[中文版](2026-11-19-plugin-server-seams.zh.md)

The server gained the generic seams a code plugin needs to serve what the agent browser serves today. The browser code stayed in `packages/server/src/builtin-browser/`, and it now reaches the host only through them. Routes, status codes, WebSocket close codes and error messages did not change.

## Details

- **The plugin face.** `@prismshadow/penguin-server/plugin` now exports more than the interfaces it carried before:
  - the capability interfaces a plugin module `@Use`s, as types: `Channels`, `Clock`, `Config`, `Db`, `Desktop`, `Log`, `Paths`, `Users`, `SessionDrivers`, `SessionIndex`, `Settings` and `UiPrefsStore`;
  - the types `AppEnv`, `ShellPort`, `WebSocketUpgrade`, `UpgradeCaller`, `MeRoutes`, `MeRoutesSlots` and `OwnedPref`;
  - the values `HttpError`, `isHttpError`, `errorBody`, `badRequest`, `publicOriginOf`, `requireHuman`, `userChannelKey`, `ensureInstallId`, `shellPortOf` and `profileFromEnv`.

  `requireHuman` and `userChannelKey` moved into modules of their own, and their old import paths re-export them.
- **HttpError across copies.** `HttpError` carries the global brand `Symbol.for("penguin.http-error")`. The App's error handler and the error log recognise any copy that carries it, such as the one a plugin bundles. Such an error is answered with its own status, code, message, details and `Retry-After`, and is logged as expected. An unbranded error that only calls itself `HttpError` is still answered 500 `internal`.
- **Route groups built with another copy of Hono.** A builtin plugin bundles its own Hono, whose default error handler would answer every error `500 text/plain` before the App's handler saw it. When such a group set no error handler of its own, the host now gives it one that hands the error on. A handler the group did set is left alone.
- **Own-origin route groups.** A `HttpModule.routes` group may declare `origin: "own"`: it judges its callers' origin itself. Such groups are mounted ahead of the same-origin rule for writes, each behind its own copy of the JSON-only one. A request one of them answers never meets the same-origin check, and anything else under its prefix still does, such as another method or a path it does not serve. This replaced the hard-coded exemption for the extension's pairing route, which now declares the field. As a result, a cross-origin write under that prefix that the pairing route does not answer, such as a `DELETE`, is refused 403 `cross_origin_write`. The runtime's own copy of the check, in front of the seam, lets such writes through to the platform: it asks the current generation through `Http.ownOrigin`, and prefixes match segment by segment, `:param` segments included.
- **WebSocket endpoints.** The new slot `HttpModule.upgrades` takes `{ prefix, auth }` and a code half. The code half receives the raw upgrade and owns the handshake.
  - Prefixes match segment by segment, and a `:name` segment matches any one segment. An endpoint whose prefix uses another Hono pattern is not served, and is named in the log.
  - With `auth: "user"`, the host first checks the handshake's Origin and `Sec-Fetch-Site` (403) and the session cookie (401), as it does for the API socket. The endpoint then gets the user. With `auth: "none"`, the endpoint gets the bare request and checks the Origin and its own credential itself.
  - The runtime attaches one upgrade seam per listener (`hmr/upgrade-seam.ts`, `platformUpgradeDeps`) and hands each upgrade to the current generation through `Http.upgrade`. It never offers its own terminal-stream and API-socket paths.
  - The browser's extension socket is now an `auth: "none"` endpoint. A path below `/api/builtin-browser/extension/ws` is now answered 404; no listener answered it before.
- **Owned prefs keys.** The new data slot `MeRoutes.ownedPrefs` takes a `{ key, message }`. `PUT /api/me/prefs` refuses a write that names the key with 400 `bad_request` and that message, and stores nothing of it. The browser's refusal of `browserBackend` moved into this slot.
- **Older platforms and runtimes.** The fallbacks that keep the extension working across a runtime and a platform from either side of this change are recorded in [backward compatibility](2026-11-19-backward-compatibility.md).
- **Tests.** The shell-port fake every desktop suite uses moved to `test/helpers/fake-shell-port.ts`. A second-copy-of-Hono helper is in `test/helpers/foreign-hono.ts`. Test apps take any node double through a generic `nodes` option, and the browser's shell-port double sits beside the browser tests.
