# Routes ship by push, not by rebuild

The runtime no longer owns the route table. It mounts one seam ahead of its own routes: the
running platform gets first refusal on every request and answers `null` for the ones it does not
own, so a pushed platform can add an endpoint, replace an existing one, or serve something else
entirely — with no rebuild and no redeploy.

## Why this was needed

`POST /api/hmr/platform/call` already made platform *methods* callable without a runtime change,
but a method is not a route: it has no path, no verb, no status code and no headers, and every
client would have had to speak that RPC instead of the API it already speaks. Anything shaped
like an HTTP endpoint therefore still cost a rebuild of every installation — which is exactly
what the hot channel exists to avoid. The symptom that made it concrete: a web bundle pushed with
new `/api/auth/*` endpoints met a server that had never heard of them, and the feature simply
404'd until the whole runtime was redeployed.

## The boundaries

- **`/api/hmr/*` is never offered to the platform.** It is the channel a broken platform gets
  replaced through; a push that could claim it would be able to lock an installation out for good.
- **A platform that throws does not fall through.** It claimed the request by throwing rather than
  declining, and quietly running the runtime's older handler would answer with semantics the
  caller was never promised — so the error surfaces as a 500.
- **A platform without an `http` handler changes nothing.** Every installation starts in that
  state, and bundles pushed before the seam existed stay in it.

Streaming responses (SSE, long downloads) stay runtime-side for now: the handler returns a whole
Response.
