# The messaging HTTP surface stops being written three times

- **Date:** 2026-08-27
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#525](https://github.com/Prism-Shadow/penguin-harness/pull/525)

[中文版](2026-08-27-messaging-channel-spec.zh.md)

`runtime/messaging/connector.ts` already gave the runtime a channel seam: a connector owns its
wire protocol and hands the bridge a channel-neutral view. The HTTP layer had no such seam, so
each of its six endpoints was written once per channel and each new saved field was written
three more times — the three delivery preferences that arrived in one release cost nine
declarations, nine reads and nine spreads between them.

A `MessagingChannelSpec` now carries what a channel actually differs in, and the endpoints that
differ in nothing else are written once.

## Details

- `http/routes/messaging-channels.ts` holds the spec and the pieces the routes share: the
  common half of a binding's wire shape, the masked-secret projection, the delivery-preference
  patch read off a PUT body, and `resolveSecret` — the credential ladder all three channels
  climb, whose four steps (a typed credential wins, the clear flag is refused while enabled,
  the stored one carries over, a first bind with none is a 400) were previously stated three
  times and could have drifted.
- Four endpoints per channel — the read, the state toggle, the delete and the test message —
  are registered from the spec table. What varied across the twelve copies was a channel
  literal and a `<channel>_` error-code prefix, so the spec carries a display label and the
  codes are derived.
- The PUT and the credential test stay hand-written per channel, deliberately. Their shape is
  shared and now uses the ladder, but the order their inputs are validated in and how an
  account identity falls out of a credential genuinely differ — Telegram derives its bot id
  from the token itself — and a table would have hidden that difference rather than removed it.
- `MessagingBindingCommon` and `MessagingDeliveryPatch` do the same for the wire types. QQ
  re-declares the three preference fields, unchanged in type, because each costs something
  different there and the passive-reply budget is what a reader setting one needs to know; the
  compiler enforces that a redeclaration can only add documentation.
- The spec is not merged with the connectors' config parsers, which run in the opposite
  direction: a connector reads a stored document to build a client, this reads a request to
  decide what to store. They share knowledge of a document's shape and nothing else.

No endpoint, status code, error code or response body changes: the whole messaging test suite
passes unmodified.
