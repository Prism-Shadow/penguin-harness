# Add-group dialog imports a provider's whole model listing

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `server`, `core`
- **PR:** [#368](https://github.com/Prism-Shadow/penguin-harness/pull/368)

[中文版](2026-08-20-model-list-import.zh.md)

The models page's "add group" dialog gained optional Base URL and API key fields and a "Detect & import" action: it detects the endpoint's protocol with the existing probes, fetches every model id the endpoint serves, and appends them all as entries of the new group in one save — each entry carrying the base URL, the detected protocol, and the typed key inline. The manual path (name only, then the add-model dialog) is unchanged.

## Details

- Listing rides on AgentHub 0.4.5's `listModels()` (agenthub [#183](https://github.com/Prism-Shadow/agenthub/pull/183)): core exposes a thin `listEndpointModels` wrapper over `AutoLLMClient`, and the server serves it as `POST /api/projects/:p/models/list` (owner-only, same base-URL validation and DTO discipline as `/detect`; listings are bounded at 20s).
- An omitted API key follows the same environment chain as the connectivity test (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` per protocol). Keys travel only in request headers upstream and are never echoed.
- Ids come back in the endpoint's own order; duplicates — within the listing or against already-configured `(provider, model_id)` pairs — are skipped and counted in the success toast.
- A protocol with no models endpoint (AgentHub `UnsupportedOperationError`), a failed detection, or an empty listing is reported inside the dialog, leaving the manual path one click away; nothing is persisted until the listing succeeded.
