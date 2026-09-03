/**
 * Install-identity route: `GET /api/install -> { installId }`.
 *
 * PUBLIC (no login required), and that is a requirement rather than a convenience: the web
 * app compares this id against the one in `localStorage` before React mounts, which is
 * before it knows whether anyone is signed in — and the case this whole mechanism exists
 * for, a wiped data root, is precisely the case where nobody is. See install-id.ts for why
 * publishing the id discloses nothing.
 *
 * Mounted in the PLATFORM, above its auth gate (app.ts's createApp). A hot push carries
 * platform + cli + web dist as one version and never the runtime, so putting the route where
 * the platform is puts it where the web bundle that calls it is: the two can never arrive on
 * an installation separately. The data root is still the runtime's — `deps.config.root` comes
 * from the claimed capabilities either way — so ownership of the FILE and ownership of the
 * route are simply different questions.
 *
 * The id is read per request rather than captured at boot. It is one small file and the
 * request happens once per page load, and reading it live is what makes the answer follow
 * the root: a root deleted out from under a running server reports a NEW id on the next
 * load instead of a remembered one, so the browser sweeps without waiting for a restart.
 */
import { Hono } from "hono";
import type { InstallResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ServerConfig } from "../../config.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface InstallRouteDeps {
  config: ServerConfig;
}
import { ensureInstallId } from "../../install-id.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Config } from "../../hmr/capabilities.js";
import { RuntimeModule } from "../../hmr/capabilities.js";

export function installRoutes(deps: InstallRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    return c.json({ installId: ensureInstallId(deps.config.root) } satisfies InstallResponse);
  });

  return app;
}

/**
 * The data root's install identity, public (auth: none): the web app compares it against
 * localStorage before React mounts, before anyone is signed in. Mounted in the PLATFORM
 * because a push carries platform + web dist together, so the route and its caller move as one.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "InstallRoutes.routes",
        prefix: "/api/install",
        auth: "none",
        order: 5,
      },
    ],
  },
})
export class InstallRoutes {
  @Use(RuntimeModule) private readonly config!: Config;
  @Bind("InstallRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = installRoutes({ config: this.config });
  }
}
