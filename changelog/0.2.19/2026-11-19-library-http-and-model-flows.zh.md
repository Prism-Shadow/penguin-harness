# 服务器的 HTTP 词汇与模型域的授权流程下沉为 library 包

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `server`, `library/http`, `library/model`, `web`
- **PR:** [#1621](https://github.com/Prism-Shadow/penguin-harness/pull/1621)

[English](2026-11-19-library-http-and-model-flows.md)

每条路由共享的那些件有了自己的家，模型域的三个授权流程也搬到了服务它们的 catalog 旁边。新包 `@prismshadow/penguin-library-http` 收下 HTTP 词汇：统一错误形状、请求校验助手、JSON 应答规则、public origin 与页面 CSP、删除路由的收敛等待、错误→Project 归因，以及 auth middleware 填充的 `AppEnv` 类型。`@prismshadow/penguin-library-model` 收下内置模型 catalog（Web App 本就经由服务器的 `model-catalog` 子路径引用的浏览器安全词汇）、三个密钥授权流程的 service 与 capability 接口、流程 wire 形状，以及两个平台 origin 校验器。

服务器引用它们；library 里的任何代码不引用服务器，且各 library 包的 manifest 无环。包子路径（`@prismshadow/penguin-server/model-catalog`、`@prismshadow/penguin-server/api`）与仍在使用的仓内转发——`http/errors.ts`、`http/validate.ts`、`services/platform-auth-types.ts`（library `platform-auth-flow` 的纯转发，它原来定义的形状单源在 library）——保住旧 import 路径；其余旧源码文件已删除，其导入方直连 library。Platform 与 ModelScope 的 Provider 留在服务器：它们读 `Config` capability，那是服务器的装配面。四条模型路由与 `config-model` CLI 命令也留下，骑在尚未迁移的运行时机制上；随后续切片走。

## 细节

- `library/http`（新）：`errors`（随迁 `ErrorBody`/`ErrorDetails`）、`app-env`、`validate`（通用助手；Session 域的检查留在服务器、随其类型走）、`media-type`、`json-answer`、`json-compression`、`json-validators`、`public-origin`、`page-csp`、`settle`、`attribution`。
- `library/model` 扩：`model-catalog/`（catalog、client-protocols、env-keys、seed）、`model-oauth-service`、`modelscope-auth-service`、`platform-auth-service`（service 与 capability；Module Provider 留服务器）、`platform-auth-flow`（流程 wire 形状，`services/platform-auth-types.ts` 的单源后继）、`origins`。
- client-protocol 表补上 MMSP 0.5.10 的客户端行（`openai-image`、`openai-speech`、`openai-transcription`、`deepseek-webtool`、`deepseek-speech`、`deepseek-transcription`、`jina-webtool`），library 的 `mmsp` 依赖对齐 `^0.5.10`。
- `services/platform-auth-types.ts` 是纯 re-export 转发；平台 catalog 类型在 library 单源。`config.ts` 与 `api/types.ts` 对迁出的校验器与流程形状做转发。
