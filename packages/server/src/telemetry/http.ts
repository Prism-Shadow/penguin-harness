/**
 * Telemetry's http.request (PRFC-0008): one sample per request this App answers — how long,
 * the route by its registered pattern, the status, the request body's size and the response's
 * when it declares one. Each request gets an id in the scope, so the samples recorded while it
 * runs (a session.messages, its trace.read) carry it too.
 *
 * The telemetry routes themselves are not sampled: reading the buffer would add to it, and
 * clearing it would leave the clear behind.
 *
 * It only reads what the response already says. Wrapping a body to count it, or setting a
 * header after the handler, turns @hono/node-server's lightweight response into a real stream
 * and costs every request more than this whole sample does.
 */
import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Telemetry } from "../mechanisms/telemetry.js";
import { isDeclined } from "../hmr/hono-seam.js";

const TELEMETRY_ROUTES = "/api/telemetry";

export function telemetryRequests(telemetry: Telemetry): MiddlewareHandler {
  return async (c, next) => {
    if (!telemetry.on()) return next();
    const path = c.req.path;
    if (path === TELEMETRY_ROUTES || path.startsWith(`${TELEMETRY_ROUTES}/`)) return next();
    const request = randomUUID();
    const start = performance.now();
    await telemetry.within({ request }, () => next());
    const res = c.res;
    // Left to the static tail behind the seam: not an answer of this surface.
    if (isDeclined(res)) return;
    const requestLength = Number(c.req.header("content-length"));
    const responseLength = res.headers.get("content-length");
    const session = (c.req.param() as Record<string, string | undefined>).sessionId;
    telemetry.record({
      probe: "http.request",
      durMs: performance.now() - start,
      ...(responseLength !== null ? { bytes: Number(responseLength) } : {}),
      status: res.status >= 500 ? "error" : "ok",
      keys: { request, ...(session !== undefined ? { session } : {}) },
      attrs: {
        method: c.req.method,
        // The registered pattern, never the path: ids and query values stay out.
        route: c.req.routePath,
        code: res.status,
        ...(Number.isFinite(requestLength) ? { requestBytes: requestLength } : {}),
      },
    });
  };
}
