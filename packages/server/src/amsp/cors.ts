/**
 * The Agent API's CORS rule: a preflight is always answered; `Access-Control-Allow-Origin: *`
 * goes only on requests that carry `Authorization`. A keyless request gets no CORS header, so a
 * page on another origin cannot drive an open Agent from a visitor's browser (on a loopback
 * server, the drive-by that keyless access would otherwise invite).
 *
 * The public group runs it first (routes.ts). The host layer (src/app.ts) and `HttpModule` also
 * run the header half ahead of their `/api/*` body cap and JSON-only-writes guard, whose 413 and
 * 415 answer before the group is reached: without it, a browser caller would read those refusals
 * as a CORS failure.
 */
import type { MiddlewareHandler } from "hono";

/** Where the public group is mounted; the wire version is in the path. */
export const AMSP_PREFIX = "/api/amsp/v1";

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
};

/**
 * `Access-Control-Allow-Origin: *` on a request that carries `Authorization`, set before the
 * rest of the chain runs, so a streamed response and an error answer carry it too.
 */
export const amspAllowOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.header("authorization") !== undefined) c.header("Access-Control-Allow-Origin", "*");
  await next();
};

/** The whole rule, as the group runs it: the preflight answered here, every other request headed. */
export const amspCors: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") return c.body(null, 204, PREFLIGHT_HEADERS);
  return amspAllowOrigin(c, next);
};
