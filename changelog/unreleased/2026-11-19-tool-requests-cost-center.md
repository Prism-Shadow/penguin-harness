# Model tools in Cost Center

- Date: 2026-11-19
- Type: fix
- Scope: server, web
- PR: [#1616](https://github.com/Prism-Shadow/penguin-harness/pull/1616)

[简体中文](2026-11-19-tool-requests-cost-center.zh.md)

Cost Center includes model tool calls in request counts and success rates. A provider refusal counts as a failure; cancelling a submitted request keeps it out of the success-rate calculation. Tool calls with a Session also appear under its Agent.

The cost estimate uses each provider’s billing unit, including tokens, seconds of transcription, speech characters, images and search requests. A failed request with reported usage still contributes to the estimate. The Token total counts actual tokens. Image services that omit the billed resolution show a price range.

Jina Search and Reader use the MMSP reference rate when the request used the matching Jina endpoint. Calls to custom endpoints keep their token counts and use a project price when one is configured.
