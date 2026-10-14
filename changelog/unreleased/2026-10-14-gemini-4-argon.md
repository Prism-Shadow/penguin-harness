# Gemini 4 Argon in Google, Penguin Go and OpenRouter

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `cli`, `docs`
- **PR:** [#1127](https://github.com/Prism-Shadow/penguin-harness/pull/1127)

[中文版](2026-10-14-gemini-4-argon.zh.md)

Added Gemini 4 Argon presets to Google, Penguin Go and OpenRouter, and upgraded MMSP to 0.5.3.

## Models and prices

- Google and Penguin Go use `gemini-4-argon`; OpenRouter uses `google/gemini-4-argon`. All three accept images and share a 1,048,576-token input/output window.
- Google and OpenRouter record list prices of $4 input, $20 output and $0.20 cached input per million tokens, with a 50% introductory discount through November 30, 2026.
- Penguin Go records $2 input, $10 output and $0.10 cached input per million tokens as its list prices. Any further promotion comes from the platform on connection or **Sync models**.
- MMSP 0.5.3 maps Argon's thinking levels on Google's clients: `none` to `low`, `xhigh` and `max` to `high`, with `low`, `medium` and `high` unchanged. Synchronous output supports up to 65,536 tokens, including thinking.

## Existing Projects

Use **Add new models** on the models page to add the presets. Existing models, credentials, group settings and the default model stay as configured.
