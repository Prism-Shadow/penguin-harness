/**
 * The Hono ↔ seam bridge, shared by every platform-side Hono app (terminal routes,
 * the business app).
 *
 * The seam contract is `Request → Response | null` (hmr/http-seam.ts): null declines the
 * request to whatever is next in line. A Hono router already distinguishes "no route
 * matched" (its notFound handler) from "a route matched and answered" — so a platform app
 * declares decline by returning {@link declined} from notFound, and {@link seamHttp}
 * translates that marker to null.
 *
 * The marker is a header rather than a bare 404 on purpose: a real 404 from a matched
 * route ("no such terminal", "no such session") is the platform's own answer and must
 * reach the caller as-is — never fall through to some older handler behind the seam with
 * different semantics.
 */

const DECLINE_HEADER = "x-penguin-platform-decline";
/**
 * Random per boot, compared by VALUE in seamHttp. The header name is guessable, and this
 * adapter is meant for every platform-side app — including ones that might one day copy
 * response headers from an upstream. A fixed marker would let that upstream inject the
 * header and silently decline the platform's own answer into whatever older handler sits
 * behind the seam; a value nothing outside this module instance knows cannot be forged.
 */
const DECLINE_TOKEN = crypto.randomUUID();

/** The marked response a platform app's notFound returns to decline the request. */
export function declined(): Response {
  return new Response(null, { status: 404, headers: { [DECLINE_HEADER]: DECLINE_TOKEN } });
}

/** Bridges a Hono app (structurally: anything fetch-shaped) onto the seam contract. */
export function seamHttp(app: {
  fetch: (request: Request) => Response | Promise<Response>;
}): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const response = await app.fetch(request);
    return response.headers.get(DECLINE_HEADER) === DECLINE_TOKEN ? null : response;
  };
}
