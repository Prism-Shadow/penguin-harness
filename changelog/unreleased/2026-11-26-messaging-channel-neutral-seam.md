# The messaging seam stops naming QQ and spelling the channel list by hand

- **Date:** 2026-11-26
- **Type:** refactor
- **Scope:** `messaging`, `server`
- **PR:** [#1918](https://github.com/Prism-Shadow/penguin-harness/pull/1918)

[中文版](2026-11-26-messaging-channel-neutral-seam.zh.md)

Code every channel shares, in the messaging library and the server, was coupled to one channel, to a hand-written copy of the channel list, or to imports it never used. Nothing users or HTTP clients see changed: every path, request, response and error message is byte-for-byte what it was.

## Details

- `MessagingConnectionClosedError` moved from `qq-api.ts` to `connector.ts`, beside `MessagingChannelError`, so `error-kind.ts` no longer imports a channel's file to classify a closed connection. The QQ gateway still raises it, unchanged; the server tests import it from `@prismshadow/penguin-library-messaging/connector`.
- `MessagingSlots.connectors` declares its data as `{ channel: MessagingChannel }` instead of a second literal copy of the union.
- `enabled-channel.ts` exports `MESSAGING_CHANNELS`, the channel ids in its table's order, and the account-holders route's 400 for an unknown channel builds its list from it instead of a literal string.
- The server's `app.ts` dropped nineteen messaging imports it never used — the bridge, every channel's connector and transport, and both scan services; the assembly in `platform.ts` and `runtime/messaging/module.ts` was already what wired them.
