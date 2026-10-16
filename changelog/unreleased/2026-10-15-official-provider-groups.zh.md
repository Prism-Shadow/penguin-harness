# 厂商环境变量改由 Project 配置的 official 标记决定

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **Breaking:** yes — 只有 `official` 分组里不自带 base URL 的条目可用厂商环境变量，`PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` 不再读取

[English](2026-10-15-official-provider-groups.md)

无 key 的模型能否使用厂商环境变量（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY` 等），现在由 Project 配置决定。分组的 `[providers.<id>]` 表新增布尔字段 `official`，表示该分组的端点就是厂商自身端点。core 只看这个标记，不再读取目录数据来判断请求发往哪里。

## 规则

- 条目自己的 key，或能借给它的分组密钥，原样使用。
- 两者都没有时，只有所在分组 `official = true` 且条目不自带 `base_url`，才可用环境变量。分组也没有 base URL 时什么都不传，由 MMSP 的客户端自行读取其变量对（包括在 key 旁设置的 `*_BASE_URL`）；分组带 base URL 时，按生效 `client_type` 读取对应变量并显式传入，变量未设置、或没有协议可据以命名变量时拒绝。
- 其余无 key 的模型一律以「has no API key」拒绝：网关、Penguin Go、ModelScope、custom、vLLM、自建分组，以及自带 base URL 的模型（厂商自身端点也不例外）。协议为 `mmsp` 且有 base URL 的模型仍不带 key 发出。

## 由谁写入

- 新建 Project 把七个一方厂商分组标为 `official = true`：DeepSeek、Google、OpenAI、Anthropic、Z.AI、Moonshot 与 MiniMax。「同步新增模型」与「恢复默认」写入同样的分组表。
- 经模型库页面、API（`PUT /models`、`PUT /models/providers/:provider`）或 `penguin config model add --provider` 写入分组的 base URL 或协议时重新计算：base URL 为空或为该厂商官方端点之一、且协议读取厂商变量时为 `true`；这样的分组有 base URL 而无协议时，同时写入厂商官方客户端为 `client_type`。其他分组不写该键。手工改写文件里的值照常生效。
- 已有文件在服务端第一次读取时补写一次，见[数据兼容](2026-10-15-backward-compatibility.zh.md)。服务端启动时把每个 Project 的配置读一遍，升级后立即打开的会话也能看到这个标记。
- `GET /models` 在每个分组上报告 `official`，分组设置弹窗、模型弹窗的提示、掩码预览、余额查询、机器同步的报告与 `penguin config model list` 都以它为准。

## Penguin Go 与 ModelScope

二者只从分组的连接信息取 key。会话、探测、协议检测与余额查询都不再读取 `PENGUIN_GO_API_KEY` 与 `PENGUIN_GO_BASE_URL`。无 key 的 Penguin Go 模型不带 key 发往中转端点。终端仍从环境中剥除这两个名字。

## SDK

- `listEndpointModels` 只接受调用方传入的 key，环境变量是否借给某个 URL 由宿主决定。
- 移除了 `resolveModelCredential`、`modelEnvFallback` 与 `resolveProviderModelEnv`。`resolveEntryCredential` 按上述规则判定，`environmentKeyRoute` 报告判定结果，`keylessEndpoint` 改为接收 `(clientType, baseUrl)`。
- 连接规则移到不含 Node 依赖的子路径 `@prismshadow/penguin-core/model-connection`：`MMSP_CLIENTS`、`canonicalClientType`、`sameEndpoint`、`effectiveConnection`、`groupKeyReaches`、`resolveEntryCredential` 与 `ModelCredentialError`。根入口仍然导出它们。

## 兼容性

- 依赖旧规则按目的地借用环境变量、而新规则不再覆盖的无 key 模型会被拒绝：custom 或自建分组里没有 base URL 的模型，以及把厂商端点写成自己 base URL 的模型。把 key 填在模型或分组上；厂商分组里的模型也可以清掉自己的 base URL。
- 手工关掉标记、或指向代理的分组不再借出环境变量。只有端点确实是厂商自身端点时，才手工写 `official = true`。
- 只设置了 `PENGUIN_GO_API_KEY` 的用户，请在分组标题栏重新连接 Penguin Go，或把 key 粘贴到分组设置里。
- SDK 中调用 `listEndpointModels` 的代码需自行传入 key；调用已移除函数的代码改用 `resolveEntryCredential`。
