# 发往 OpenCode 的请求带上 Session id

- **Date:** 2026-09-14
- **Type:** feature
- **Scope:** `core`
- **PR:** [#612](https://github.com/Prism-Shadow/penguin-harness/pull/612)

[English](2026-09-14-opencode-session-header.md)

发往 OpenCode 网关的请求现在会说明自己属于哪一场对话。该网关以 `x-opencode-session` 请求头为键做后端路由，
要求同一场对话的各次请求给出同一个值；`attributionHeaders` 为此送出本 Session 自己的 id，与它已经发给
OpenRouter 和 TokenDance 的应用归属信息并列。

## 细节

- **id 来自 Session，经 `GenerativeModelConfig.sessionId` 传入。** 三处 `GenerativeModel` 构造点都已串起
  ——模型上下文自己的 LLM 对象、承载生成标题等 meta 请求的裸 LLM，以及视觉描述器——因此同一个 Session 发出的
  一切请求都带同一个值，上下文轮换也不会改变它。
- **由端点主机决定，与另外两套方案一致。** 匹配以后缀锚定在 `opencode.ai` 上，网关的子域算数，形似的域名不算。
  内置模型目录中没有指向 OpenCode 的条目；请求头是经由填了该 `base_url` 的 `custom` 模型条目送上线的。
- **没有 Session id 就不发这个请求头。** 缺失时不以任何值顶替——固定常量会让所有对话在网关那里归入同一个 session。
- OpenRouter 的三个请求头与 TokenDance 的 `X-App-URL` 不受影响，无论手上有没有 Session id。
