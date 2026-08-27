# A QQ bot can be bound by scanning a QR code

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[中文版](2026-08-27-messaging-qq-scan.zh.md)

Binding a QQ bot no longer requires copying an App ID and an App Secret out of the developer
console. The QQ binding editor now leads with a QR code: scan it in QQ, pick the bot, and the
server has the credentials. The typed fields stay below it for the cases a scan cannot reach.

## Details

- The flow is three calls against `q.qq.com`: a bind task registered under a fresh AES key, a
  URL encoded into the QR code (opened by the QQ app, never fetched by this server), and a
  poll that returns the App Secret encrypted under that key.
- **The key never leaves the server.** It is generated, held, used and dropped in
  `qq-scan.ts`; the browser is given a task handle, a URL and a status, and the credentials
  go straight into storage without passing back through it — the same rule that keeps a
  stored secret from round-tripping through the form.
- Bind tasks live in memory only, scoped to the Session that started them, bounded by count
  and by a ten-minute TTL, and consumed by the poll that resolves them: a replayed poll is a
  404, not a second bind. Cancelling — including leaving the editor — forgets the key at once.
- A completed scan **saves** the binding and stops there. Enabling the connection remains the
  separate, exclusive act it is on every channel, so a scan cannot take a bot away from
  another conversation that is holding it.
- Routes are `POST /messaging/qq/scan`, `…/scan/poll` and `…/scan/cancel`, all owner-only:
  the flow ends in a stored credential however little of it the caller types.
- The QR is generated in the browser and inlined as `<svg>`, so no third party learns the
  task handle from an image request. It is drawn dark-on-white in both themes and carries the
  four-module quiet zone the QR spec requires — a code inverted for a dark background scans
  unreliably.
- `uqr` (MIT, no dependencies) is the QR encoder; `@tencent-connect/qqbot-connector`, which
  implements this protocol, is deliberately not used — it is `UNLICENSED`, its dist is
  machine-obfuscated, and it pulls a terminal QR renderer.
