# 服务端的 HTTP 词汇与模型域现改由 library 包提供

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1621](https://github.com/Prism-Shadow/penguin-harness/pull/1621)

[English](2026-11-19-backward-compatibility-library-restack.md)

服务端的 HTTP 词汇（统一的错误形状、请求校验、JSON 应答规则、公共源与页面 CSP 及相关辅助件）移入新的 `@prismshadow/penguin-library-http` 包，模型目录与模型密钥授权流程的各服务移入 `@prismshadow/penguin-library-model`。本批次没有其他行为变化：搬动的代码就是原来那份代码，只是换了地址。

旧的导入路径照旧可用，分两种情况：

- **包子路径**——之前就存在的 `@prismshadow/penguin-server/model-catalog`、`@prismshadow/penguin-server/api`——仍导出被搬走的那些名字，由 library re-export。按这些包路径引用的代码不需要改动。
- **仓内源码路径**——被搬模块原来所在的 server 源码文件（`packages/server/src/http/errors.ts`、`packages/server/src/http/page-csp.ts` 及其同目录文件）——现在是一行 re-export 的转发文件。仓内按相对路径引用它们的代码照常解析。

`services/platform-auth-types.ts` 是唯一有意例外：该文件被删除而非转发，因为它携带的形状在 library 的 `platform-auth-flow` 里单源维护；不过该文件也已恢复为纯 re-export 转发，所以这条路径同样可解析。

### 你需要做什么

如果你导入这些模块，请改为从 library 包导入——`@prismshadow/penguin-library-http` 与 `@prismshadow/penguin-library-model`。新路径才是这些模块现在的住址；旧路径只是转发。

### 期限

这些 re-export 条目会在 penguin v0.3 删除。之后，再从 `@prismshadow/penguin-server` 导入被搬走的模块会直接失败；请从它的 library 包导入。
