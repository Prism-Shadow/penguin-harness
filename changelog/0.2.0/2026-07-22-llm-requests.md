# Empty tool lists stay off the wire

Strict OpenAI-compatible servers reject requests that carry `tools: []` — vLLM answers `400 … tools must not be an empty array. Either provide at least one tool or omit the field entirely.` Every tool-less request the harness makes (the Models-page connectivity probe, session-title generation, the vision describer) hit this against a local vLLM endpoint.

- `buildUniConfig` now omits the `tools` field entirely when the tool list is empty, instead of sending an empty array. Tool-carrying agent requests are unchanged.
- `tool_choice` was investigated end to end: neither this repo nor AgentHub 0.4.0 ever sends it. The `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser` failure seen on vLLM is produced server-side when a non-empty `tools` array arrives without those flags — real tool use on vLLM needs them regardless of client (the vLLM skill documents this). A wire-level capture test now locks both behaviors: no `tools` key and no `tool_choice` key on a tool-less request.
