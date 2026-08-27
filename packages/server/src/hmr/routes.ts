/**
 * /api/hmr/*: the hot-update surface.
 *
 * The gate middleware is the runtime half of the stop-the-world protocol:
 * requests arriving during a swap are ENQUEUED on the host's operation queue
 * (awaiting waitIdle), never rejected — a client only ever observes latency,
 * not the freeze. The routes are runtime code: they orchestrate through the
 * platform api, so they survive impl swaps unchanged.
 *
 * RUNTIME LAYER — MECHANISM ONLY (see ./README.md). A new business API must NOT
 * become a route here. It is served by the platform itself, through the HTTP
 * seam (../hmr/http-seam.ts) that offers every request to the booted platform
 * before the runtime's own routes see it — a real route with its own path,
 * verb and status, rather than an RPC envelope clients would have to learn.
 *
 * What remains here is the upgrade channel and the status it needs, which is
 * the one thing the platform is never offered: it is how a broken platform
 * gets replaced.
 */
import zlib from "node:zlib";
import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { authMiddleware } from "../auth/middleware.js";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";

/** Bind addresses considered safe by default; anything else needs HTTPS. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function hmrRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const hmr = deps.hmr;
  // Mounted BEFORE the global cookie-auth middleware (see app.ts): this gate
  // does its own auth (admin cookie only — see the network gate above for the
  // other half) rather than relying on the generic middleware being mounted
  // later.
  const cookieAuth = authMiddleware(deps.authService, deps.config.trustProxy);

  routes.use("*", async (c, next) => {
    // Dangerous-network off: hot APIs load and run code, so on a non-loopback
    // bind (e.g. 0.0.0.0) without HTTPS they answer 403. There is no override
    // via the request itself — see the header note below.
    if (!LOOPBACK_HOSTS.has(deps.config.host.toLowerCase())) {
      // `x-forwarded-proto` is caller-supplied and UNTRUSTED by default: anyone who can
      // reach this bind at all can set it to `https` and walk straight through this gate
      // while actually speaking plaintext HTTP (the gate exists precisely for the case
      // where the caller is not a trusted party). Only a request's own URL scheme (real
      // TLS terminated by this process) counts unless the deployment explicitly says a
      // reverse proxy is in front and strips/overwrites the header itself
      // (PENGUIN_TRUST_PROXY=1 / config.trustProxy) — the same opt-in a real proxy setup
      // requires anyway.
      const proto = deps.config.trustProxy
        ? (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", ""))
        : new URL(c.req.url).protocol.replace(":", "");
      if (proto !== "https") {
        throw new HttpError(
          403,
          "hmr_disabled",
          "Hot platform APIs are disabled on a non-loopback bind without HTTPS. " +
            "Serve over HTTPS to enable them.",
        );
      }
    }
    const gated = async (): Promise<void> => {
      // The upgrade endpoint enqueues internally; everything else waits out
      // any in-flight swap here (unobservable freeze: latency, not errors).
      if (!c.req.path.endsWith("/upgrade")) await hmr.waitIdle();
      await next();
    };
    // Admin credential required. An earlier per-boot Bearer token published to
    // $PENGUIN_HOME/hmr/api.json was removed over the on-disk-plaintext objection
    // (readable by any process of the same OS user, agent shells included, and
    // admin-equivalent). That objection has since been deliberately reversed as a
    // product decision, harness-wide: agents driving their own server through the
    // CLI is the feature, and local filesystem access to the data root is defined
    // as admin authority (exactly the reset-admin-password rule). The mechanism now
    // lives at the general auth layer instead of here: the per-boot local API token
    // at <root>/api-token (auth/api-token.ts), which authMiddleware — reused below —
    // accepts as `Authorization: Bearer` and authenticates as the admin. A local
    // caller may therefore present either that token or an admin cookie session.
    return cookieAuth(c, async () => {
      if (!c.get("user").isAdmin) {
        throw new HttpError(403, "forbidden", "Hot platform APIs are admin-only.");
      }
      await gated();
    });
  });

  /**
   * THE ONE upgrade endpoint: platform + cli + web move together, atomically —
   * there is no route that updates any of the three alone (see host.ts's module
   * doc). Content-Type application/gzip or application/octet-stream; the raw body
   * is gzip(JSON.stringify({ platform, cli, web: { files }, source? })):
   * - `platform` — the platform's single-file JS ESM source, inline (works over
   *   HTTP alone, remote runtimes included); it must export `hotPlatform`.
   * - `cli` — the CLI's own single-file JS ESM source, inline, a SEPARATE
   *   artifact from `platform`; the server never imports or runs it, only
   *   content-addresses it into the store for packages/cli's own loader.
   * - `web.files` — a { relPath: base64 } manifest of the built web dist.
   * - `source?` — optional provenance (repo + revision), recorded but not run.
   * The server boots the platform AND installs the web dist in memory first;
   * only once BOTH succeed does it persist the version — platform, cli, and web
   * together (one atomic harness.json rename — see host.ts's persistVersion). A
   * boot failure or a bad web manifest leaves the previously committed version
   * untouched.
   */
  routes.post("/upgrade", async (c) => {
    const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (contentType !== "application/gzip" && contentType !== "application/octet-stream") {
      throw new HttpError(
        400,
        "bad_request",
        "expected a gzip(JSON.stringify({ platform, cli, web })) body " +
          "(Content-Type application/gzip or application/octet-stream)",
      );
    }
    let payload: {
      platform?: string;
      cli?: string;
      web?: { files?: Record<string, string> };
      assets?: { files?: Record<string, string>; exec?: string[] };
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
    if (typeof payload.platform !== "string") {
      throw new HttpError(400, "bad_request", "payload has no `platform` (string)");
    }
    if (typeof payload.cli !== "string") {
      throw new HttpError(400, "bad_request", "payload has no `cli` (string)");
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
        platform: payload.platform,
        cli: payload.cli,
        web: payload.web.files,
        // Optional: a push that needs no real files on disk (no native module, no helper
        // binary) simply omits it, and older pushers keep working unchanged.
        ...(payload.assets?.files
          ? {
              assets: {
                files: payload.assets.files,
                ...(payload.assets.exec ? { exec: payload.assets.exec } : {}),
              },
            }
          : {}),
        // Provenance is optional and, unlike the bundles, now outlives the request in
        // harness.json — so it is accepted only fully formed. A half-filled or
        // wrong-typed `source` is dropped rather than committed: readers already
        // tolerate its absence, and a malformed record on disk would outlive the push
        // that produced it.
        ...(typeof payload.source?.repo === "string" &&
        typeof payload.source.revision === "string" &&
        payload.source.repo.length > 0 &&
        payload.source.revision.length > 0
          ? { source: { repo: payload.source.repo, revision: payload.source.revision } }
          : {}),
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

  return routes;
}
