# OpenRouter 的每个模型都改走 Responses API

- **Date:** 2026-09-12
- **Type:** feature
- **Scope:** `core`, `web`, `cli`, `docs`, `model-catalog`
- **PR:** [#705](https://github.com/Prism-Shadow/penguin-harness/pull/705)

[English](2026-09-12-catalog-openrouter-responses.md)

内置目录中的 OpenRouter 预置条目全部改用 AgentHub 的通用 Responses 客户端
（`client_type = "openai-responses"`），OpenRouter 分组本身也固定同一协议，因此手工添加进该分组的
模型同样走这个协议。

## 细节

- 43 条 OpenRouter 目录条目全部固定 `openai-responses`。此前只有十条 `openai/*` 条目如此，其余
  都带的是 `openai-chat`。预置 base URL 不变——OpenRouter 为其转售的每一个上游模型都在
  `{base}/responses` 上提供 Responses API。
- `MODEL_PROVIDERS` 中的 `openrouter` 条目新增了分组级 `clientType`，沿用 vLLM 分组已有的机制。
  对于目录中没有对应条目的 id，`penguin config model add --provider openrouter` 与 Web App 的
  新增模型对话框都会写入 `openai-responses`。
- 新增模型对话框的协议提示区分了「固定协议的网关分组」与「固定协议的自建分组」：对 OpenRouter 提示
  base URL 已预填网关端点，而不再要求填写用户自己的服务地址。
- 文档站的模型页中英双语同步重写。
- 已有 Project 保持已存内容不变。预置条目是在 Project 创建时写入 `.project_config.toml` 的，此后
  没有任何机制会改写它们，因此已存的 OpenRouter 条目仍是 `openai-chat`，直到其所有者在模型页点击
  **同步预置**——该操作会重写目录持有的字段（协议也在其中），并且不触碰凭证。在此之前，这些条目会
  被同步徽标计入。
