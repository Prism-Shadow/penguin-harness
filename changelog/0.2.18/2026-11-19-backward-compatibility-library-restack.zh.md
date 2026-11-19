# 服务端的 HTTP 词汇与模型域现改由 library 包提供

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1621](https://github.com/Prism-Shadow/penguin-harness/pull/1621)

[English](2026-11-19-backward-compatibility-library-restack.md)

服务端的 HTTP 词汇（统一的错误形状、请求校验、JSON 应答规则、公共源与页面 CSP 及相关辅助件）移入新的 `@prismshadow/penguin-library-http` 包，模型目录与模型密钥授权流程的各服务移入 `@prismshadow/penguin-library-model`。本批次没有其他行为变化：搬动的代码就是原来那份代码，只是换了地址。

旧的导入路径暂时照旧可用。每个被搬走的模块都从它在 `@prismshadow/penguin-server` 下的原地址（`/http/errors`、`/http/validate`、`/model-catalog` 等）re-export，按旧路径引用的代码不需要改动就能继续运行。

### 你需要做什么

如果你从 server 包导入这些模块，请改为从 library 包导入——`@prismshadow/penguin-library-http` 与 `@prismshadow/penguin-library-model`。新路径才是这些模块现在的住址；旧路径只是转发。

### 期限

这些 re-export 条目会在 penguin v0.3 删除。之后，再从 `@prismshadow/penguin-server` 导入被搬走的模块会直接失败；请从它的 library 包导入。
