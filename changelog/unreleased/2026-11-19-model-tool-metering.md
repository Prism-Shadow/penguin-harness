# Units and image estimates in tool usage

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [#1615](https://github.com/Prism-Shadow/penguin-harness/pull/1615)

[中文版](./2026-11-19-model-tool-metering.zh.md)

`penguin tools usage` keeps a provider's reported counts and labels the measured input when the adapter identifies its unit. DeepSeek speech recognition uses billed seconds. DeepSeek speech generation counts billable characters, and Fish Audio speech generation counts UTF-8 bytes. A DeepSeek search with no matches uses zero billable requests.

Image generation includes a USD estimate at the current project or model rate. Ordinary response text uses the image output price. Separately reported thinking uses its own published rate. Services that bill per image use the actual number of images returned. When a service has two image prices and does not identify the tariff in the response, both bounds are shown. Missing rates or quantities leave the estimate unavailable.
