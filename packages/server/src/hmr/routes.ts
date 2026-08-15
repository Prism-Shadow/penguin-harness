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
import type { ShellProcResource } from "./resources.js";

/** Bind addresses considered safe by default; anything else needs HTTPS or the explicit override. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function hmrRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const hmr = deps.hmr;
  // Mounted BEFORE the global cookie-auth middleware (see app.ts): this gate
  // does its own two-credential auth so local tools can call in with the
  // file-permission-gated Bearer token instead of a browser session.
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
    // Local credential: the per-boot token from $PENGUIN_HOME/hmr/api.json.
    if (c.req.header("authorization") === `Bearer ${hmr.apiToken}`) {
      return gated();
    }
    // Browser credential: the standard cookie session, admins only.
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

  // -- Web platform (the frontend package's built dist) ---------------------

  /**
   * Hot-swap the served web assets and tell every connected client to reload.
   * - { files } — THE PRIMARY PATH: a { relPath: base64 } manifest sent
   *   INLINE in the request body (persisted; survives a restart).
   * - { distPath } — same-machine dev convenience (served, not persisted).
   */
  routes.post("/web/upgrade", async (c) => {
    const body = await c.req.json<{
      files?: Record<string, string>;
      distPath?: string;
      source?: Json;
    }>();
    let info;
    try {
      if (body.files !== undefined) {
        info = await deps.hmr.installInlineWebDist(body.files);
      } else if (typeof body.distPath === "string") {
        info = deps.hmr.setWebDist(body.distPath);
      } else {
        throw new Error("provide `files` (inline manifest) or `distPath`");
      }
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
    }
    // Live clients (browser tabs AND the desktop window — both sit on the
    // user event stream) reload to pick up the new assets.
    deps.channels.broadcast("user:", { type: "web_updated", rev: info.rev }, "server_event");
    return c.json({ status: "ok", ...info, source: body.source ?? null });
  });

  // -- Terminals (the live-state proof: they survive platform swaps) --------

  routes.post("/terminals", async (c) => {
    const body = await c.req.json<{ command?: string; cwd?: string }>();
    const inst = await hmr.ensure();
    const created = await inst.api.createTerminal(
      body.command ?? "cat",
      body.cwd ?? deps.config.root,
    );
    return c.json(created, 201);
  });

  routes.get("/terminals", async (c) => {
    const inst = await hmr.ensure();
    const terminals = inst.api.terminals();
    return c.json({
      terminals: terminals.keys().map((id) => {
        const t = terminals.get(id)!;
        return { id, alive: t.alive(), lost: t.lost() };
      }),
    });
  });

  routes.get("/terminals/:id", async (c) => {
    const inst = await hmr.ensure();
    const t = inst.api.terminals().get(c.req.param("id"));
    if (t === undefined) throw new HttpError(404, "not_found", "No such terminal.");
    return c.json({ output: t.read(), alive: t.alive(), lost: t.lost() });
  });

  routes.post("/terminals/:id/input", async (c) => {
    const body = await c.req.json<{ data: string }>();
    const inst = await hmr.ensure();
    const t = inst.api.terminals().get(c.req.param("id"));
    if (t === undefined) throw new HttpError(404, "not_found", "No such terminal.");
    t.write(body.data);
    return c.json({ ok: true });
  });

  routes.delete("/terminals/:id", async (c) => {
    const id = c.req.param("id");
    const inst = await hmr.ensure();
    const terminals = inst.api.terminals();
    const t = terminals.get(id);
    if (t === undefined) throw new HttpError(404, "not_found", "No such terminal.");
    // Closing a terminal is user intent to end the process: kill and release
    // the runtime resource, then remove the node.
    const procId = (t.park() as { procId?: string }).procId;
    if (procId !== undefined) {
      hmr.resources.claim<ShellProcResource>(procId)?.kill();
      hmr.resources.release(procId);
    }
    terminals.remove(id);
    return c.json({ ok: true });
  });

  return routes;
}
