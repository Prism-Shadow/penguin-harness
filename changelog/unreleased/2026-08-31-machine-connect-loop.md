# A machine that stops answering no longer sends connect into a forever loop

- **Date:** 2026-08-31
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#561](https://github.com/Prism-Shadow/penguin-harness/pull/561)

[中文版](2026-08-31-machine-connect-loop.zh.md)

When a machine's server died while the ssh forward to it stayed up, the app spun forever: probes, connect jobs and server starts fired in a tight cycle, piling `server status` processes onto the machine and load onto both sides, until the page was closed.

## Details

- The cycle: the Session list's reachability probe found the machine silent and asked auto-connect for it; auto-connect trusted the machine list's `connected` — a fact about the forward, an ssh process on *this* side that outlives the far server — and declared instant success; the success listener re-ran the probe; the machine was still silent; and the "successful" attempt had already been forgotten, so a new one began. No backoff ever engaged, and the one job that could have started the dead server never did, because connect answered "Already connected" on the forward's word alone.
- Auto-connect now confirms an attempt by asking the machine itself (`/api/me` through the proxy) before counting it connected. A machine that never answers walks the widening schedule to its remembered give-up, exactly like one that was never reachable.
- Connect now probes what is actually running there even when a forward is already up, and starts the server when nothing is — so the reconnect a silent machine provokes is the one that heals it.
