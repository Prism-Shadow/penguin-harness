# 库内 skill 统一使用 `openai-chat` 作为 OpenAI 客户端类型

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `skills`
- **PR:** [#417](https://github.com/Prism-Shadow/penguin-harness/pull/417)

[English](2026-08-23-skills-teach-openai-chat-client-type.md)

`ollama`、`vllm`、`penguin-sdk` 三个 skill 在注册 OpenAI 兼容端点时写的是 `--client-type openai`，
即 AgentHub 0.4.2 之前的拼法，而 `agenthub-models` 早已把它记作废弃别名。五处全部改为 `openai-chat`
（`ollama`、`vllm` 升到 `v2`，`penguin-sdk` 升到 `v22`）。

## 细节

- `ollama` 与 `vllm` 的说明步骤和完整命令示例都做了改动；`penguin-sdk` 改的是配置流程里的可选参数
  及紧随其后的推荐写法。
- 该别名仍然可用——`canonicalClientType` 在读和写两侧都会归一化，CLI 为新的 OpenAI 路由条目本来就
  写入 `openai-chat`——所以变的是库教什么，不是既有配置的行为。
