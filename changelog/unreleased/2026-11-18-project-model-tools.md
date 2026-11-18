# Six model tools for each Project

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `core`, `server`, `cli`
- **PR:** [#1597](https://github.com/Prism-Shadow/penguin-harness/pull/1597)

[中文版](2026-11-18-project-model-tools.zh.md)

Project owners can bind a model to web search, page reading, image or video generation, speech synthesis, and transcription. Each binding uses that model's configured connection. The model library adds the new GPT-6.2, Gemini 4, Qwen4 and media models from MMSP.

Use `penguin tools list` to inspect the bindings. For example, `penguin tools image "A penguin by the sea" --out penguin.png` saves a generated image, and `penguin tools stt meeting.wav` prints the transcript. Add `--detach` to start a long run, then use `penguin tools status` or `penguin tools cancel` with its ID.

`penguin tools usage` shows the model, operation, reported token counts and observed units. `penguin tools artifacts` lists generated files. From an Agent terminal, both commands default to the calling Session.
