# The pet plugin: a docked widget, `penguin pet` commands, and a shared plugin state

- **Date:** 2026-11-04
- **Type:** feat
- **Scope:** `web`, `server`, `plugins`

[中文版](pet-plugin-slice.zh.md)

A plugin gains a small always-visible companion surface on the web app, a `penguin` command of its own, and one JSON document of state every face of it shares.

- The server's `WebModule` gains a `widgets` slot: `{ key, title?, titleZh?, size?, renderer }`, the same shape a page's entry takes. `GET /api/contributions` answers it as `widgets`. A widget renders an `iframe` whose document is the plugin's own `ui/` file, same-origin, so it reads and writes its state with the user's own cookie.
- The web app docks the widgets beside the status bar (the app layout): one collapsed tile per widget — the title's first character when no glyph is set — clicked open into its frame, with a close control. The validated widgets ride a small store of their own (one fetch, shared; a `refresh` after a plugin is installed or removed), read the way the file renderer rules are: an entry needs a key and a renderer, an iframe needs a `src`, a `builtin` name must be in this build's registry, and the first entry of a key wins.
- The server keeps a plugin's state in its shared settings store under `plugin-state:<package>`: `GET /api/plugins/<package>/state` answers it and `PATCH` merges an update shallowly over it (`null` drops its key) and answers the merged document. Only a plugin this process has loaded has state; any other well-formed package name answers 404. Any signed-in user may read and write — the state is gated by the plugin being installed, not by its contents.
- A plugin command's code half receives a state channel beside its message bundle when the server runs it: `state.read()` and `state.merge(update)`, the same document and the same merge the routes run, in-process — a run has no HTTP client of its own.
- `plugins/pet`: the first plugin on the slice. Its widget draws a small companion that idles, walks, sits and sleeps (transform-only steps), grows hungry on idle ticks, and speaks in a bubble; its `penguin pet` commands (`feed`, `name`, `say`, `status`) look after the same state through the channel. Its document is faceted — the persistent pet (name, fullness clamped 0–100) beside the transient mood (doing, bubble) — shaped in the server's `pet-state.ts` as the slice's first user.
