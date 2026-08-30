# A machine that drops is connected again instead of staying gone

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [#553](https://github.com/Prism-Shadow/penguin-harness/pull/553)

[中文版](2026-08-30-machine-reconnects-after-drop.zh.md)

A machine whose connection dropped stayed disconnected for the rest of the page's life. Nothing raised its forward again — not the Session list noticing it offline, and not the retry a call gets when the server answers `not_connected` — so the only ways back were reloading the page or connecting by hand from the Machines page.

## Details

- The page attempts a connection once per machine and remembers the outcome, so a machine that cannot be reached is not re-attempted by every keystroke that names it. A **successful** outcome was remembered the same way — but that one is not a fact about the machine, it is a fact about a forward, and a forward dies when ssh drops, the network moves or the machine reboots. Every later need was then answered "already connected" from that memory while nothing was listening on the far end.
- Success is no longer remembered: the next need after a drop starts a fresh attempt, which costs one machine-list call when the machine is in fact still up. Failed outcomes are remembered exactly as before, and concurrent needs still join the one attempt in flight.
