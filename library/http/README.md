# @prismshadow/penguin-library-http

The server's HTTP vocabulary as a library package — the services+http+cli restack, step T0.

## What lives here

- `src/errors.ts` — the unified error shape: `HttpError` (what routes and services
  throw), `badRequest`, `errorBody`, `handleError` (the app-level `onError`), the
  model-credential helpers, and the `ErrorBody`/`ErrorDetails` DTOs.
- `src/app-env.ts` — the `AppEnv` Hono env type (`Variables.user`/`sessionVia`), the
  shape every route and middleware speaks; the auth middleware that fills it stays in
  the server (assembly, not vocabulary).
- `src/validate.ts` — the hand-rolled request-validation helpers: path params, id
  guards, paging, JSON body reading, string/number/enum/boolean/date field checks,
  `requireProjectDir`.
- `src/media-type.ts`, `src/json-answer.ts`, `src/json-compression.ts`,
  `src/json-validators.ts` — how JSON answers are classified, swapped, compressed
  (`Accept-Encoding`) and validated (`If-None-Match` → 304).
- `src/public-origin.ts` — the public origin read off the request (or trusted forwarded
  headers) and the origin accept rules; `src/page-csp.ts` — the Web App's
  Content-Security-Policy.
- `src/settle.ts` — the convergent wait for delete routes; `src/attribution.ts` —
  error→Project attribution for `onError`.

## What deliberately does NOT live here

The route surface and the app/static hosts (`http/app.ts`, `static-files.ts`,
`icon-response.ts`) and the SSE/event-stream adapters (`sse.ts`, `event-stream.ts`,
`socket/stream-answer.ts`) — those are the server's assembly and its socket transport,
not shared vocabulary. The session-specific validators (`parseActivityCursor`,
`optionalSessionListPagingQuery`, `listingViewOfRequest`) stay beside the Session
domain's types in the server until that slice moves.

## The dependency rule

This package depends on `@prismshadow/penguin-core`, `hono` (types), and the `auth`
and `project` packages' user/session/access types. It never imports the server:
anything here that a server file used to provide (`AppEnv`, `ErrorBody`) has moved
here, with the server re-exporting for its own import paths.
