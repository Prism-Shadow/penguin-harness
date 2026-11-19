# Billing units and estimated costs for model tools

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [#1615](https://github.com/Prism-Shadow/penguin-harness/pull/1615)

[中文版](./2026-11-19-model-tool-metering.zh.md)

`penguin tools usage` shows the provider’s reported usage and estimates the charge when you read the history. A failed request keeps any usage the provider reported. Cached input, uncached input, thinking and response tokens each count once.

DeepSeek speech recognition uses billed seconds, speech generation uses billable characters, and search and fetch use successful requests. Jina uses input tokens and Fish Audio speech generation uses UTF-8 bytes. The estimate uses the selected seller’s rate and the promotion in effect when the request ran. Project token prices apply to token-billed output.

Mixed image and text output uses the image rate. Services that bill per image use the returned image count. When the service publishes two possible rates, the estimate shows both bounds. An estimate with a missing price or measurement stays unavailable.

Jina’s MMSP reference price applies to calls made to its listed endpoint. A project or environment proxy needs a project price.
