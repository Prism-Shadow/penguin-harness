# The pet plugin: a companion page, `penguin pet` commands, and its state on the server

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `plugins`

[中文版](pet-plugin-slice.zh.md)

Three new plugins under `plugins/` — the pet and its two figure drivers — built entirely on the extension points the platform already ships: a plugin page slot, the plugin command slot, and a plugin-contributed route group. Nothing outside `plugins/` changes except the plugin build's cache hashing, the landing page's plugin registry and the lockfile.

- `plugins/pet` contributes a page through `WebModule.pages`: `nav: "none"`, reachable by its URL (`/pet`), rendered as a same-origin iframe over the plugin's own `ui/` files. The page is the pet's stage — a figure driver draws her on it, she walks about it, stands where you drop her, and answers the pointer. Her speech bubble, her habits and her hunger are the page's; the dialog (a right-click on her) is the shared UI package's work, loaded on demand.
- Her state is one JSON document in the server's shared settings store, under key `plugin-state:@penguinharness/pet`. The plugin contributes its own route group — `GET /api/plugins/@penguinharness/pet/state` answers it, `PATCH` merges an update shallowly over it (`null` drops its key) and answers the merged document. The document is faceted: the persistent pet (name, fullness clamped 0–100, pantry, coins) beside the transient mood (what she is doing, her bubble). Any signed-in user may read and write — the state is gated by the plugin being installed, not by its contents.
- The same document backs the `penguin pet` commands (`feed`, `name`, `say`, `status`), contributed through `PluginCliCommandsProvider.commands` and run by the server's existing command runner (admin only, as that runner already gates). A run hands the command the locale it resolved; the state reaches it in-process, through the module's own settings-backed channel — the same merge the routes run, so the command's receipt and the page always agree.
- The pet's figure is a driver's work, behind one contract (`ui/figure/contract.ts` in the pet package): the state's `pet.figure.driver` names the plugin whose `ui/figure.js` the page imports, and the rest of that block is handed to the driver verbatim. Two drivers ship: `plugins/pet-live2d-cubism` adapts the official Cubism Web SDK (fetched on the operator's machine by a SHA-256-pinned script, never committed; the model pack is the operator's, served by the driver's own route) and `plugins/pet-live2d-coopanion` loads a Coopanion figure pack at run time from the installation the configuration names, carrying none of Coopanion's code or assets itself.
- Every browser source is TypeScript, compiled by each package's build (`ui/widget.ts` → `ui/dist/widget.js`, a driver's `ui/figure.ts` → `ui/figure.js`); the `.js` files are build products, never sources.
