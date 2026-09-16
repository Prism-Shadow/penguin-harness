# 协议检测能认出多写或少写一个 `/v1` 的 base URL

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#729](https://github.com/Prism-Shadow/penguin-harness/pull/729)

[English](2026-09-15-url-tolerant-protocol-detection.md)

## 变更内容

- 自定义模型的协议检测不再逐字使用填入的 base URL。先整理：去掉末尾斜杠、query 与 fragment，剥掉粘进来的端点路径（`/chat/completions`、`/completions`、`/responses`、`/messages`、`/v1/messages`），把连续重复的 `/v1` 合并为一个；按整理后的地址探测，再用它去掉或补上末尾 `/v1` 的形式探测一次。每个候选都按原有顺序试三种协议（`openai-responses` → `ant-messages` → `openai-chat`），第一个被提供的即为结果——因此多写一个 `/v1`、少写一个 `/v1`、或整段从厂商文档里复制的端点 URL，都能检测出与填写完全正确时相同的协议。`POST /api/projects/:p/models/detect` 在 `detected` 之外返回实际应答的 `baseUrl`。
- Web App 模型库页的两处「检测协议」——模型对话框与新增分组对话框——在该地址与填入的不同时改写输入框，并在成功 toast 中说明（「已检测为 OpenAI Chat Completions，base URL 已整理为 https://host/v1」）。协议为空时保存仍先检测，现在会连同整理后的地址一起写入，条目因此保存在协议真正被提供的那个地址上。
