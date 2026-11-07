/**
 * GET /api/plugins/<package>/ui/* — a file an installed plugin ships in its `ui/` directory: the
 * document an `iframe` renderer of its web contributions names (contributions.ts), and whatever
 * that document loads beside it.
 *
 * Only a plugin this process has LOADED is served — an entry of the plugin host, whichever
 * Project asked for it, since there is one module tree and what it contributes is visible to
 * all of them. Its package is the directory of the nearest `package.json` above its resolved
 * entry file (a name resolved from a prefix, or a dev checkout's path alike), and it is named
 * here by that manifest's `name`, so a plugin can write its own frame's `src` before anyone
 * knows how it will be installed. Any other name answers 404, as does a path that leaves the
 * package's `ui/` (http/static-files.ts).
 *
 * Like a workflow's `ui/*`, it is a plain authenticated route: the frame is same-origin and
 * carries the user's cookie, which is what lets the app theme it (lib/workflow-theme.ts in web).
 *
 * Caching is the SPA's contract (http/static-files.ts): `no-cache` with a validator, and
 * `immutable` when the request carries `?v=<stamp>` and that stamp is still the package's own —
 * the URL a document gets from contributions.ts. Everything a plugin's document loads beside
 * itself is then cached for good, while an edit under `ui/` moves the stamp and with it the URL.
 */
import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { Hmr } from "../../hmr/capabilities.js";
import { pluginHostFrom } from "../../plugin/host.js";
import { PACKAGE_NAME } from "../../plugin/loader.js";
import { PLUGIN_UI_DIR, packageNamed, uiStampOf } from "../../plugin/package.js";
import { HttpError } from "../errors.js";
import { containedFile, uiFileResponse } from "../static-files.js";

export interface PluginUiRouteDeps {
  /** The entry file of every plugin this process runs (null for one the installation resolved by bare name). */
  loadedEntries: () => Iterable<string | null | undefined>;
}

const notFound = () =>
  new HttpError(404, "not_found", "No such file in an installed plugin's ui/.");

export function pluginUiRoutes(deps: PluginUiRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const serve = async (c: Context<AppEnv>, name: string) => {
    if (!PACKAGE_NAME.test(name)) throw notFound();
    const pkg = packageNamed(deps.loadedEntries(), name);
    if (pkg === null) throw notFound();
    const raw = c.req.path.split(`/${name}/${PLUGIN_UI_DIR}/`)[1] ?? "";
    let rel: string;
    try {
      rel = decodeURIComponent(raw);
    } catch {
      throw notFound();
    }
    const file = await containedFile(path.join(pkg.dir, PLUGIN_UI_DIR), rel);
    if (file === null) throw notFound();
    // Versioned and current: the browser may keep it forever. Anything else revalidates.
    const v = c.req.query("v");
    return uiFileResponse(c, file, { immutable: v !== undefined && v === uiStampOf(pkg.dir) });
  };
  app.get("/:scope{@[^/]+}/:name/ui/*", (c) =>
    serve(c, `${c.req.param("scope")}/${c.req.param("name")}`),
  );
  app.get("/:name/ui/*", (c) => serve(c, c.req.param("name")));
  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PluginUiRoutes.routes",
        prefix: "/api/plugins",
        auth: "user",
        // Beside the library group on the same prefix; their patterns never overlap.
        order: 68,
      },
    ],
  },
})
export class PluginUiRoutes {
  @Use() private readonly hmr!: Hmr;
  @Bind("PluginUiRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    const hmr = this.hmr;
    this.routes = pluginUiRoutes({
      // Claimed per call rather than captured: the host belongs to the process, and a hot
      // swap hands the same one to the next platform.
      loadedEntries: () => [...pluginHostFrom(hmr.resources).entries().values()].map((e) => e.file),
    });
  }
}
