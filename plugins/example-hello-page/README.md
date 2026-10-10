# Example: a Hello World page

The smallest plugin that adds a page to the PenguinHarness web app. It demonstrates:

- **A page as data.** The plugin's one module contributes to the server's `WebModule.pages`
  slot; the web app reads it from `GET /api/contributions`. No browser code is loaded into the
  app.
- **A page under another page.** `parent: "benchmark"` puts the row indented under the
  Evaluation Center in the sidebar. A page whose parent is absent is shown nowhere; pages nest
  one level only.
- **A page the plugin ships.** The `iframe` renderer points at
  `/api/plugins/@penguinharness/example-hello-page/ui/index.html`, which the server serves from
  this package's `ui/` directory once the plugin is loaded. The page has a button; clicking it
  shows "Hello World". It is styled only with the theme tokens the app copies into the frame,
  so it follows light/dark mode and the accent colour.

The package is private, so it is not published, and it is not shipped with the builtin plugins
(`scripts/build-plugins.mjs` skips the `plugins/example-*` directories), so no install offers it.

## Enable it

A plugin is loaded by its package name only, from the host's plugin prefix — and a local
directory reaches that prefix by being linked in. Build the package first (`dist/` and
`ifaces.json` are build products, not tracked), then "Enable a local plugin" on the server's
Plugins page (an admin operation) names the built directory; the server links it, lists the
package for the Project and re-assembles itself around it — one step, nothing edited by hand:

```sh
pnpm --filter @penguinharness/example-hello-page build
```

The link is recorded — where the directory is, who linked it, when — the plugin's row shows it,
and the row's "Unlink" undoes it in one step. The same operation as a route, for a host without
the web app: `POST /api/projects/:projectId/plugins/installed/local` with
`{ "path": "<the built directory>" }` (admin).

What a Project lists is loaded for the whole server, so every user sees the page. Reload the web
app after enabling it: the app reads contributions once per sign-in. The web e2e suite takes the
other route to the same prefix — it stages the examples into the builtin one
(`PENGUIN_PLUGIN_EXAMPLES=1`, see `packages/web/e2e/run.sh`) — because its throwaway data root has
nothing a link's record should outlive.
