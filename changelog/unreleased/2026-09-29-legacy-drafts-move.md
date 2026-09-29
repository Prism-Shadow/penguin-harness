# Earlier drafts move into their modules when first opened

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`, `activities`

A draft saved before activities were stored in their modules (`draft.json` under `~/.penguin`) is written into its module's files the first time it is read. Its selected implementation features and its product's metadata are written too. The old `draft.json` is left where it was, as a copy.

If the module already has files at that ref's address, such as a ref Loom authored, nothing is overwritten. Reading the draft is then refused with 409 `ref_files_conflict`, which names both folders.
