# A chunk carrying the reasoning tail and the answer head no longer splits the transcript

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `core`

[中文版](2026-09-10-transition-chunk-order.zh.md)

The engine's event translator now orders the items of one provider chunk by generation order before segmenting them: thinking first, then text and tool calls. An OpenAI-compatible gateway can batch the last `reasoning_content` token and the first `content` token into one SSE delta, and the chat client reads `content` first, so such a chunk used to arrive as [text, thinking]. Taken literally, that closed the thinking segment on the answer's first words, opened a second thinking segment for the reasoning's last word, and a second text segment for the rest — the transcript showed the answer's opening wedged between two thinking blocks, the second one a few milliseconds long with its own "Done" header. Chunks carrying a single kind are unaffected.

## Details

- `packages/core/src/llm/generative-model.ts`: `inGenerationOrder` stable-partitions a chunk's items so every `thinking` item precedes the rest; applied in `EventTranslator.pushEvent`.
- Regression test in `packages/core/test/llm.test.ts`: a three-chunk stream whose middle chunk carries both fields yields one thinking segment and one text segment, each complete.
