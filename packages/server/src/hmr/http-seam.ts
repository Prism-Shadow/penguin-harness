/**
 * The platform's HTTP seam — the one place the runtime hands a request over.
 *
 * Without this, the route table is a runtime asset: adding or fixing an endpoint means
 * rebuilding and redeploying every installation, which is exactly what the hot channel exists
 * to avoid. The RPC dispatch route that used to stand in for this (`/api/hmr/platform/call`,
 * removed with the seam) only made METHODS pushable; a method is not a route — no path, no
 * verb, no status, no headers — and every client would have had to speak that envelope instead
 * of the API it already speaks.
 *
 * So: the running platform gets first refusal on every request, and answers `null` for the ones
 * it does not own. A pushed platform can therefore add a route, replace one, or serve something
 * entirely different, with no runtime change at all.
 *
 * Two boundaries make that safe:
 *
 * - **`/api/hmr/*` is never offered.** It is the channel a broken platform is replaced through;
 *   if a push could claim it, one bad push would lock the installation out permanently.
 * - **A platform that throws does not fall through.** It claimed the request by throwing rather
 *   than declining, and quietly running the runtime's older handler instead would answer with
 *   different semantics than the caller was promised. The error surfaces as a 500.
 *
 * Streaming responses (SSE, long downloads) stay runtime-side for now: the handler returns a
 * whole Response, which is enough for the request/response API surface and keeps the contract
 * one function wide.
 */
import type { MiddlewareHandler } from "hono";
import type { HmrHost } from "./host.js";

/** Prefix the runtime keeps for itself, whatever the platform says. */
const RESERVED_PREFIX = "/api/hmr";

/**
 * A platform that wants to serve HTTP exposes this. Optional on purpose: a platform pushed
 * before the seam existed simply has no `http`, and everything falls through to the runtime's
 * own routes, so old bundles keep working.
 *
 * Deliberately NOT in the iface's `methods` list: that list is the allow-list for the JSON-RPC
 * dispatch route, and a Request/Response pair is not Json. This is an in-process call on the
 * booted implementation object, like `terminals()`.
 */
export interface PlatformHttp {
  http?(request: Request): Promise<Response | null> | Response | null;
}

/**
 * Offers each request to the running platform before the runtime's own routes see it.
 * `hmr.ensure()` returns the already-booted instance after the first call, so this costs a
 * property read per request once the platform is up.
 */
export function platformHttpSeam(hmr: HmrHost): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path.startsWith(RESERVED_PREFIX)) return next();
    // Wait out any in-flight swap FIRST, same as /api/hmr/*'s own gate (routes.ts): the
    // kernel's upgrade() disposes the old tree before it awaits the new one's boot, and for
    // that whole window `hmr.ensure()` still resolves synchronously to the OLD instance —
    // it only reassigns once the swap is done. Without this wait, a request landing in that
    // window would be handed to an already-disposed tree instead of observing the freeze as
    // latency (see host.ts's module doc: "a client never observes the stop-the-world
    // window").
    await hmr.waitIdle();
    let handler: PlatformHttp["http"];
    try {
      const instance = await hmr.ensure();
      handler = (instance.api as PlatformHttp).http?.bind(instance.api);
    } catch {
      // The platform cannot boot: the runtime's own routes are the fallback, and the
      // upgrade channel above is still reachable to push a working one.
      return next();
    }
    if (!handler) return next();

    let response: Response | null;
    try {
      response = await handler(c.req.raw);
    } catch (err) {
      return c.json(
        {
          error: {
            code: "platform_error",
            message: `The platform failed to handle ${c.req.method} ${c.req.path}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        },
        500,
      );
    }
    if (response === null) return next();
    return response;
  };
}
