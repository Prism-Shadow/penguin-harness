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
 * - **A platform that throws does not fall through.** It claimed the request by throwing rather
 *   than declining, and quietly running the runtime's older handler instead would answer with
 *   different semantics than the caller was promised. The error surfaces as a 500.
 * - **No platform at all is not a decline either.** When no generation is current the request
 *   is answered 503, not passed to the static tail: the tail would serve the SPA shell for
 *   any path, and an API call would come back 200 with an HTML body that means nothing.
 *   (The upgrade channel is the platform's own route, so a box in this state is pushed to
 *   through the previous generation's closures — see the host's recovery.)
 *
 * The contract is one function wide — Request in, whole Response out — and a streaming body
 * rides it unchanged: the platform's SSE endpoints (`/api/events`, a session's event stream)
 * hand back a Response as soon as the stream exists and go on writing to it afterwards. What
 * the seam cannot carry is a live SOCKET, because there is no Response to return for one;
 * that is why the terminal WebSocket handshake reaches the App through in-process members
 * (`terminals()`, `attachStream()`) instead.
 */
import type { MiddlewareHandler } from "hono";
import type { Hmr } from "@prismshadow/penguin-hmr";
import type { PlatformApi } from "./platform.js";
import { noPlatformResponse } from "./starting.js";

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
export function platformHttpSeam(hmr: Hmr<PlatformApi>): MiddlewareHandler {
  return async (c, next) => {
    // Which generation a request goes to — including waiting out an in-flight swap — is the
    // frozen operation `current()` (packages/hmr's main.ts); this seam only hands over.
    let handler: PlatformHttp["http"];
    try {
      const instance = await hmr.current();
      handler = (instance.api as PlatformHttp).http?.bind(instance.api);
    } catch (err) {
      // Not a decline: there is no generation to decline anything. Answering here rather
      // than falling through keeps "no platform" distinguishable from "the platform does
      // not serve this path", which is a 404 the platform itself gives.
      return noPlatformResponse(c.req.raw, err instanceof Error ? err.message : String(err));
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
