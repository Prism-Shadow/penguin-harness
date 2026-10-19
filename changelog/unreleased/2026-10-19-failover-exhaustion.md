# A ladder-exhausted Session moves down the fallback chain, not out of the run

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1062](https://github.com/Prism-Shadow/penguin-harness/pull/1062)

[中文版](2026-10-19-failover-exhaustion.zh.md)

Only a 429 moved a Session down the Project's fallback chain; a reconnect ladder the retries did not recover (`timeout`/`network`/`connect_failed` once the attempts are spent) ended the run instead, even with healthy models waiting on the chain. Every transport failure now queues the same move-and-resend: the turn finishes on the next chain entry instead of being lost.

## What moves, what stays

- The decision reads the run's last `request_end`: a 429, or an exhausted ladder on a transport failure, moves; a refused request (`auth`/`rejected`/…) stays, because switching models cannot fix the request itself.
- A stopped run never moves: the last request end may be an intermediate retryable one (a stop during the reconnect backoff leaves no terminal end), and resending the stopped turn on another model would defy the stop.
- The existing bounds still hold: each model is tried at most once per Session, and an unset chain behaves exactly as before.
