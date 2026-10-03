/**
 * @penguinharness/example-hello-page — the smallest plugin that adds a page to the web app.
 *
 * It ships no browser code to the app: the page is DATA on the server's `WebModule.pages` slot
 * (the server's http/routes/contributions.ts), which the app reads from GET /api/contributions.
 * The page sits under the Evaluation Center (`parent: "benchmark"`) and is drawn by an `iframe`
 * renderer whose document is this package's own `ui/index.html`, served by the server's
 * GET /api/plugins/<package>/ui/* once the plugin is loaded.
 */
import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/** Where the server serves this package's `ui/` (the package name, as package.json spells it). */
const UI = "/api/plugins/@penguinharness/example-hello-page/ui";

/** The plugin's one module: nothing to bind, only the page it contributes. */
@Component({
  contributes: {
    "WebModule.pages": [
      {
        id: "example-hello-page.page",
        key: "example-hello",
        path: "/example-hello",
        nav: "main",
        admin: false,
        parent: "benchmark",
        title: "Hello World",
        titleZh: "你好世界",
        icon: "sparkle",
        renderer: { iframe: { src: `${UI}/index.html`, namespace: "example-hello" } },
      },
    ],
  },
})
export class HelloPage {}

const plugin: Plugin = { modules: [HelloPage] };
export default plugin;
