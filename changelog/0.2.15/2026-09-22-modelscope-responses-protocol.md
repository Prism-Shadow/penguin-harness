# ModelScope presets on the Responses protocol

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `model-catalog`, `web`, `docs`
- **PR:** [#820](https://github.com/Prism-Shadow/penguin-harness/pull/820)

[中文版](2026-09-22-modelscope-responses-protocol.zh.md)

Moved all three built-in ModelScope presets to AgentHub's generic OpenAI Responses client.

## Details

- Pinned `deepseek-ai/DeepSeek-V4.1-Flash`, `Qwen/Qwen3.8-27B` and `Qwen/Qwen3.8-Flash-Next` to `client_type = "openai-responses"`, sending inference requests to the existing api-inference base URL's `/responses` path.
- Existing Projects keep their stored protocol until **Sync presets** or the next ModelScope authorization updates the catalog-owned client type. No Project config fields or database migration were added.
