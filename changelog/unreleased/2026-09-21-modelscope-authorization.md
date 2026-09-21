# ModelScope authorization and token renewal

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `model-catalog`, `server`, `web`, `docs`, `core`
- **PR:** [#814](https://github.com/Prism-Shadow/penguin-harness/pull/814)

[中文版](2026-09-21-modelscope-authorization.zh.md)

Added ModelScope as an authorized aggregate model group with three presets, model-specific AgentHub protocols, and server-managed token renewal.

## Models and authorization

- Added `deepseek-ai/DeepSeek-V4.1-Flash` through `deepseek-v4` and `Qwen/Qwen3.8-27B` plus `Qwen/Qwen3.8-Flash-Next` through `openai-chat-vllm-adapter` at ModelScope's API-Inference endpoint.
- Added the monochrome ModelScope mark and an authorization dialog that sends the browser through the ModelScope bridge without exposing delivered credentials to the Web App.

## Token renewal

- Stored refresh tokens and access-token expiry server-side, while continuing to store the current access token in the existing Project `api_key` field.
- Refreshed an expiring credential before ModelScope requests, serialized refresh and model-config writes, and asked the user to authorize again after repeated refresh failures.
- Recorded the database and rollback behavior in [ModelScope refresh-token compatibility](2026-09-21-backward-compatibility.md).

## Existing projects

New Projects receive the three ModelScope presets. Existing Projects receive them only after the user runs **Sync presets** on the models page; synchronization appends and updates catalog-owned fields without deleting models or changing the stored default.
