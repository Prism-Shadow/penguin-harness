# The unused partial-fragment aggregator is removed from the SDK

- **Date:** 2026-10-02
- **Type:** refactor
- **Scope:** `core`, `docs`
- **Breaking:** yes — `PartialAggregator`, `aggregateAll` and `Writer.aggregateAndWrite` are no longer exported by `@prismshadow/penguin-core`

[中文版](2026-10-02-drop-partial-aggregator.zh.md)

`packages/core/src/omnimessage/aggregate.ts` (`PartialAggregator`, `aggregateAll`) and the Trace writer's `aggregateAndWrite` were deleted. Nothing in the harness called them: every producer follows its `partial_*` fragments with the complete message, and the LLM interface takes that message from MMSP's `.done` item. The streaming discipline itself — `start → delta → stop → complete message` — is unchanged. The omni-message and architecture docs no longer mention the aggregator.

## Compatibility

Code that imported `PartialAggregator` or `aggregateAll`, or called `Writer.aggregateAndWrite`, no longer compiles. Use the complete `model_msg` that follows each fragment's `stop` instead of reassembling the fragments, and write it with `Writer.write`, which already skips `partial_*`.
