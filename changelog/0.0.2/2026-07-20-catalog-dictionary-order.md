# Order catalog models by dictionary, newer versions first

Within each provider group, catalog entries are now in dictionary order by model id, except
that newer versions of the same series come first (gpt-5.6-* before gpt-5.5,
claude-opus-4.8 before 4.7, glm-5.2 before glm-5) — precomputed by hand in the catalog
literal, with no runtime sorting anywhere.

## Details

- Every provider section of MODEL_CATALOG is hand-reordered: dictionary order
  (case-insensitive) across families and tiers; within a version series, the newest version
  block leads, tiers inside a version staying alphabetical. Section comments and the
  exact-order test assertions are updated to match.
- The order flows everywhere in-group order is preserved: new Projects' preset config, the
  models page cards, and the chat model dropdown (orderModelsLikeLibrary). Existing Project
  configs keep their stored order — the sync-presets merge deliberately preserves local
  positions.
