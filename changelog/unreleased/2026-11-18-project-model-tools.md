# Eight model tools for each Project

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `core`, `server`, `cli`
- **PR:** [#1597](https://github.com/Prism-Shadow/penguin-harness/pull/1597)

[中文版](2026-11-18-project-model-tools.zh.md)

Project owners can bind a model to text generation, image understanding, web search, page reading, image or video generation, speech synthesis, and transcription. Each binding uses that model's configured connection. The model library adds the new GPT-6.2, Gemini 4, Qwen4 and media models from MMSP.

The built-in Multimodal tools plugin contributes these eight actions and teaches the default Agent how to run them. An admin can turn the plugin off for one Project and turn it back on later. The Project keeps its bindings, generated files and usage history.

Use `penguin tools --help` to see which commands your Project’s plugins provide, and `penguin tools list` to inspect the bindings. Input and output paths refer to the machine running the CLI, including when the server is remote. For example, `penguin tools image "A penguin by the sea" --out penguin.png` saves a generated image, and `penguin tools stt meeting.wav` prints the transcript. Add `--detach` to start a long run, then use `penguin tools status` or `penguin tools cancel` with its ID.

`penguin tools usage` shows the model, operation, reported token counts and observed units. `penguin tools artifacts` lists generated files. From an Agent terminal, both commands default to the calling Session. Tool and transcript-editing requests carry that same Session ID to MMSP for provider cache routing.

DeepSeek ASR is available through DeepSeek and TokenDance. In an existing Project, use **Add new models** in the model library to add the TokenDance preset. Choose the provider in Project settings and upload a 16-bit PCM WAV or an Ogg Opus recording. Penguin checks the format before calling the provider. Model connection tests send a short built-in speech sample to transcription models.

Project tool models share a single `[tools]` table. The vision proxy uses `i2t`, and enabling transcript editing uses `t2t`. Existing bindings migrate on first read. The default chat model is selected separately. [Project tool model migration](2026-11-19-backward-compatibility.md)

Project owners can edit the instructions for polishing voice transcripts and restore the built-in prompt at any time. For supported models, transcript editing asks the model to skip reasoning or use its lowest supported level.

A dedicated image, video, speech or web tool can be assigned to its own operation. New chats use a model that supports conversation.

The tool catalog also includes seller rates for transcription, speech synthesis, image and video generation, and web requests in their original billing units.
