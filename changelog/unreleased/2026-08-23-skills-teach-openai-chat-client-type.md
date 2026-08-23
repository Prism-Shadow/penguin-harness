# Library skills spell the OpenAI client type `openai-chat`

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `skills`
- **PR:** [#417](https://github.com/Prism-Shadow/penguin-harness/pull/417)

[中文版](2026-08-23-skills-teach-openai-chat-client-type.zh.md)

The `ollama`, `vllm` and `penguin-sdk` skills registered OpenAI-compatible endpoints with
`--client-type openai`, the pre-AgentHub-0.4.2 spelling that `agenthub-models` documents as a
deprecated alias. All five occurrences now read `openai-chat` (`ollama` and `vllm` at `v2`,
`penguin-sdk` at `v22`).

## Details

- Both the prose step and the full command example were updated in `ollama` and `vllm`; the
  `penguin-sdk` setup recipe was updated in the optional flag and in the recommendation that
  follows it.
- The alias keeps working — `canonicalClientType` normalizes it on read and on write, and the
  CLI already writes `openai-chat` for a new OpenAI-routed entry — so this changes what the
  library teaches, not what an existing config does.
