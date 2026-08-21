# A model backed by an environment variable counts as having a key

- **Date:** 2026-08-21
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-21-model-key-env-detection.zh.md)

The chat model picker judged "has an API key" by the stored masked key alone, while the model library already showed a model backed by an exported environment variable as configured. A model whose key came from `ANTHROPIC_API_KEY` was therefore pushed behind the picker's "show models without key" expander and marked with the struck-through key icon, on the same screen where the library card printed that variable's masked value. Both surfaces were put on one rule: a stored key **or** an env fallback the server proved is set.

## Details

- `hasConfiguredKey` (`model-grouping.ts`) became the single predicate behind every surface — the picker's default list, its struck-through key icon and the "show models without key" count all read it — and `ModelCredentialRowLike` gained `envKeyMasked`. `envKey` still counts for nothing: it is only the NAME of a fallback variable and says nothing about whether that variable holds a value, while the server emits `envKeyMasked` only for one that currently does.
- The model page's own `hasKey` was rebuilt on top of that predicate and now adds only what the DTO shape cannot carry: a key typed into the dialog counts before it is saved, and `clearApiKey` drops the **stored** key only — an environment variable cannot be cleared from there, so an env-backed row keeps its key through a clear. The card's key status line moved into `keyStatusText`, guarded by the same `hasKey`, so the card and the picker can no longer disagree about which rows are "not configured".
- The chat credential guide — the one-time "no model credential configured" dialog — now asks `hasConfiguredKey` about the Project's default model instead of reading its masked key directly, so a Project whose default model runs on an environment variable is not nagged on first entry.
