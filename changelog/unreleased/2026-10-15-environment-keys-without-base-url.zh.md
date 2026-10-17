# 厂商环境变量只用于不带 base URL 的模型

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#1166](https://github.com/Prism-Shadow/penguin-harness/pull/1166)
- **Breaking:** yes — 发往 Project 配置里 base URL 的模型从不使用环境变量里的 key，厂商自己的端点也不例外；`PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` 不再读取

[English](2026-10-15-environment-keys-without-base-url.md)

无 key 的模型是否使用厂商环境变量（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY` 等），现在只按一条规则、只从 Project 配置判定。core 不再读取目录数据或任何环境变量来判断请求发往哪里。

## 规则

- 模型的 base URL、协议与 API key 各自从文件解析：先取模型自己的值，再取所在分组 `[providers.<id>]` 的值。分组密钥只借给没有自己 base URL、或自己的 base URL 与分组同 origin 的模型，与此前相同。
- 没有 key、且模型与分组都不带 base URL 的模型不交给客户端任何值：它路由到的 MMSP 客户端自行读取 `*_API_KEY` 与 `*_BASE_URL`，key 与端点都来自服务端环境。
- 没有 key、却要发往文件里 base URL 的模型，在任何请求之前以「has no API key」拒绝，无论环境里有什么、URL 指向哪个端点。提示会写出该 URL 与两种解决办法：把 key 写进文件；或在模型固定了协议时，清掉 base URL 并设置厂商的 `*_API_KEY`（端点不是客户端缺省端点时一并设置 `*_BASE_URL`）。协议为 `mmsp` 且有 base URL 的模型仍不带 key 发出，即开放的 MMSP 服务器。
- 要用环境变量访问厂商的第二个主机（bigmodel.cn、moonshot.ai、minimaxi.com）、代理或 Bedrock，就让 base URL 留空，在 key 旁设置厂商的 `*_BASE_URL`。

## 随之调整

- 新建 Project 不为七个一方厂商分组（DeepSeek、Google、OpenAI、Anthropic、Z.AI、Moonshot、MiniMax）写分组表，组内无 key 的模型因此读取厂商变量。网关的分组表带 base URL，组内模型须在文件里有 key。
- custom、vLLM 或自建分组里任何一层都不带 base URL 的模型，读取其协议客户端的变量对（OpenAI 兼容协议为 `OPENAI_*`）。变量已设置时模型库页面会显示它，模型弹窗还会说明请求发往该客户端的缺省端点，设置了 `OPENAI_BASE_URL` 时发往它。
- `GET /models`、模型弹窗的提示、分组设置的提示、机器同步的报告与 `penguin config model list` 只为没有 key、且任何一层都不带 base URL 的模型给出变量名；分组设置的提示只用于不带 base URL 的分组。
- 新增分组时的端点模型列表与协议检测总有 URL，因此从不读取环境变量：没有 key 的列表请求被拒绝（MMSP 服务器除外），没有 key 的协议检测匿名探测。
- DeepSeek 余额只在分组既无分组密钥、也无 base URL 时使用 `DEEPSEEK_API_KEY`；网关查询余额从不借用环境变量。
- 模型弹窗里 zhipu 与 moonshot 的提示改为：厂商第二个主机的 key 配合 `ZAI_BASE_URL` / `MOONSHOT_BASE_URL` 使用。

## Penguin Go 与 ModelScope

二者只从分组的连接信息取 key。会话、探测、协议检测与余额查询都不再读取 `PENGUIN_GO_API_KEY` 与 `PENGUIN_GO_BASE_URL`。无 key 的 Penguin Go 模型不带 key 发往中转端点。终端仍从环境中剥除这两个名字。

## SDK

- `resolveEntryCredential(entry, group, override?)` 不再接收环境变量：要么什么都不交出，要么返回文件里的 key，要么抛出 `ModelCredentialError`。
- `effectiveConnection` 对没有 key、任何一层都不带 base URL 的模型报告 `apiKeySource: "env"`，对没有 key 而带 base URL 的模型报告 `"none"`。
- `listEndpointModels` 只接受调用方传入的 key；没有 key 也没有 base URL 时，像会话一样不交给客户端任何值。
- 移除了 `resolveModelCredential`、`modelEnvFallback`、`resolveProviderModelEnv`、`endpointEnvApiKey` 与 `VENDOR_ENDPOINTS`。`ProviderConnection` 没有 `official` 字段，也从未发布过。
- `modelEnvPreviewKey(entry, group)` 接收模型自己的值（含 key）与分组表；`providerEnvFallbackKey(providerId, group)` 只为不带 base URL 的分组给出变量名。
- 连接规则位于不含 Node 依赖的子路径 `@prismshadow/penguin-core/model-connection`：`MMSP_CLIENTS`、`canonicalClientType`、`sameEndpoint`、`effectiveConnection`、`groupKeyReaches`、`keylessEndpoint`（改为 `(clientType, baseUrl)`）、`resolveEntryCredential` 与 `ModelCredentialError`。根入口仍然导出它们。

## 兼容性

- 无 key、却把厂商自己的端点写成文件里的 base URL、依赖厂商环境 key 的模型会被拒绝。DeepSeek 与 MiniMax 预设曾写入厂商 URL 的版本创建的 Project，由服务端一次性迁移，见[兼容记录](2026-10-15-backward-compatibility.zh.md)。你自己填写的 URL，请把 key 填到模型或分组上；或在分组或模型设置里清掉 base URL，端点不是客户端缺省端点时在 key 旁设置厂商的 `*_BASE_URL`。
- custom、vLLM 或自建分组里任何一层都不带 base URL 的模型，现在使用 `OPENAI_API_KEY`，发往 `OPENAI_BASE_URL` 或 api.openai.com。要它访问你自己的服务器，请给它 base URL 与 key。
- 只设置了 `PENGUIN_GO_API_KEY` 的用户，请在分组标题栏重新连接 Penguin Go，或把 key 粘贴到分组设置里。
- SDK 中调用 `listEndpointModels` 的代码需自行传入 key；调用 `resolveEntryCredential` 的代码去掉第四个参数；调用已移除函数的代码改用 `resolveEntryCredential` 或 `effectiveConnection`。
