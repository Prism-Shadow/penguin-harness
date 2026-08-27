# A QQ bot can be bound by scanning a QR code

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#504](https://github.com/Prism-Shadow/penguin-harness/pull/504)

[中文版](2026-08-27-messaging-qq-scan.zh.md)

Binding a QQ bot required copying an App ID and an App Secret out of the developer console
by hand. The QQ binding editor gained a QR code above those fields: scan it in QQ, pick the
bot, and the credentials arrive on the server. The typed fields were kept below it for the
cases a scan cannot reach.

## Details

- The bind protocol was implemented as three calls against `q.qq.com`: a task registered
  under a fresh AES key, a URL encoded into the QR code (opened by the QQ app, never fetched
  by this server), and a poll that returns the App Secret encrypted under that key.
- **The key was kept out of the browser entirely.** It was generated, held, used and dropped
  server-side; the client was given a task handle, a URL and a status, and the credentials it
  produced were written to storage without passing back through it — the same rule that keeps
  a stored secret from round-tripping through the form.
- Bind tasks were held in memory only, scoped to the Session that started them, bounded per
  Session rather than process-wide so one caller's scans cannot evict another's, and claimed
  by the poll that resolves them: both a replay and a second concurrent poll of one task read
  as 404 rather than as a second bind. Cancelling — including leaving the editor, and giving
  up after a run of failed polls — releases the key at once, and a task nobody came back for
  is swept at its ten-minute TTL rather than at whenever the next scan happens.
- A completed scan was made to **save** the binding and stop there. Enabling stayed the
  separate, exclusive act it is on every channel, so a scan cannot take a bot away from
  another conversation holding it. Starting a scan while this Session's own QQ connection was
  enabled was refused with 409 `messaging_disable_before_scan`, and a scan completing onto a
  live connection was given the same account guard the PUT runs.
- Three routes were added — `POST /messaging/qq/scan`, `…/scan/poll` and `…/scan/cancel` —
  all owner-only: the flow ends in a stored credential however little of it the caller types.
- The QR was generated in the browser and inlined as `<svg>`, so no third party learns the
  task handle from an image request. It was drawn dark-on-white in both themes and given the
  four-module quiet zone the QR spec requires — a code inverted for a dark background scans
  unreliably.
- The polling panel was made to ride out transient errors: a few consecutive poll failures
  leave the code on screen, and a code the platform reports expired is replaced a bounded
  number of times before the panel falls back to offering a new scan.
- Added `uqr` (MIT, no dependencies) as the QR encoder.
