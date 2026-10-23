# A provider that names the model as the reason ends the run with `model_unavailable`

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `core`

[中文版](2026-10-20-model-scoped-rejection.zh.md)

A provider 4xx used to be one thing: a definitive rejection (`error_code: "rejected"`). But not every 4xx refuses the **request** — some refuse the **model**: "Upstream request failed: Model is unavailable." (a gateway wrapping a dead upstream), "no available channel" (no route left for the model), "All routed providers rejected the request" (an aggregator that came back empty). The request is fine; this model cannot serve it, and the identical request on this model can never succeed.

## What it does

`GenerativeModel` now tells those apart. When the provider's own payload — the message, the parsed body, or a structured code on the error's cause chain — names the model or its route, the request ends with `error_code: "model_unavailable"` instead of `"rejected"`.

The run still stops (nothing on this model would succeed on a retry), but the cause is named, so a host that has another model to run the Session on can move it there — the same path a rate limit takes. A refusal of the request's own content (a body limit, a tool-call pairing, a missing parameter, an exhausted quota) stays `"rejected"`: the next model would refuse it the same way, so moving the Session would only burn the chain.
