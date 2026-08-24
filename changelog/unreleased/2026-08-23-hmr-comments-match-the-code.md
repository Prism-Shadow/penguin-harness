# The runtime's comments say what the runtime does

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `server`

[中文版](2026-08-23-hmr-comments-match-the-code.zh.md)

Four passages in the hot-update runtime described something other than the code around them.
A reader with no session transcript could not have resolved them, and two of them would have
sent that reader the wrong way.

## Details

- The HTTP seam's module doc, and `hmr/README.md` with it, stated that streaming responses
  stay runtime-side. The platform's own SSE endpoints go through the seam and always have —
  a handler returns its `Response` as soon as the stream exists and keeps writing to it. What
  the seam cannot carry is a live socket, there being no `Response` to return for one, which
  is why the terminal WebSocket handshake reaches the App through in-process members. Both
  passages now say that.
- `app.ts` described the hot APIs as authenticating with "a local-agent Bearer token OR admin
  cookie session", pointing at `hot/routes.ts`. That token was removed for being a plaintext
  admin-equivalent secret on disk, and the path named no file.
- Three JSDoc blocks documented the declaration below their neighbour rather than their own:
  `UpgradeAllTarget`'s sat above `UpgradeAssets`, `persistVersion`'s above
  `materializeAssets`, and `isSafeRelPath`'s above `sameFileContent` — leaving three
  declarations undocumented and three carrying two blocks each. Each is back on the
  declaration it describes.
- The store's keep rule read "at most `STORE_KEEP` versions"; the referenced version is kept
  on top of the newest `STORE_KEEP`, so a store holds three entries whenever the committed
  version is not among the two most recently written.
