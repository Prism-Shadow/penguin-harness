# OpenCode requests carry the Session's id

- **Date:** 2026-09-14
- **Type:** feature
- **Scope:** `core`
- **PR:** [#612](https://github.com/Prism-Shadow/penguin-harness/pull/612)

[中文版](2026-09-14-opencode-session-header.zh.md)

A request sent to OpenCode's gateway now names the conversation it belongs to. The gateway keys its
backend routing on an `x-opencode-session` header and wants one value that holds still across a
conversation's requests; `attributionHeaders` supplies the Session's own id there, alongside the app
attribution it already sends OpenRouter and TokenDance.

## Details

- **The id comes from the Session, through `GenerativeModelConfig.sessionId`.** It is threaded at
  all three `GenerativeModel` construction sites — the context's own LLM object, the bare LLM behind
  meta requests such as title generation, and the vision describer — so everything one Session sends
  carries the same value, and a context rotation does not change it.
- **The endpoint host decides, as it does for the other two schemes.** Matching is suffix-anchored
  on `opencode.ai`, so a subdomain of the gateway counts and a lookalike domain does not. No
  built-in catalog row points at OpenCode; the header reaches the wire through a `custom` model
  entry carrying that `base_url`.
- **No Session id, no header.** Nothing stands in for a missing one — a constant would file every
  conversation at the gateway under a single session.
- OpenRouter's three headers and TokenDance's `X-App-URL` are unchanged, with or without a Session
  id in hand.
