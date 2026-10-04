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

A plugin is loaded by its package name only, from the bundled plugin directory a build stages.
Stage the examples into it with the builtin plugins, then list the package in a Project's
`.project_config.toml` and restart the server:

```sh
PENGUIN_PLUGIN_EXAMPLES=1 node scripts/build-plugins.mjs --out packages/server/plugins
```

```toml
[plugins]
"@penguinharness/example-hello-page" = "*"
```

What a Project lists is loaded for the whole server, so every user sees the page. Reload the web
app after enabling it: the app reads contributions once per sign-in. The web e2e suite enables
it this way (`packages/web/e2e/run.sh`).
