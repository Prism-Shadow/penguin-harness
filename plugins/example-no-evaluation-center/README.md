# Example: no Evaluation Center

The smallest plugin that removes a page from the PenguinHarness web app. It demonstrates:

- **A removal as data.** The plugin's one module contributes `{ key: "benchmark" }` to the
  server's `WebModule.pageRemovals` slot; the web app reads it from `GET /api/contributions`.
  No browser code is loaded into the app.
- **A page goes with what belongs to it.** The Evaluation Center loses its row in the sidebar
  and in the collapsed rail, and its route. The routes under its path go too (one Benchmark's
  page, `/benchmark/:benchmarkId`), and so do the pages under it in the nav (such as the Hello
  World row of `plugins/example-hello-page`). Opening any of those URLs leads to the chat page.
- **Some pages cannot be removed.** The chat page — where the app sends a path it has no page
  for — stays whatever a removal names, so a removal can never leave the app without a page to
  land on. The login page is not in the page table at all.

The removal reaches the app with the rest of the contributions, after the first paint: right
after a reload the Evaluation Center can show in the nav for a moment before it goes.

The package is private: it is not published and not shipped with the builtin plugins
(`scripts/build-plugins.mjs` skips private packages), so no install enables it.

## Enable it

Build it (`pnpm --filter @penguinharness/example-no-evaluation-center build`), then list its
entry file by absolute path in a Project's `.project_config.toml` and restart the server:

```toml
[plugins]
"/path/to/penguin-harness/plugins/example-no-evaluation-center/dist/index.js" = "*"
```

What a Project lists is loaded for the whole server, so every user loses the page. Reload the web
app after enabling it: the app reads contributions once per sign-in. The web e2e suite enables
it this way, on a data root of its own (`packages/web/e2e/run.sh`).

## Get the page back

- **For good:** remove the line from `.project_config.toml` and restart the server, then reload
  the web app.
- **For now:** open the app in safe mode — add `?safe` to the URL, or run "safe mode" from the
  command palette (`Ctrl+Shift+P` / `⇧⌘P`). Safe mode reads no contributions, so nothing is
  removed; leaving it removes the page again.
