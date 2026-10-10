# A context-window overflow says what to do next

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)

[中文版](2026-10-10-context-overflow-hint.zh.md)

A request larger than the model's context window used to end with the bare provider error, for example llama.cpp's `400 request (100091 tokens) exceeds the available context size (98304 tokens), try increasing it`. The error now carries its own code, and the chat explains the way out.

- The LLM layer recognises the context-overflow wordings of llama.cpp, OpenAI, Anthropic, DeepSeek, vLLM, Gemini and others among provider 4xx rejections and ends the request `fatal` with `error_code: context_overflow`.
- The Web App's error line gets a hint below it. **/model** continues the conversation in a new session on a model with a larger context window. The hint also asks the user to check that this model's **Context window** in **Models** is no larger than what its server actually supports: set too large, automatic compaction starts too late.
- The CLI prints the same hint. Since `/switch-model` compacts on the current model first and would overflow too, the CLI hint points to starting a new `penguin chat` on a larger-context model instead.
