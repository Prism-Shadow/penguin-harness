# Multimodal tools: the Project's models for text, images, video, speech and the web

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `plugins`, `server`, `web`
- **PR:** [#1597](https://github.com/Prism-Shadow/penguin-harness/pull/1597)

[中文版](2026-11-18-project-model-tools.zh.md)

The built-in **Multimodal tools** plugin (`@penguinharness/multimodal-tools`) lets an Agent and the Web App use the Project's models for eight tools: text generation, image understanding, web search, page fetching, image, video and speech generation, and speech recognition. It is a plugin over the model-tool platform ([#1639](https://github.com/Prism-Shadow/penguin-harness/pull/1639)): the platform names no tool, and the plugin carries the commands, the routes, the Skill and the result files.

## Bindings

- The plugin declares seven tool-model bindings, one `[tools]` key per tool: `t2t`, `search`, `fetch`, `t2i`, `t2v`, `t2s` and `s2t`. An owner binds a configured model to each through `PATCH /api/projects/:projectId/models/tool-bindings`; a picker offers only the models a tool can use, judged by the client MMSP routes the model to and the modalities its registry lists.
- Image understanding has no binding: it runs on the Project's vision model (`vision_model`), unchanged.
- Transcript editing for dictation shares the `t2t` model. Whether it is on, and its prompt, are the plugin's per-Project settings, kept in the plugin's folder of the Project.

## Enabled in every Project

- The plugin is preinstalled. Its card says `preinstall: true`, and a built-in plugin with server modules whose card says so runs for every Project without a `[plugins]` listing, so its bindings and routes are there as soon as the server ships it. This holds until preinstalled built-in modules are listed in Project config ([#1642](https://github.com/Prism-Shadow/penguin-harness/pull/1642)), which then takes over and lets an administrator stop the module.

## Connection test

- **Test connection** on a model a binding accepts sends that binding's own request instead of the chat prompt: half a second of a generated tone (16 kHz PCM WAV) to a speech recognizer, the project's site (`https://penguin.ooo/`) to a page reader, a one-result query to a search model, "OK." to a speech model, one 1K square image to an image model, and one 4-second 360p clip to a video model, which may take up to three minutes. Each is the cheapest request of its kind, sent without the chat prompt's thinking level, output cap or fast mode. A chat model is still tested with the chat prompt.
- A binding names its request in its code half (`testRequest()` beside `accepts(model)`); the platform sends the request of the first binding in load order that names one and accepts the model.

## `penguin tools`

- The tools are member commands of the plugin, run on the server for the caller's Project and Session: `penguin tools t2t|i2t|search|fetch|t2i|t2v|t2s|s2t`, plus `list`, `status <id>` and `cancel <id>`. Any member of the Project can run them.
- A local file reaches a tool only through `--image` or `--audio`, read and sent by the terminal; generated files come back into `--out` (default: the current directory), never over an existing file.
- A run in a Session that takes more than four minutes goes on in the Session and prints its id; `--detach` returns the id at once. `status` reports it and saves its files with `--out`; `cancel` stops it.

## Results and usage

- What a tool generates belongs to its Session: it is stored under `<project>/.multimodal-tools/sessions/<session>/`, listed and downloaded through the plugin's routes under `/api/projects/:projectId/multimodal-tools/`, and removed once the Session is gone (a sweep at boot and once a day). A run with no Session stores nothing.
- Every request goes through the platform's `ProjectModelRequests`: one `usage_records` row per request, under the purpose `@penguinharness/multimodal-tools:<tool>` (`…:polish` for transcript editing), billed to the calling Session and priced like a chat request.

## Tool models in the catalog

- Twenty image, video, speech, transcription and web models join the catalog as ordinary rows priced as MMSP's registry prices them (the provider's billing units folded into MMSP's token buckets): Gemini 3.1 Flash (Lite) Image, Gemini 3.8 Flash (Lite) TTS, Gemini Omni 1.2 Flash, GPT Image 2.5 Flare, DeepSeek Search, Fetch, TTS and ASR (DeepSeek's and TokenDance's), Jina Search and Reader, Seedream 5.5, 5.0 Flash and 5.0 Lite, and Fish Audio Drama 3 and Transcribe 1. The Gemini image and speech rows are unpriced, as MMSP's registry leaves them. Existing Projects get them through **Add new models**.
- A catalog row marked as a tool model reads `chatEligible: false` in `GET /models`, and the chat model picker no longer offers it.
