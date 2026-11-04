# 环境变量里的 key 按 MMSP 的规则使用

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#1166](https://github.com/Prism-Shadow/penguin-harness/pull/1166)
- **Breaking:** yes — 无 key 的模型指向厂商的第二个官方主机时，不再使用厂商的环境变量；`PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` 不再读取；SDK 的凭据辅助函数已替换

[English](2026-10-15-environment-keys-follow-mmsp.md)

无 key 的模型是否使用厂商环境变量（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY` 等），改由 MMSP 一家决定，自 MMSP 0.5.4 起生效；该版本包含 MMSP [#258](https://github.com/Prism-Shadow/model-message-stream-protocol/pull/258)，harness 随之要求这一版本。PenguinHarness 从 Project 配置解析每个模型的 key、base URL 与协议，原样交给 MMSP；它不读取任何环境变量来判断请求发往哪里，自己也不拒绝任何请求。

## 规则

- 模型的 base URL、协议与 API key 各自从文件解析：先取模型自己的值，再取所在分组 `[providers.<id>]` 的值。分组密钥只借给没有自己 base URL、或自己的 base URL 与分组同 origin 的模型，与此前相同。
- MMSP 的客户端拿到 key 就用它。没有 key 时，只有未传 base URL，或传的就是它自己的缺省端点（`https://api.deepseek.com`、`https://api.minimax.io/v1`、`https://api.anthropic.com` 等，末尾斜杠与主机大小写不计）时，它才读取自己的 `*_API_KEY`。未传 base URL 时，端点取它的 `*_BASE_URL`，没有则取该缺省端点。
- 没有 key、却传了其他 base URL 时，客户端在任何请求之前拒绝。PenguinHarness 把这次拒绝显示为「Model `<id>` has no API key for `<URL>`」，写出该客户端的 `*_API_KEY` / `*_BASE_URL` 与两种做法：把 key 写进文件；或清掉 base URL 并设置这两个变量。协议为 `mmsp` 且有 base URL 的模型仍不带 key 发出，即开放的 MMSP 服务器。
- 要用环境变量访问厂商的第二个主机（open.bigmodel.cn、api.moonshot.ai、api.minimaxi.com）、代理或 Bedrock，就让 base URL 留空，在 key 旁设置厂商的 `*_BASE_URL`。

## 随之调整

- 新建 Project 不给七个一方厂商分组写分组表，组内无 key 的模型因此读取厂商变量；写了厂商缺省端点的分组或模型同样读取。网关的分组表带其 base URL，组内模型须在文件里有 key。
- `GET /models`、模型弹窗的提示、分组设置的提示、机器同步的报告与 `penguin config model list` 都向 MMSP 的 credentials 模块询问模型读取哪个变量，所以写出的正是会话的客户端读取的变量。弹窗中「请求发往客户端缺省端点或其 `*_BASE_URL`」的说明，只对任何一层都不带 base URL 的模型显示。
- custom、vLLM 或自建分组里任何一层都不带 base URL 的模型，读取其协议客户端的那对变量（OpenAI 兼容协议为 `OPENAI_*`）；该变量已设置时，模型库页面会显示它。
- 协议检测的每次探测，只在 URL 是该协议客户端的缺省端点时，使用它读取的变量。添加分组时的端点列表请求把 key 与 URL 原样交给 MMSP。
- DeepSeek 的余额查询在分组没有分组密钥、且没有 `https://api.deepseek.com` 以外的 base URL 时使用 `DEEPSEEK_API_KEY`。网关从不为余额借用环境变量。
- 会话创建与恢复会在 Workspace 与 Trace 出现之前先构建模型的客户端，因此 MMSP 的拒绝在创建时就以 `model_credential_missing` 呈现。
- 移除了 harness 为旧客户端类型名 `gemini-official` 与 `gemini-generate-content` 保留的条目：MMSP 的 credentials 模块会解析它们，存有旧名的 Project 照常工作，变量、路径与快速模式都不变，直到 MMSP 去掉该别名的版本（[0.2.15 条目](../0.2.15/2026-10-10-backward-compatibility.zh.md)）。

## Penguin Go 与 ModelScope

二者只从分组的连接信息取 key。会话、探测、协议检测与余额查询都不再读取 `PENGUIN_GO_API_KEY` 与 `PENGUIN_GO_BASE_URL`。无 key 的 Penguin Go 模型不带 key 发往其中转。终端仍会从环境中去掉这两个变量名。

## SDK

- `resolveEntryCredential(entry, group, override?)` 原样返回文件里的 key、base URL 与客户端类型，不抛出任何错误。MMSP 的拒绝在构建客户端时以 `ModelCredentialError` 呈现。
- `effectiveConnection` 的 `apiKeySource` 只有 `"model"`、`"provider"`、`"none"` 三种；文件里没有 key 的模型为 `"none"`，无论 MMSP 如何处理它。
- `listEndpointModels` 把调用方给的 key 与 base URL 原样交给 MMSP。
- 目录的 `modelEnvironment(entry, group)`、`modelEnvPreviewKey(entry, group)`、`providerEnvFallbackKey(providerId, group)` 与 `clientEnvKey(clientType, baseUrl)` 经 MMSP 的 `environmentCredential` 给出变量名。`routedClientType` 是 MMSP 的，原样转出，无法路由时返回 `null`。`CLIENT_PROTOCOLS` 记录每种客户端类型的请求路径与快速模式协议，`vendorClientType` 给出一方厂商分组的官方客户端。
- 移除：`resolveModelCredential`、`modelEnvFallback`、`resolveProviderModelEnv`、`endpointEnvApiKey`、`resolveModelEnv`、`VENDOR_ENDPOINTS`、`MMSP_CLIENTS` 与 `keylessEndpoint`。`ProviderConnection` 没有 `official` 字段，也从未发布过。
- `@prismshadow/penguin-core/model-connection` 是可在浏览器中使用的子路径，只含连接规则：`effectiveConnection`、`groupKeyReaches`、`resolveEntryCredential`、`providerConnectionShape`、`canonicalClientType`、`sameClientType` 与 `sameEndpoint`。根导出仍包含它们。

## 兼容性

- base URL 为厂商第二个官方主机（`https://open.bigmodel.cn/api/paas/v4`、`https://api.moonshot.ai/v1`、`https://api.minimaxi.com/v1`）的无 key 模型会被拒绝，不再使用 `ZAI_API_KEY`、`MOONSHOT_API_KEY` 或 `MINIMAX_API_KEY`。请把 key 写到模型或其分组上，或清掉 base URL，在 key 旁把厂商的 `*_BASE_URL` 设为该主机。
- 只设置过 `PENGUIN_GO_API_KEY` 的用户，请在 Penguin Go 的分组标题栏重新连接，或把 key 粘贴到分组设置里。
- 调用已移除函数的 SDK 代码改用 `resolveEntryCredential` 或 `effectiveConnection`，变量名改用目录的 `modelEnvironment`。把 `routedClientType(...)` 与 `undefined` 比较的代码改为与 `null` 比较，从 `effectiveConnection` 读取 `apiKeySource === "env"` 的代码改问 `modelEnvPreviewKey`。
