# Example: no Evaluation Center

The smallest plugin that removes a page from the PenguinHarness web app. It demonstrates:

- **A removal as data.** The plugin's one module contributes `{ key: "benchmark" }` to the
  server's `WebModule.pageRemovals` slot; the web app reads it from `GET /api/contributions`.
  No browser code is loaded into the app.
- **A page goes with what belongs to it.** The Evaluation Center loses its row in the sidebar
  and in the collapsed rail, and its route. The routes under its path go too (one Benchmark's
  page, `/benchmark/:benchmarkId`), and so do the pages under it in the nav (such as the Hello
  World row of `plugins/example-hello-page`). Opening any of those URLs leads home: the chat page
  in development mode, the organizations in company mode.
- **Some pages cannot be removed.** Home — the page that answers `/` and every path the app
  has no page for — and the pages it leads to (the chat page, the organizations page) stay
  whatever a removal names, so a removal can never leave the app without a page to land on. The
  login page is not in the page table at all.

The removal reaches the app with the rest of the contributions, after the first paint: right
after a reload the Evaluation Center can show in the nav for a moment before it goes.

The package is private, so it is not published, and as a `plugins/example-*` directory it is not
shipped with the builtin plugins either (`scripts/build-plugins.mjs` skips the examples unless
`PENGUIN_PLUGIN_EXAMPLES=1`), so no install enables it.

## Enable it

A plugin is loaded by its package name only, from the host's plugin prefix — and a local
directory reaches that prefix by being linked in. Build the package first (`dist/` and
`ifaces.json` are build products, not tracked), then "Enable a local plugin" on the server's
Plugins page (an admin operation) names the built directory; the server links it, lists the
package for the Project and re-assembles itself around it — one step, nothing edited by hand:

```sh
pnpm --filter @penguinharness/example-no-evaluation-center build
```

The link is recorded — where the directory is, who linked it, when — the plugin's row shows it,
and the row's "Unlink" undoes it in one step. The same operation as a route, for a host without
the web app: `POST /api/projects/:projectId/plugins/installed/local` with
`{ "path": "<the built directory>" }` (admin).

What a Project lists is loaded for the whole server, so every user loses the page. Reload the web
app after enabling it: the app reads contributions once per sign-in. The web e2e suite takes the
other route to the same prefix — it stages the examples into the builtin one
(`PENGUIN_PLUGIN_EXAMPLES=1`, see `packages/web/e2e/run.sh`) — because its throwaway data root has
nothing a link's record should outlive.

## Get the page back

- **For good:** "Unlink" the plugin on the Plugins page — one step that removes the name from
  every Project's table and forgets the link — then reload the web app.
- **For now:** open the app in safe mode — add `?safe` to the URL, or run "safe mode" from the
  command palette (`Ctrl+Shift+P` / `⇧⌘P`). Safe mode reads no contributions, so nothing is
  removed; leaving it removes the page again.
