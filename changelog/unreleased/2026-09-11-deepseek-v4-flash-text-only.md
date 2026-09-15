# DeepSeek V4 Flash is text-only in the catalog

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `model-catalog`, `core`, `docs`
- **PR:** [#678](https://github.com/Prism-Shadow/penguin-harness/pull/678)

[中文版](2026-09-11-deepseek-v4-flash-text-only.zh.md)

The direct DeepSeek `deepseek-v4-flash` row was marked text-only (`supportsVision: false`).
DeepSeek retired the id on 2026-09-10 and serves it from V4.1 Flash, but AgentHub 0.4.11's
DeepSeek client matches the bare id against its text-only deny-list
`/^deepseek-v4-(flash|pro)(-\d{4})?$/` and rejects image parts before the request leaves the
harness, so an image attached to this model never reaches DeepSeek.

## Details

- `deepseek-flash` (V4.1 Flash) and `deepseek-v4-flash-vision-exp` are unchanged and read
  images, as do the resold V4.1 Flash and Vision Exp rows on OpenRouter, TokenDance and vLLM.
- The models docs were corrected alongside the row.
- An existing Project keeps the `vision` value its `.project_config.toml` already stores;
  pressing **sync presets** on the models page applies the correction.
