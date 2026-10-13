# 网关为自身上游故障回的 4xx 不再终结该轮

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1103](https://github.com/Prism-Shadow/penguin-harness/pull/1103)

[English](2026-10-13-server-side-4xx-is-not-fatal.md)

`isFatalProviderRejection` 原先只看状态码：除 408 与 429 外的任何 4xx 都算作对请求本身的确定性拒绝，于是该轮直接停下，而不是走重试阶梯。但 provider 前面的网关并不遵守这个约定——它会用随手挑的一个 4xx 来回答自己上游的故障。

## 现在的判定

只有当 provider 自己的载荷既不声明服务端故障、又不为空时，4xx 才算 fatal。判状态码之前，先沿 `cause` 链逐层读两类信号：

- **provider 的代码**，指明故障在 provider 自身——`server_error`、`api_error`、`upstream_error`、`internal_error`、`service_unavailable`、`overloaded_error`、`no_available_workers`——沿用既有的 `providerSignals`，从错误对象与其解析后的 body 上读取。
- **消息形态**，用于没有代码留下来的情形：`[server_error]` 这类方括号、`Upstream response was not valid JSON`、`Model is unavailable`，以及 `(upstream|provider|service) (is) temporarily unavailable`。
- **空的 provider body**——SDK 的 `NNN status code (no body)`——其中没有任何能支持停下该轮的依据。

其余情形保持原行为，真正的拒绝仍在第一次尝试就是 fatal：`413 … Request body exceeds the 4.5 MiB limit` 与 `400 … No function call found for function call output` 都仍是 fatal，401 也仍经由 `isAuthenticationError` 在这项检查之前结束。

## 细节

- 新增 `SERVER_SIDE_CODES`、`SERVER_SIDE_TEXT`、`declaresServerSideFailure` 与 `hasEmptyProviderBody`；`isFatalProviderRejection` 先咨询它们，再落回原有的状态码判定。
- `packages/core/test/llm.test.ts` 用十例钉住这条边界：七例必须保持可重试的真实网关载荷，以及必须保持 fatal 的真实拒绝与链式／结构化信号。
