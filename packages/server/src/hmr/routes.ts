/**
 * /api/hmr/*: the hot-update surface.
 *
 * The gate middleware is the runtime half of the stop-the-world protocol:
 * requests arriving during a swap are ENQUEUED on the host's operation queue
 * (awaiting waitIdle), never rejected — a client only ever observes latency,
 * not the freeze. The routes are runtime code: they orchestrate through the
 * platform api, so they survive impl swaps unchanged.
 */
import zlib from "node:zlib";
import { Hono } from "hono";
import type { Json } from "@prismshadow/penguin-core/kernel";
import { ifaceData } from "@prismshadow/penguin-core/kernel";
import type { AppDeps } from "../app.js";
import { authMiddleware } from "../auth/middleware.js";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";

/** Bind addresses considered safe by default; anything else needs HTTPS or the explicit override. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function hmrRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const hmr = deps.hmr;
  // Mounted BEFORE the global cookie-auth middleware (see app.ts): this gate
  // does its own auth (admin cookie only — see the network gate above for the
  // other half) rather than relying on the generic middleware being mounted
  // later.
  const cookieAuth = authMiddleware(deps.authService);

  routes.use("*", async (c, next) => {
    // Dangerous-network default-off: hot APIs load and run code, so on a
    // non-loopback bind (e.g. 0.0.0.0) without HTTPS they answer 403 unless
    // explicitly overridden (PENGUIN_HMR_API_UNSAFE=1).
    if (!LOOPBACK_HOSTS.has(deps.config.host.toLowerCase())) {
      const proto =
        c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
      if (proto !== "https" && process.env.PENGUIN_HMR_API_UNSAFE !== "1") {
        throw new HttpError(
          403,
          "hmr_disabled",
          "Hot platform APIs are disabled on a non-loopback bind without HTTPS. " +
            "Serve over HTTPS or set PENGUIN_HMR_API_UNSAFE=1 to override.",
        );
      }
    }
    const gated = async (): Promise<void> => {
      // The upgrade endpoint enqueues internally; everything else waits out
      // any in-flight swap here (unobservable freeze: latency, not errors).
      if (!c.req.path.endsWith("/upgrade")) await hmr.waitIdle();
      await next();
    };
    // Admin cookie session only. There used to be a second credential here — a
    // per-boot Bearer token published to $PENGUIN_HOME/hmr/api.json — for local
    // tools to call in without a browser session. It was removed: it ran as
    // plaintext on disk, readable by anything running as the same OS user
    // (including an agent's own shell/exec tools, which inherit that user and
    // PENGUIN_HOME), and it was admin-equivalent — making it the single
    // plaintext admin-equivalent secret on disk, i.e. the vulnerability itself.
    // Session tokens and passwords are hashed at rest (auth/service.ts); a local
    // caller now authenticates the same way an operator does: log in with the
    // admin password and present the resulting cookie.
    return cookieAuth(c, async () => {
      if (!c.get("user").isAdmin) {
        throw new HttpError(403, "forbidden", "Hot platform APIs are admin-only.");
      }
      await gated();
    });
  });

  // -- Platform ------------------------------------------------------------

  routes.get("/platform", async (c) => {
    const inst = await hmr.ensure();
    return c.json({
      impl: hmr.currentImplId(),
      iface: ifaceData(inst.iface),
      info: inst.api.info(),
    });
  });

  /** Observability: the current parked document (what an upgrade would carry). */
  routes.get("/platform/park", async (c) => {
    const inst = await hmr.ensure();
    return c.json(inst.park());
  });

  /**
   * THE ONE upgrade endpoint: platform + cli + web move together, atomically —
   * there is no route that updates any of the three alone (see host.ts's module
   * doc). Content-Type application/gzip or application/octet-stream; the raw body
   * is gzip(JSON.stringify({ bundle, web: { files }, source? })):
   * - `bundle` — the single-file JS ESM source, inline (works over HTTP alone,
   *   remote runtimes included); it must export both `hotPlatform` and `cli`.
   * - `web.files` — a { relPath: base64 } manifest of the built web dist.
   * - `source?` — optional provenance (repo + revision), recorded but not run.
   * The server boots the platform AND installs the web dist in memory first;
   * only once BOTH succeed does it persist the version (one atomic harness.json
   * rename — see host.ts's persistVersion). A boot failure or a bad web manifest
   * leaves the previously committed version untouched.
   */
  routes.post("/upgrade", async (c) => {
    const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (contentType !== "application/gzip" && contentType !== "application/octet-stream") {
      throw new HttpError(
        400,
        "bad_request",
        "expected a gzip(JSON.stringify({ bundle, web })) body " +
          "(Content-Type application/gzip or application/octet-stream)",
      );
    }
    let payload: {
      bundle?: string;
      web?: { files?: Record<string, string> };
      source?: { repo: string; revision: string };
    };
    try {
      const gz = Buffer.from(await c.req.arrayBuffer());
      payload = JSON.parse(zlib.gunzipSync(gz).toString("utf8"));
    } catch (err) {
      throw new HttpError(
        400,
        "bad_request",
        `invalid gzip upgrade payload: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (typeof payload.bundle !== "string") {
      throw new HttpError(400, "bad_request", "payload has no `bundle` (string)");
    }
    if (typeof payload.web?.files !== "object" || payload.web.files === null) {
      throw new HttpError(
        400,
        "bad_request",
        "payload has no `web.files` (a { relPath: base64 } map)",
      );
    }
    let outcome;
    try {
      outcome = await hmr.upgradeAll({
        bundle: payload.bundle,
        web: payload.web.files,
        ...(payload.source ? { source: payload.source } : {}),
      });
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
    }
    // Live clients (browser tabs AND the desktop window) reload to pick up the
    // new web assets once a version actually lands.
    if (outcome.status === "ok") {
      deps.channels.broadcast(
        "user:",
        { type: "web_updated", rev: outcome.web.rev },
        "server_event",
      );
    }
    // Blocked is a first-class outcome, not an HTTP error: the body carries
    // status + the dropped/missing/invalid paths (input for the upper
    // upgrade-ladder rungs), so clients keep one parsing path.
    return c.json(outcome);
  });

  /**
   * Generic method dispatch: the runtime stays mechanism-only and never
   * grows a route per business API. The allow-list is inst.iface.methods —
   * data read off the currently booted platform, not a compiled-in list —
   * so a bundle pushed via /platform/upgrade adds or removes callable
   * methods immediately, with no runtime change: the new API is callable
   * the moment it boots, and a removed one 404s the moment it's gone.
   */
  routes.post("/platform/call", async (c) => {
    const body = await c.req.json<{ method?: string; args?: Json[] }>();
    if (typeof body.method !== "string") {
      throw new HttpError(400, "bad_request", "provide `method` (string)");
    }
    if (body.args !== undefined && !Array.isArray(body.args)) {
      throw new HttpError(400, "bad_request", "`args` must be an array");
    }
    const inst = await hmr.ensure();
    if (!inst.iface.methods.includes(body.method)) {
      throw new HttpError(
        404,
        "method_not_found",
        `No method '${body.method}' on the current platform.`,
      );
    }
    const fn = (inst.api as unknown as Record<string, unknown>)[body.method];
    if (typeof fn !== "function") {
      // Unreachable given boot()'s method-set check, but never trust a
      // dynamic call site over the type system.
      throw new HttpError(
        404,
        "method_not_found",
        `No method '${body.method}' on the current platform.`,
      );
    }
    let result: unknown;
    try {
      result = await (fn as (...args: unknown[]) => unknown).apply(inst.api, body.args ?? []);
    } catch (err) {
      throw new HttpError(500, "call_failed", err instanceof Error ? err.message : String(err));
    }
    let json: Json;
    try {
      json = toJson(result);
    } catch (err) {
      throw new HttpError(
        422,
        "unserializable_result",
        err instanceof Error ? err.message : String(err),
      );
    }
    return c.json({ ok: true, result: json });
  });

  return routes;
}

/**
 * JSON.stringify's own notion of "not representable" (function, symbol, a
 * cycle) surfaces as a thrown error, not a silent `undefined` — with one
 * carve-out: a void return (undefined) is a SUCCESSFUL call with no result
 * and maps to null, since the side effect already happened and reporting an
 * error would misread it.
 */
function toJson(value: unknown): Json {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  if (text === undefined) {
    throw new Error("result is not JSON-serializable (a function or a symbol)");
  }
  return JSON.parse(text) as Json;
}
