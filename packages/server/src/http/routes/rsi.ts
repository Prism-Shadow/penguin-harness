/**
 *   GET /api/rsi   # the self-evolution catalogue this build ships: one entry per RSI toolkit
 *                  # (the plugin library's `rsi` category) and one per built-in Benchmark
 *                  # reproduction. Any logged-in user; no Project check. The draft screen's
 *                  # counts read it.
 *
 * Both lists are derived, never counted by hand: the toolkits are whatever the library files
 * under the `rsi` category, read fresh per request like GET /api/plugins, and the reproductions
 * are core's built-in Benchmarks, in their order. A number shown to the user therefore cannot
 * drift from what the build carries.
 */
import { Hono } from "hono";
import { BUILTIN_BENCHMARKS, loadPluginGroups } from "@prismshadow/penguin-core";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { RsiCatalogResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";

/** The library category the RSI toolkits are filed under. */
const RSI_CATEGORY = "rsi";

function rsiCatalog(): RsiCatalogResponse {
  const group = loadPluginGroups().find((g) => g.id === RSI_CATEGORY);
  return {
    toolkits: (group?.plugins ?? []).map((plugin) => ({
      plugin: plugin.name,
      skills: plugin.skills.map((skill) => skill.name),
      preinstall: plugin.preinstall,
    })),
    benchmarks: BUILTIN_BENCHMARKS.map((benchmark) => ({
      id: benchmark.id,
      title: benchmark.title,
    })),
  };
}

/** GET /api/rsi (any logged-in user; no Project check). */
export function rsiRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => c.json(rsiCatalog()));
  return app;
}

/** The self-evolution catalogue: deployment-global, like the plugin library it is read from. */
@Component({
  contributes: {
    "HttpModule.routes": [{ id: "RsiRoutes.catalog", prefix: "/api/rsi", auth: "user", order: 72 }],
  },
})
export class RsiRoutes {
  @Bind("RsiRoutes.catalog") routes!: Hono<AppEnv>;
  setup() {
    this.routes = rsiRoutes();
  }
}
