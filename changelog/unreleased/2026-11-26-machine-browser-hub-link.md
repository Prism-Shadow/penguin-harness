# A machine takes the person's browser from the server that added it, over a channel that server opens

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `browser-automation`

[中文版](2026-11-26-machine-browser-hub-link.zh.md)

A machine's browser module now accepts the channel through which the server that added it (the hub) relays the person's own browser: the desktop's built-in browser, or the Chrome its admin paired. The channel is `WS /api/builtin-browser/hub/ws`. The agents on the machine keep their driver, page scripts and actions; every command they send goes over the channel, and the hub carries it out in that browser. The hub's side of the channel follows in the next change. Until then no hub connects, and a machine answers `hub_disconnected` as before.

## The channel

- The endpoint takes the admin session the hub minted on the machine. It refuses any `Origin` (a browser page), any member, and any server that runs inside the desktop app.
- It speaks the extension's `desktop-browser-*` protocol: the machine says `hello` first and pings every 20 s, and a later socket replaces an earlier one. The hub answers `{ version: 1, backend, hub: true }`, and the machine's status names that backend.
- `open-tab` now also carries the machine's Session and its Project. A tab the hub opens belongs to that Session, and an agent sees only its own Session's tabs.
- A new `activity` command tells the hub when an agent's action starts and ends.
- On a machine, raw CDP that reaches the person's cookies or stores is refused (`403 cdp_refused`) before it is sent, as on the user's own Chrome.
- A server without the desktop app that was not started as a machine becomes one for its admin when a hub connects; its members keep their own Chrome. The machine's App Center counts and closes its Sessions' pages through the channel.
