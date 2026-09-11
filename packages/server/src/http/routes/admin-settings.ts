/**
 * Admin server-settings routes (admin only, 403 for non-admins):
 * GET|PUT /api/admin/settings — the server-global settings stored in server_settings:
 * the proxy settings (the "application uses the proxy" and "agent environment uses the
 * proxy" switches and their shared explicit address) and the upload limits (the
 * per-file and per-message attachment caps, in whole MB).
 * A PUT applies immediately: everything is validated first (a rejected request writes
 * nothing), then the persisted values are written, then the process dispatcher is
 * rebuilt so new outbound connections follow the change without a restart (the agent
 * switch needs no push — the command-subprocess policy getter re-reads the repo at
 * every spawn). The upload limits need no push either, for the same reason: the
 * attachment validators and the request body cap both read the repo per request.
 *
 * GET /api/admin/settings/proxy-probe names the model provider hosts the reachability probe
 * would request; POST .../proxy-probe/:provider measures one of them — unauthenticated, see
 * services/proxy-probe.ts.
 */
import { Hono } from "hono";
import type {
  ProxyProbeResponse,
  ProxyProbeTargetsResponse,
  ServerSettingsResponse,
} from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import { optionalBoolean, readJson } from "../validate.js";
import type { AppDeps } from "../../app.js";
import { applyProxySettings, normalizeProxyUrl } from "../../net/proxy.js";
import { MAX_ATTACHMENT_MB, MIN_ATTACHMENT_MB } from "../../services/attachment-limits.js";
import {
  PROXY_PROBE_TARGETS,
  probeProxyReachabilityOf,
  proxyProbeTarget,
} from "../../services/proxy-probe.js";

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
    "proxyUrl must be a proxy URL undici supports — http(s)://host[:port] or socks5://host[:port] — or bare host[:port] (empty or null clears it).",
  );
}

/**
 * An attachment limit update value -> stored whole-MB integer. Everything outside the supported
 * range is refused with one dedicated code the Web App renders under the field — the range is the
 * point of the setting (an admin typing 100GB must be told no, not obeyed), so the failure has to
 * be legible rather than a generic `bad_request`.
 */
function parseAttachmentMb(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= MIN_ATTACHMENT_MB && value <= MAX_ATTACHMENT_MB) return value;
  }
  throw new HttpError(
    400,
    "invalid_attachment_limit",
    `${field} must be a whole number of MB between ${MIN_ATTACHMENT_MB} and ${MAX_ATTACHMENT_MB}.`,
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
      ...deps.serverSettingsRepo.getAttachmentLimitsMb(),
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
    const attachmentMaxMb =
      body.attachmentMaxMb === undefined
        ? undefined
        : parseAttachmentMb(body.attachmentMaxMb, "attachmentMaxMb");
    const attachmentTotalMb =
      body.attachmentTotalMb === undefined
        ? undefined
        : parseAttachmentMb(body.attachmentTotalMb, "attachmentTotalMb");
    // The pair is only meaningful together, so the relation is checked against the EFFECTIVE
    // post-write values: a PUT that raises only the per-file cap must be refused when the stored
    // total would leave a legal single attachment unsendable, and one that lowers only the total
    // must be refused for the same reason. Checked before any write, like every other field.
    const stored = deps.serverSettingsRepo.getAttachmentLimitsMb();
    const effectiveMax = attachmentMaxMb ?? stored.attachmentMaxMb;
    const effectiveTotal = attachmentTotalMb ?? stored.attachmentTotalMb;
    if (effectiveTotal < effectiveMax) {
      throw new HttpError(
        400,
        "invalid_attachment_limit",
        `attachmentTotalMb (${effectiveTotal}) must not be below attachmentMaxMb (${effectiveMax}).`,
      );
    }
    if (proxyForApp !== undefined) deps.serverSettingsRepo.setProxyForApp(proxyForApp);
    if (proxyForAgent !== undefined) deps.serverSettingsRepo.setProxyForAgent(proxyForAgent);
    if (proxyUrlProvided) deps.serverSettingsRepo.setProxyUrl(proxyUrl);
    if (attachmentMaxMb !== undefined) deps.serverSettingsRepo.setAttachmentMaxMb(attachmentMaxMb);
    if (attachmentTotalMb !== undefined) {
      deps.serverSettingsRepo.setAttachmentTotalMb(attachmentTotalMb);
    }
    // Mirror the app switch + address into the process: rebuilds the global fetch
    // dispatcher (live change, no restart; a no-op when nothing effectively changed).
    // Through the claimed capability, not a direct import: this route runs inside the
    // platform bundle, whose own copy of net/proxy.js drives a dispatcher that
    // globalThis.fetch never routes through (see AppDeps.proxyControl).
    deps.proxyControl({
      proxyForApp: deps.serverSettingsRepo.getProxyForApp(),
      proxyUrl: deps.serverSettingsRepo.getProxyUrl(),
    });
    return c.json(settings());
  });

  // What the probe would request, without requesting it: the page lists the targets — name
  // and exact URL — before anyone presses the button, so the list is served rather than
  // copied into the frontend, where a second copy could drift from what is really fetched.
  app.get("/proxy-probe", (c) =>
    c.json({ targets: [...PROXY_PROBE_TARGETS] } satisfies ProxyProbeTargetsResponse),
  );

  // Reachability and latency of the server's outbound path to ONE provider host, named by a
  // path segment matched against the fixed target list. Admin-only through the router's guard
  // above, like every other route here.
  //
  // Takes no request body and no URL: the only thing a caller supplies is a provider id, and
  // an id that is not in the list is a 404 rather than a fetch. Nothing is written, but it
  // does reach the network, so it is a POST rather than a GET.
  //
  // One target per call because the page renders each answer as it arrives; the concurrency
  // is the browser's, and a host that black-holes connections holds up only its own row.
  // The path measured is whatever the process dispatcher currently is, which follows the
  // STORED settings — a PUT is what moves it, which is why the page puts this below Save.
  app.post("/proxy-probe/:provider", async (c) => {
    const target = proxyProbeTarget(c.req.param("provider"));
    if (target === null) {
      throw new HttpError(404, "probe_target_not_found", "No probe target with that provider id.");
    }
    // Plain global fetch on purpose — that is the undici fetch the startup entry installed,
    // and it resolves the proxy dispatcher per call. No credential is attached anywhere
    // below, including from the process environment (see services/proxy-probe.ts).
    const probe = await probeProxyReachabilityOf(target);
    return c.json({ probe } satisfies ProxyProbeResponse);
  });

  return app;
}
