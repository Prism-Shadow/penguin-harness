# vLLM reads its own variables and starts on the local server

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `model-catalog`, `server`, `web`, `docs`
- **PR:** [#1288](https://github.com/Prism-Shadow/penguin-harness/pull/1288), [#1316](https://github.com/Prism-Shadow/penguin-harness/pull/1316)
- **Breaking:** yes — a vLLM model with no base URL anywhere goes to `VLLM_BASE_URL` or `http://127.0.0.1:8000/v1` instead of `OPENAI_BASE_URL` or OpenAI, and reads `VLLM_API_KEY` instead of `OPENAI_API_KEY`

[中文版](2026-10-22-vllm-local-default.zh.md)

The vLLM group stopped reading the OpenAI environment. MMSP's vLLM client now takes its own credentials (MMSP [#276](https://github.com/Prism-Shadow/model-message-stream-protocol/pull/276)), released in MMSP 0.5.5, which PenguinHarness now requires.

## What changed

- The vllm group's variables became `VLLM_API_KEY` and `VLLM_BASE_URL`, the ones MMSP's `openai-chat-vllm-adapter` client reads. With no base URL anywhere, its default endpoint is `http://127.0.0.1:8000/v1`, where `vllm serve` answers on its default port. With a base URL and no key, the client calls the server keyless (vLLM's placeholder key `EMPTY`) instead of refusing it.
- Every vLLM preset row names `http://127.0.0.1:8000/v1` as its base URL. A new Project stores it once, as `[providers.vllm]`'s `base_url`, beside the protocol, so presets and models added by hand reach a vLLM server started on the same machine without any setup. "Add new models" for a Project with no vllm table and "Restore defaults" write the same table. Restore sets a vLLM group pointed elsewhere back to the local address.
- The model dialog's note for a model with no base URL anywhere names the endpoint, from MMSP's credentials table. It reads "Requests go to https://api.openai.com/v1, or to OPENAI_BASE_URL when it is set" (zh: "请求发往 https://api.openai.com/v1；环境里设置了 OPENAI_BASE_URL 时改发往该地址"). The catalog's `modelEnvironment` reports that endpoint as `defaultBaseUrl` beside `baseUrlEnv`.
- A blank base URL field's placeholder is described in [Blank base URL, API key and price fields say what a blank field does](2026-10-24-model-field-placeholders.md).
- The configuration, models, CLI and desktop quickstart docs describe the vllm group's variables, its local base URL and keyless calls.

## Compatibility

- Nothing rewrites an existing Project's config. Its vllm group keeps the table it has, usually the protocol alone.
- A vLLM model with no base URL on itself or its group now goes to `VLLM_BASE_URL`, else `http://127.0.0.1:8000/v1`, and reads `VLLM_API_KEY`. It no longer uses `OPENAI_BASE_URL` or `OPENAI_API_KEY`. If you reached your vLLM server through `OPENAI_BASE_URL`, enter its address as the vllm group's base URL in the group's settings, or set `VLLM_BASE_URL`. If that server was started with `--api-key`, put its key on the group, or in `VLLM_API_KEY` when no base URL is set.
- A keyless vLLM model with a base URL is now called without a key, where it was refused before.
