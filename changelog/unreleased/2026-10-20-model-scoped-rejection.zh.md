# Provider 说"是模型的问题"时，run 以 `model_unavailable` 收场

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `core`

[English](2026-10-20-model-scoped-rejection.md)

Provider 的 4xx 过去被当成一件事：确定性拒绝（`error_code: "rejected"`）。但并不是每个 4xx 拒的是**请求**，有的是拒**模型**："Upstream request failed: Model is unavailable."（网关包着一条断掉的上游）、"no available channel"（这个模型没有可用通道）、"All routed providers rejected the request"（聚合器试完所有路由都空）。请求本身没问题，是这个模型接不了，而且同样的请求在这个模型上永远不会成功。

## 改动

`GenerativeModel` 现在把两者分开。当 Provider 自己的载荷——报错正文、解析出的 body、或错误 cause 链上的结构化 code——点名了模型或它的路由时，这一轮以 `error_code: "model_unavailable"` 收场，而不是 `"rejected"`。

run 照样停下（在这个模型上没什么可重试的），但原因被点名了：手上有别的模型可跑的主机就能把会话挪过去——和限流走的是同一条路。而拒的是请求自身内容的那类（体积上限、tool call 配对、参数缺失、额度耗尽）仍然是 `"rejected"`：换个模型同样会被拒，挪会话只会白烧一条链。
