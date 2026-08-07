/**
 * Admin server-settings routes (admin only, 403 for non-admins):
 * GET|PUT /api/admin/settings — the server-global settings stored in server_settings
 * (currently the proxy settings: the "application uses the proxy" and "agent
 * environment uses the proxy" switches and their shared explicit address, design
 * § "出网与系统代理").
 * A PUT applies immediately: everything is validated first (a rejected request writes
 * nothing), then the persisted values are written, then the process dispatcher is
 * rebuilt so new outbound connections follow the change without a restart (the agent
 * switch needs no push — the command-subprocess policy getter re-reads the repo at
 * every spawn).
 */
import { Hono } from "hono";
import type { ServerSettingsResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import { optionalBoolean, readJson } from "../validate.js";
import type { AppDeps } from "../../app.js";
import { applyProxySettings, normalizeProxyUrl } from "../../net/proxy.js";

/**
 * proxyUrl update value -> stored value: null and empty/whitespace-only clear the
 * address; anything else must normalize (see normalizeProxyUrl) or the whole PUT is
 * rejected with `invalid_proxy_url` — un-normalized values are never stored.
 */
function parseProxyUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    const normalized = normalizeProxyUrl(value);
    if (normalized !== null) return normalized;
  }
  throw new HttpError(
    400,
    "invalid_proxy_url",
    "proxyUrl must be http://host[:port], https://host[:port], or host[:port] (empty or null clears it).",
  );
}

export function adminSettingsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    await next();
  });

  const settings = (): ServerSettingsResponse => ({
    settings: {
      proxyForApp: deps.serverSettingsRepo.getProxyForApp(),
      proxyForAgent: deps.serverSettingsRepo.getProxyForAgent(),
      proxyUrl: deps.serverSettingsRepo.getProxyUrl(),
    },
  });

  app.get("/", (c) => c.json(settings()));

  app.put("/", async (c) => {
    const body = await readJson(c);
    // Validate every provided field before writing any: a partial PUT with one invalid
    // field must leave the others untouched too.
    const proxyForApp = optionalBoolean(body, "proxyForApp");
    const proxyForAgent = optionalBoolean(body, "proxyForAgent");
    const proxyUrlProvided = body.proxyUrl !== undefined;
    const proxyUrl = proxyUrlProvided ? parseProxyUrl(body.proxyUrl) : null;
    if (proxyForApp !== undefined) deps.serverSettingsRepo.setProxyForApp(proxyForApp);
    if (proxyForAgent !== undefined) deps.serverSettingsRepo.setProxyForAgent(proxyForAgent);
    if (proxyUrlProvided) deps.serverSettingsRepo.setProxyUrl(proxyUrl);
    // Mirror the app switch + address into the process: rebuilds the global fetch
    // dispatcher (live change, no restart; a no-op when nothing effectively changed).
    applyProxySettings({
      proxyForApp: deps.serverSettingsRepo.getProxyForApp(),
      proxyUrl: deps.serverSettingsRepo.getProxyUrl(),
    });
    return c.json(settings());
  });

  return app;
}
