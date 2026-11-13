# vLLM 改读自己的变量，并默认连接本地服务

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `model-catalog`, `server`, `web`, `docs`
- **PR:** [#1288](https://github.com/Prism-Shadow/penguin-harness/pull/1288), [#1316](https://github.com/Prism-Shadow/penguin-harness/pull/1316)
- **Breaking:** yes — 任何一层都不带 base URL 的 vLLM 模型改发往 `VLLM_BASE_URL` 或 `http://127.0.0.1:8000/v1`，不再发往 `OPENAI_BASE_URL` 或 OpenAI，并改读 `VLLM_API_KEY`，不再读 `OPENAI_API_KEY`

[English](2026-10-22-vllm-local-default.md)

vLLM 分组不再读取 OpenAI 的环境变量。MMSP 的 vLLM 客户端改用自己的凭据（MMSP [#276](https://github.com/Prism-Shadow/model-message-stream-protocol/pull/276)），随 MMSP 0.5.5 发布；PenguinHarness 现在依赖该版本。

## 变更内容

- vllm 分组的变量改为 `VLLM_API_KEY` 与 `VLLM_BASE_URL`，即 MMSP 的 `openai-chat-vllm-adapter` 客户端读取的变量。任何一层都不带 base URL 时，缺省端点为 `http://127.0.0.1:8000/v1`，即 `vllm serve` 默认端口上的地址。带 base URL 而没有 key 时，客户端不带 key 调用服务端（发送 vLLM 的占位 key `EMPTY`），不再拒绝。
- 每条 vLLM 预置都以 `http://127.0.0.1:8000/v1` 为 base URL。新建 Project 只存一次，写进 `[providers.vllm]` 的 `base_url`，与协议放在一起；预置模型和手动添加的模型因此无需任何设置，就能连上同一台机器上启动的 vLLM 服务。对没有 vllm 分组表的 Project 执行「添加新模型」，以及「恢复默认」，都写入同一张表；恢复默认会把指向别处的 vLLM 分组改回这个本地地址。
- 模型弹窗里给任何一层都不带 base URL 的模型的说明，改为写明请求发往的端点，端点取自 MMSP 的凭据表。文案为「请求发往 https://api.openai.com/v1；环境里设置了 OPENAI_BASE_URL 时改发往该地址」（en："Requests go to https://api.openai.com/v1, or to OPENAI_BASE_URL when it is set"）。目录的 `modelEnvironment` 在 `baseUrlEnv` 旁以 `defaultBaseUrl` 报告这个端点。
- 留空的 base URL 输入框的占位文字，见 [base URL、API key 与价格留空时说明会发生什么](2026-10-24-model-field-placeholders.zh.md)。
- 配置、模型、CLI 与桌面端快速上手文档写明了 vllm 分组的变量、本地 base URL 与不带 key 的调用。

## 兼容性

- 不会改写已有 Project 的配置。其 vllm 分组保留现有的表，通常只有协议。
- 自身与分组都不带 base URL 的 vLLM 模型，现在发往 `VLLM_BASE_URL`，未设置时发往 `http://127.0.0.1:8000/v1`，并读取 `VLLM_API_KEY`；不再使用 `OPENAI_BASE_URL` 或 `OPENAI_API_KEY`。如果你之前靠 `OPENAI_BASE_URL` 连到 vLLM 服务，请在 vllm 分组的设置里把它的地址填为 base URL，或设置 `VLLM_BASE_URL`。如果该服务用 `--api-key` 启动，请把 key 填在分组上；不设 base URL 时也可以放进 `VLLM_API_KEY`。
- 带 base URL 而没有 key 的 vLLM 模型，现在不带 key 调用，之前会被拒绝。
