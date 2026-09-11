# Proxy options can measure the server's reach to the model providers

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#686](https://github.com/Prism-Shadow/penguin-harness/pull/686)

[中文版](2026-09-11-proxy-reachability-probe.zh.md)

The Proxy options settings page gained a reachability test: one button probes OpenAI, Anthropic,
Gemini and DeepSeek and reports, per provider, whether it answered and how long the round trip
took. The probes run on the server, concurrently, behind the new admin-only
`POST /api/admin/settings/proxy-probe` — the path under test is the server's own outbound one,
which is what the proxy settings configure and what the browser has no view of.

## Details

- No credential is sent. Each probe is an unauthenticated `GET` of the provider's model-listing
  endpoint, and unlike protocol detection it does not fall back to `OPENAI_API_KEY` or its
  siblings in the process environment.
- Any HTTP answer counts as reachable, 401 and 403 included: a rejected credential still proves
  the name resolved, TCP connected, TLS completed and the host replied. Unreachable means the
  transport failed, reported as one of `timeout`, `dns`, `refused`, `tls` or `network`.
- The targets are hard-coded and the endpoint accepts no request body, so no caller chooses an
  address for the server to fetch. Each target is given 5 seconds, and the four run together, so
  one dead host does not delay the rest.
- The measurement describes the saved settings, since only a save rebuilds the outbound
  dispatcher. The response therefore carries the proxy configuration the probes travelled and the
  page names it under the results; saving clears results that describe a superseded one.
