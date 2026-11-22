# 服务端的 HTTP 词汇与模型域现改由 library 包提供

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1621](https://github.com/Prism-Shadow/penguin-harness/pull/1621)

[English](2026-11-19-backward-compatibility-library-restack.md)

服务端的 HTTP 词汇（统一的错误形状、请求校验、JSON 应答规则、公共源与页面 CSP 及相关辅助件）移入新的 `@prismshadow/penguin-library-http` 包，模型目录与模型密钥授权流程的各服务移入 `@prismshadow/penguin-library-model`。本批次没有其他行为变化：搬动的代码就是原来那份代码，只是换了地址。

旧的导入路径照旧可用，分两种情况：

- **包子路径**——之前就存在的 `@prismshadow/penguin-server/model-catalog`、`@prismshadow/penguin-server/api`——仍导出被搬走的那些名字，由 library re-export。按这些包路径引用的代码不需要改动。
- **仓内源码转发**——被搬模块的消费者仍在引用的 server 源码文件（`packages/server/src/http/errors.ts`、`packages/server/src/http/validate.ts`、`packages/server/src/services/platform-auth-types.ts` 及 `services/*-service.ts` 各装配文件）——re-export 或转发到 library。仓内按这些路径引用的代码照常解析。

其余大部分旧源码文件已经删除：留下的只有上面列出的转发，其余地方现在都直接从 library 包导入。`services/platform-auth-types.ts` 就是这些转发之一——它携带的形状在 library 的 `platform-auth-flow` 里单源维护，文件本身只做 re-export。

### 你需要做什么

如果你导入这些模块，请改为从 library 包导入——`@prismshadow/penguin-library-http` 与 `@prismshadow/penguin-library-model`。新路径才是这些模块现在的住址；这些转发只为仓内尚未迁移的导入而留。

### 期限

剩余的转发会在 penguin v0.3 与仍经过它们的仓内导入一起删除。之后，再从 `@prismshadow/penguin-server` 或旧的 server 源码路径导入被搬走的模块会直接失败；请从它的 library 包导入。
