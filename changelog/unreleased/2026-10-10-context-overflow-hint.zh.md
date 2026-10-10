# 上下文超限时提示下一步怎么做

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`

[English](2026-10-10-context-overflow-hint.md)

请求超出模型的上下文窗口时，以前只显示 Provider 的原始报错，例如 llama.cpp 的 `400 request (100091 tokens) exceeds the available context size (98304 tokens), try increasing it`。现在这类错误有了专属错误码，对话里会说明出路。

- LLM 层在 Provider 的 4xx 拒绝中识别 llama.cpp、OpenAI、Anthropic、DeepSeek、vLLM、Gemini 等的上下文超限措辞，以 `fatal` + `error_code: context_overflow` 收尾。
- Web App 的错误行下方加一行提示：用 **/model** 换一个上下文更大的模型，开新会话继续本对话；并到**模型库**检查这个模型的**上下文窗口**是否大于服务端实际支持的长度——设置偏大时，自动压缩会来不及触发。
- CLI 打印同样的提示。`/switch-model` 会先在当前模型上压缩，同样会超限，所以 CLI 的提示改为用上下文更大的模型新开一次 `penguin chat`。
