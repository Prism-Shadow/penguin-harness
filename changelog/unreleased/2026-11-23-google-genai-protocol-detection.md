# Detect Google GenAI from its model list

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#1728](https://github.com/Prism-Shadow/penguin-harness/pull/1728)

[中文版](2026-11-23-google-genai-protocol-detection.zh.md)

**Detect** can select Google GenAI when the endpoint returns a Google model list. The detector skips generic gateway errors when probing Anthropic Messages or checking OpenAI authentication.
