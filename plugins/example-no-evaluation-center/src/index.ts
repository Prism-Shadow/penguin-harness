/**
 * @penguinharness/example-no-evaluation-center — the smallest plugin that takes a page away from
 * the web app.
 *
 * It ships no browser code to the app: the removal is DATA on the server's
 * `WebModule.pageRemovals` slot (the server's http/routes/contributions.ts), which the app reads
 * from GET /api/contributions. The app then drops the page keyed `benchmark` — the Evaluation
 * Center — with the routes under its path (one Benchmark's page, /benchmark/:benchmarkId) and the
 * pages under it (such as example-hello-page's Hello World), so it has no row in the nav and its
 * URLs lead to the chat page. Safe mode asks the server nothing, so it brings the page back.
 */
import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/** The plugin's one module: nothing to bind, only the removal it contributes. */
@Component({
  contributes: {
    "WebModule.pageRemovals": [{ id: "example-no-evaluation-center.benchmark", key: "benchmark" }],
  },
})
export class NoEvaluationCenter {}

const plugin: Plugin = { modules: [NoEvaluationCenter] };
export default plugin;
