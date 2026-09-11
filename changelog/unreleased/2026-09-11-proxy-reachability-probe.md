# Proxy options can measure the server's reach to the model providers

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#686](https://github.com/Prism-Shadow/penguin-harness/pull/686)

[中文版](2026-09-11-proxy-reachability-probe.zh.md)

The Proxy options settings page gained a reachability test, below the save row: it lists six
provider targets — OpenAI, Anthropic, Gemini, DeepSeek, and GLM's two hosts, Z.AI and BigModel —
with the exact URL each one probes, and one button measures them all, reporting a latency for every
host that answered. Each row fills the moment its own answer arrives rather than waiting for the
slowest. The probes run on the server, behind the new admin-only
`GET /api/admin/settings/proxy-probe` and `POST /api/admin/settings/proxy-probe/:provider` — the
path under test is the server's own outbound one, which is what the proxy settings configure and
what the browser has no view of.

## Details

- No credential is sent. Each probe is an unauthenticated `GET` of the provider's model-listing
  endpoint, and unlike protocol detection it does not fall back to `OPENAI_API_KEY` or its
  siblings in the process environment. `GET` on the base route serves the target list without
  probing anything, so the URLs the page shows are the URLs the server fetches.
- GLM is two targets, not one: `api.z.ai` is the global endpoint the catalog defaults to and
  `open.bigmodel.cn` the mainland one a bigmodel.cn key needs. They resolve and route
  differently, so a proxy can carry one and not the other.
- Any HTTP answer counts as reachable, 401 and 403 included: a rejected credential still proves
  the name resolved, TCP connected, TLS completed and the host replied. Unreachable means the
  transport failed, reported as one of `timeout`, `dns`, `refused`, `tls` or `network`.
- A reachable target shows its round trip in milliseconds and nothing more; the worded state is
  kept for targets that have no number — unreachable ones and the not-yet-measured state — and
  travels with the figure for assistive technology.
- The targets are hard-coded and the probe route accepts no request body — only a provider id,
  matched against that same list, with anything else a 404 that reaches no network. No caller
  chooses an address for the server to fetch. Each target is given 5 seconds, and the page asks
  for all of them at once, so one dead host holds up only its own row.
- The measurement describes the saved settings, since only a save rebuilds the outbound
  dispatcher. That is why the test sits below Save; the response carries the proxy configuration
  the probes travelled, while the reason sits behind the page's existing "?". Saving clears
  results that describe a superseded configuration.
- `packages/docs/content/server-api.{zh,en}.md` gained both routes.
