# Cancel the upstream request when a stream is left before its stop

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1354](https://github.com/Prism-Shadow/penguin-harness/pull/1354)

[中文版](2026-10-26-llm-stream-cleanup.zh.md)

Leaving a `GenerativeModel.streamGenerate()` iterator before its `stop` event, whether the consumer broke out early, the request was interrupted or failed, or an unresponsive upstream was abandoned, aborted the upstream request and closed its iterator, so the provider stopped generating and the model accepted its next request. The cleanup never waited on an upstream that ignored it. A request that had received its `stop` was left untouched, so its stream still ended normally and kept its connection.
