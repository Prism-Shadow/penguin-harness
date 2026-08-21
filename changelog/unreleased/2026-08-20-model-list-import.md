# Add-group dialog imports a provider's whole model listing

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `server`, `core`
- **PR:** [#368](https://github.com/Prism-Shadow/penguin-harness/pull/368)

[中文版](2026-08-20-model-list-import.zh.md)

The models page's "add group" dialog gained two modes. **Create only** keeps the light path: a valid name hands off to that group's add-model dialog. **Import models** fills the brand-new group from its endpoint in the add-model dialog's field rhythm — API key first, then the base URL with the detect action at its top-right and the in-field protocol picker as manual override; once a protocol is determined, **Import all models** fetches every model id the endpoint serves and appends them all as entries of the new group in one save, each carrying the base URL, protocol, and typed key inline.

## Details

- Listing rides on AgentHub 0.4.5's `listModels()` (agenthub [#183](https://github.com/Prism-Shadow/agenthub/pull/183)): core exposes a thin `listEndpointModels` wrapper over `AutoLLMClient`, and the server serves it as `POST /api/projects/:p/models/list` (owner-only, same base-URL validation and DTO discipline as `/detect`; listings are bounded at 20s).
- An omitted API key follows the same environment chain as the connectivity test (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` per protocol). Keys travel only in request headers upstream and are never echoed.
- Ids come back in the endpoint's own order. An entry is skipped and counted in the success toast when its id duplicates one already taken (within the listing, or an already-configured `(provider, model_id)` pair) or when the config could not hold it — empty, over the 200-character id bound, or carrying control characters — so one bad entry never sinks the whole import.
- Only the id is taken from the endpoint: pricing, context window and display name stay empty rather than recording provider-reported numbers against the catalog's own pricing convention, and an imported model claims no vision support until it is probed or switched on, exactly like a model added to a user-defined group by hand.
- A failed detection turns the protocol suffix amber and blocks nothing: the protocol can be picked by hand, or the dialog switched back to create-only. A protocol with no models endpoint (AgentHub `UnsupportedOperationError`) or an empty listing is reported inside the dialog; nothing is persisted until the listing succeeded.
- User-defined group headers gained a **Delete group** action: one confirmation naming the group and its model count, then one table write removes every model in it, dropping a default/vision-model pointer into the deleted group the same way single-model delete does. Built-in groups are unaffected.
- The connectivity test and the vision probe now send the lowest thinking level (`low`) instead of disabling thinking — several reasoning endpoints reject a request that turns thinking off outright, which failed the probe on the knob it sent rather than on the endpoint.
