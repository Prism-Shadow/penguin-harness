/**
 * /api/hmr/*: the hot-update surface.
 *
 * The gate middleware is the runtime half of the stop-the-world protocol:
 * requests arriving during a swap are ENQUEUED on the host's operation queue
 * (awaiting waitIdle), never rejected — a client only ever observes latency,
 * not the freeze. The routes are runtime code: they orchestrate through the
 * platform api, so they survive impl swaps unchanged.
 */
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
      if (!c.req.path.endsWith("/platform/upgrade")) await hmr.waitIdle();
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
   * The upgrade descriptor (strictly request-driven — nothing auto-triggers):
   * - { bundle, source? } — THE PRIMARY PATH: the single-file JS bundle sent
   *   INLINE in the request body; works over HTTP alone (remote runtimes
   *   included). The server writes the bytes and loads them.
   * - { bundlePath, source? } — same-machine dev convenience.
   */
  routes.post("/platform/upgrade", async (c) => {
    const body = await c.req.json<{
      bundle?: string;
      bundlePath?: string;
      source?: { repo: string; revision: string };
    }>();
    let target;
    if (typeof body.bundle === "string") {
      const bundlePath = await hmr.writeInlineBundle(body.bundle);
      target = { bundlePath, ...(body.source ? { source: body.source } : {}) };
    } else if (typeof body.bundlePath === "string") {
      target = { bundlePath: body.bundlePath, ...(body.source ? { source: body.source } : {}) };
    } else {
      throw new HttpError(400, "bad_request", "provide `bundle` (inline bytes) or `bundlePath`");
    }
    let outcome;
    try {
      outcome = await hmr.upgradeTo(target);
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
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

  // -- Web platform (the frontend package's built dist) ---------------------

  /**
   * Hot-swap the served web assets and tell every connected client to reload.
   * - Content-Type application/gzip or application/octet-stream — THE PRIMARY
   *   PATH: the raw body is gzip(JSON.stringify({ files })), a
   *   { relPath: base64 } manifest packed into ONE artifact. Pushing a dist
   *   file-by-file serializes on the destination filesystem's per-file
   *   overhead (hundreds of small writes on a Windows/Defender-scanned disk
   *   measured well under 1MB/s); one gzip write sidesteps that entirely.
   * - { files } (JSON body) — the equivalent manifest, uncompressed; kept for
   *   older callers, persisted through the identical gzip artifact.
   * - { distPath } — same-machine dev convenience (served, not persisted).
   */
  routes.post("/web/upgrade", async (c) => {
    const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    let info: { rev: string };
    let source: Json | null = null;
    try {
      if (contentType === "application/gzip" || contentType === "application/octet-stream") {
        const gz = Buffer.from(await c.req.arrayBuffer());
        info = await deps.hmr.installGzipWebDist(gz);
      } else {
        const body = await c.req.json<{
          files?: Record<string, string>;
          distPath?: string;
          source?: Json;
        }>();
        source = body.source ?? null;
        if (body.files !== undefined) {
          info = await deps.hmr.installInlineWebDist(body.files);
        } else if (typeof body.distPath === "string") {
          info = deps.hmr.setWebDist(body.distPath);
        } else {
          throw new Error("provide `files` (inline manifest), `distPath`, or a gzip body");
        }
      }
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
    }
    // Live clients (browser tabs AND the desktop window — both sit on the
    // user event stream) reload to pick up the new assets.
    deps.channels.broadcast("user:", { type: "web_updated", rev: info.rev }, "server_event");
    return c.json({ status: "ok", ...info, source });
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
