# Proxy options can measure the server's reach to the model providers

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#686](https://github.com/Prism-Shadow/penguin-harness/pull/686)

[中文版](2026-09-11-proxy-reachability-probe.zh.md)

The Proxy options settings page gained a reachability test, below the save row: it lists the four
provider targets — OpenAI, Anthropic, Gemini and DeepSeek — with the exact URL each one probes,
and one button measures them all, reporting a latency for every host that answered. The probes run
on the server, concurrently, behind the new admin-only `GET|POST /api/admin/settings/proxy-probe`
— the path under test is the server's own outbound one, which is what the proxy settings configure
and what the browser has no view of.

## Details

- No credential is sent. Each probe is an unauthenticated `GET` of the provider's model-listing
  endpoint, and unlike protocol detection it does not fall back to `OPENAI_API_KEY` or its
  siblings in the process environment. `GET` on the same route serves the target list without
  probing anything, so the URLs the page shows are the URLs the server fetches.
- Any HTTP answer counts as reachable, 401 and 403 included: a rejected credential still proves
  the name resolved, TCP connected, TLS completed and the host replied. Unreachable means the
  transport failed, reported as one of `timeout`, `dns`, `refused`, `tls` or `network`.
- A reachable target shows its round trip in milliseconds, with a bar scaled against the slowest
  result of the same run; the worded state is kept for targets that have no number — unreachable
  ones and the not-yet-measured state — and travels with the figure for assistive technology. The
  bars compare the four targets of one run against each other and grade nothing against an
  absolute threshold.
- The targets are hard-coded and the probe endpoint accepts no request body, so no caller chooses
  an address for the server to fetch. Each target is given 5 seconds, and the four run together,
  so one dead host does not delay the rest.
- The measurement describes the saved settings, since only a save rebuilds the outbound
  dispatcher. That is why the test sits below Save; the response carries the proxy configuration
  the probes travelled and the block names it beside its heading, while the reason sits behind
  the page's existing "?". Saving clears results that describe a superseded configuration.
- `packages/docs/content/server-api.{zh,en}.md` gained both routes.
