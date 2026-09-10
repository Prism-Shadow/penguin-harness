# 同一分片同时携带推理尾部与回答开头时，不再把对话切碎

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `core`

[English](2026-09-10-transition-chunk-order.md)

引擎的事件翻译器现在先把同一个 provider 分片内的条目按生成顺序排好再分段：thinking 在前，text 与 tool call 在后。OpenAI 兼容网关可能把最后一个 `reasoning_content` token 和第一个 `content` token 打进同一个 SSE delta，而 chat 客户端先读 `content`，于是这种分片以 [text, thinking] 的顺序到达。此前翻译器照单全收：回答的头几个词把 thinking 段关掉，推理的最后一个词又开出第二个 thinking 段，余下的回答再开第二个 text 段——对话里回答的开头被夹在两个思考块之间，第二个思考块只有几毫秒长，还带着自己的「Done」标题。只含一种条目的分片不受影响。

## Details

- `packages/core/src/llm/generative-model.ts`：`inGenerationOrder` 对分片内条目做稳定分区，所有 `thinking` 条目排到最前；在 `EventTranslator.pushEvent` 中应用。
- `packages/core/test/llm.test.ts` 新增回归测试：三个分片、中间分片同时携带两个字段的流，产出一个完整的 thinking 段和一个完整的 text 段。
