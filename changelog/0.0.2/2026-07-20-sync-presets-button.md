# Add a sync-presets button to the Models page

A small owner-only button next to the Models page search box merges the built-in catalog
into the Project's model table: catalog entries missing locally are added, entries present
on both sides are reset to the catalog's fields, locally added models and API keys stay
untouched.

## Details

- Union semantics (`catalog-sync.ts`, pure and unit-tested): keyed by the
  `(provider, model_id)` pair. Catalog-only entries are appended (gateway base URLs preset);
  intersecting entries take the catalog's context window, pricing (including removal when
  the catalog carries none, e.g. the unpriced preview model), protocol, base URL, and vision
  flag — the catalog wins wherever the two differ; local-only models (including
  user-defined groups) are kept verbatim and in place.
- Credentials are structurally untouched: merged rows submit no `apiKey` (the PUT
  full-table replace keeps stored keys when the field is absent), and existing rows keep
  their credential state; a user base-URL override on a preset model is reset to the
  catalog's (the API-key carve-out is the only one).
- Feedback via toasts: "Presets synced: N added, M updated", or "already up to date"
  without a PUT when nothing differs. Strings added to both locales.
- The Qwen Token Plan provider logo is trimmed to the official emblem only (the wordmark
  lettering dropped), on a square viewBox.
