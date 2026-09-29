# Local audio language validation and scheduling

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#84](https://github.com/nicolaepocroianu/penguin-harness/pull/84)

Disabled Kokoro selection for unsupported languages in individual and bulk narration controls, and added pipeline preflight checks for saved selections. Local audio runtime detection checked required dependency paths before reporting a provider as available. Concurrent local audio requests queued in arrival order and remained cancellable while waiting; failed or cancelled workers released the next request after termination.
