# Models: use the OpenAI-compatible client when moving to Custom

- **Date:** 2026-08-14
- **Type:** fix
- **Scope:** `web`, `model-catalog`
- **PR:** [#282](https://github.com/Prism-Shadow/penguin-harness/pull/282)

[中文版](2026-08-14-model-group-protocol.zh.md)

Moving an existing model to the Custom group now sets `client_type` to `openai`, matching models added directly to that group and preventing unsupported-model errors for custom IDs.

Unknown IDs in first-party groups now offer a one-click move to Custom while preserving the entered settings.
