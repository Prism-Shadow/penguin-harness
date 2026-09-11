# A compaction request runs at the Session's thinking level

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `core`
- **PR:** [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700)

[中文版](2026-09-11-compaction-thinking-level.zh.md)

## Details

- The thinking level is a per-request parameter, and every LLM request takes the level the
  Session has pinned — the composer's picker, the CLI's `--thinking` / `/thinking`,
  `session.thinkingLevel` on the SDK — falling back to the level the context was opened with
  only when there is none. The compaction request was excepted and always took the fallback, so
  a Session whose pin differed from its context's base ran its turns at one level and its
  compaction at another. It now carries the pin like any other request.
- The exception existed to hold the compaction request's prefix identical to the context it
  summarises, keeping the provider's cache warm at the moment a miss costs most. It could only
  ever fire once the user had moved the pin, though — and by then every turn since had gone out
  at the new level and the cache had been rebuilt against it, leaving the compaction request as
  the one request that differed.
- What the split did cost is real: on a provider that reads the level as a thinking mode, it is
  a mode changing mid-conversation. A turn produced under the quieter level carries no chain of
  thought, and DeepSeek rejects a request whose current tool-call chain replays such a turn back
  into thinking mode.
- `specs/05-ARCHITECTURE.md` § "上下文轮换与运行配置" carried the exception; the design change is
  [penguin-harness-design #149](https://github.com/Prism-Shadow/penguin-harness-design/pull/149).
