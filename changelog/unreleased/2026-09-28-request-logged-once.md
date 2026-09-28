# Each request is logged once

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `server`

[中文版](2026-09-28-request-logged-once.zh.md)

The server log printed every HTTP request as two lines. A static file showed up as `GET /penguin-logo.svg 404 0ms` followed by `GET /penguin-logo.svg 200 4ms`, even though the browser only ever received the 200. It was one request, logged by both of the apps it passes through. The platform app logged first: for a static file that line recorded the platform declining a path it does not serve, not a response anyone got. The runtime app logged second, with the status the client actually received.

- Only the runtime app now writes the line for an HTTP request, so every request is one line carrying the status the client got. Calls over the API socket never pass through the runtime app, so they still get one line from the platform.
- A test counts the lines each kind of request leaves (a static file, a revalidated one, the SPA entry, an API route answering an error or success, a socket call) and requires exactly one.
