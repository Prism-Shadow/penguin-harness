# Conversations on an unreachable machine stop retrying and show the cached copy

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1904](https://github.com/Prism-Shadow/penguin-harness/pull/1904)

[中文版](2026-11-26-offline-machine-history-retry.zh.md)

Opening a conversation on a remote machine that cannot be reached no longer retries without end. The page shows the hub's cached copy and a one-line status, and loads the live history again when the machine comes back.

## Details

- The hub's history read now states each wait's real reason. `not_connected` means the hub holds no connection to the machine. `unreachable` is new: the connection is held, but neither the API socket nor the forward reaches the machine's server. `retrying` means the machine answered or its stream opened, and then the stream was cut without moving. Before this change, a machine whose server was down behind a live ssh connection read as "the machine is not answering".
- Every wait reports its attempt out of `maxAttempts` (5), and the retry line reads, for example, 「连不上 bm2 上的服务，2 秒后重试（第 2/5 次）」. After five retries that move nothing (1, 2, 4, 8 and 16 s), the read ends with 503 `machine_unreachable`, whose `details` carry `machineId` and the last `reason`. Until a stream from that machine moves again, the hub tries each later read of it once and does not retry, so reopening the conversation does not start a new round.
- When the machines list reads the machine as away (reconnecting, reconnecting stopped, password refused, server stopped, never connected), the conversation opens neither its history stream nor its live stream. The cached copy and the offline line show at once, and the conversation opens when the list pushes that the machine is connected.
- When a read gives up on a machine the list still reads as connected, the page falls back to the same offline view. Its first line names the reason (「bm2 上的服务没有响应。」 or 「bm2 没有回应。」) and ends with 「[重试]」, which makes one attempt. The page reads again on its own when the machine's API socket comes up again. The hub now pushes `machines_changed` whenever that socket connects or closes, so the page never polls.
