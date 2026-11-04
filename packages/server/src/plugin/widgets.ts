/**
 * GET /api/plugins/<package>/state — the stored state of one loaded plugin package; PATCH
 * merges an update into it. The companion surface of the web widget slot (contributions.ts):
 * a widget's iframe document reads its state here with the user's cookie, and a plugin's CLI
 * commands (cli-commands.ts) reach the same document through the same routes, so every face
 * of a plugin sees one state.
 *
 * The server keeps the document WHOLE and never reads inside it — the shape is the package's
 * own (pet-state.ts shapes the pet's, as the first user). It is stored in the server's shared
 * settings store (the Settings mechanism, key `plugin-state:<package>`), so it survives a
 * restart and is visible to every Project. Only a plugin this process has LOADED has state:
 * any other well-formed package name answers 404, as an unknown ui/ file does (plugin-ui.ts).
 *
 * A PATCH body must be a JSON object; it is merged SHALLOW over the stored document (a
 * `null` value drops its key), and the merged document comes back — one request reads what
 * it wrote. Any signed-in user may read and write: the state is the plugin's own surface,
 * gated by the plugin being installed, not by the document's contents.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { Hmr } from "../hmr/capabilities.js";
import { pluginHostFrom } from "./host.js";
import { PACKAGE_NAME } from "./loader.js";
import type { Settings } from "../mechanisms/settings.js";
import { HttpError } from "../http/errors.js";
import { readJson } from "../http/validate.js";
import { mergeState } from "./pet-state.js";

const stateKey = (pkg: string) => `plugin-state:${pkg}`;

export interface PluginStateRouteDeps {
  settings: Settings;
  /** The package name of every plugin this process has loaded (null entries skipped). */
  loadedPackages: () => Iterable<string>;
}

export function pluginStateRoutes(deps: PluginStateRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const requireLoaded = (c: Context<AppEnv>, name: string) => {
    if (!PACKAGE_NAME.test(name)) {
      throw new HttpError(404, "not_found", "No such installed plugin.");
    }
    if (![...deps.loadedPackages()].includes(name)) {
      throw new HttpError(404, "not_found", "No such installed plugin.");
    }
    return name;
  };

  const read = (pkg: string): unknown => {
    const raw = deps.settings.get(stateKey(pkg));
    if (raw === null) return {};
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // A stored document this server cannot parse reads as empty; a PATCH overwrites it.
      return {};
    }
  };

  const serve = (c: Context<AppEnv>, name: string) => {
    const pkg = requireLoaded(c, name);
    return c.json({ package: pkg, state: read(pkg) });
  };

  app.get("/:scope{@[^/]+}/:name/state", (c) =>
    serve(c, `${c.req.param("scope")}/${c.req.param("name")}`),
  );
  app.get("/:name/state", (c) => serve(c, c.req.param("name")));

  const patch = async (c: Context<AppEnv>, name: string) => {
    const pkg = requireLoaded(c, name);
    const body = await readJson(c);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new HttpError(400, "bad_request", "The state update must be a JSON object.");
    }
    const next = mergeState(read(pkg), body as Record<string, unknown>);
    deps.settings.set(stateKey(pkg), JSON.stringify(next));
    return c.json({ package: pkg, state: next });
  };

  app.patch("/:scope{@[^/]+}/:name/state", (c) =>
    patch(c, `${c.req.param("scope")}/${c.req.param("name")}`),
  );
  app.patch("/:name/state", (c) => patch(c, c.req.param("name")));

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PluginStateRoutes.routes",
        prefix: "/api/plugins",
        auth: "user",
        // Beside the ui/ group on the same prefix; their patterns never overlap.
        order: 69,
      },
    ],
  },
})
export class PluginStateRoutes {
  @Use() private readonly settings!: Settings;
  @Use() private readonly hmr!: Hmr;
  @Bind("PluginStateRoutes.routes") routes!: Hono<AppEnv>;

  setup() {
    const hmr = this.hmr;
    this.routes = pluginStateRoutes({
      settings: this.settings,
      // Claimed per call rather than captured: the host belongs to the process, and a hot
      // swap hands the same one to the next platform.
      loadedPackages: () =>
        [...pluginHostFrom(hmr.resources).entries().values()].map((e) => e.specifier),
    });
  }
}
