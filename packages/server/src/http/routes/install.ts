/**
 * Install-identity route: `GET /api/install -> { installId }`.
 *
 * PUBLIC (no login required), and that is a requirement rather than a convenience: the web
 * app compares this id against the one in `localStorage` before React mounts, which is
 * before it knows whether anyone is signed in — and the case this whole mechanism exists
 * for, a wiped data root, is precisely the case where nobody is. See install-id.ts for why
 * publishing the id discloses nothing.
 *
 * Mounted in the RUNTIME shell, above the platform seam, because the data root belongs to
 * the runtime: a hot-pushed platform of any version answers this the same way, and cannot
 * take the answer over.
 *
 * The id is read per request rather than captured at boot. It is one small file and the
 * request happens once per page load, and reading it live is what makes the answer follow
 * the root: a root deleted out from under a running server reports a NEW id on the next
 * load instead of a remembered one, so the browser sweeps without waiting for a restart.
 */
import { Hono } from "hono";
import type { InstallResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { ensureInstallId } from "../../install-id.js";

export function installRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    return c.json({ installId: ensureInstallId(deps.config.root) } satisfies InstallResponse);
  });

  return app;
}
