# 向后兼容

- **Date:** 2026-10-01
- **Type:** process
- **Scope:** `core`, `server`
- **PR:** [#917](https://github.com/Prism-Shadow/penguin-harness/pull/917)
- **Breaking:** yes — 本版本之前写下的 `.project_config.toml`，若存有 MMSP 0.5.0 不再接受的客户端类型，会在第一次被读取时改写一次

[English](2026-10-01-backward-compatibility.md)

[MMSP 0.5.0](2026-09-30-mmsp.zh.md) 改掉了 AgentHub 0.4 按模型代际命名的客户端类型，而 MMSP 在构建客户端时遇到不认识的名字会直接拒绝（`Unknown client type "gemini-3.8"`）。磁盘上带着这些名字的只有一处：`.project_config.toml` 中模型条目的 `client_type`。

## 旧形态：来自 AgentHub 0.4 的 `client_type`

早先的内置目录自己就写下过其中三个名字——`deepseek/deepseek-flash` 预置行（新建 Project 的默认模型）与 Penguin Go 的 DeepSeek 行上的 `deepseek-v4`、Penguin Go 的 Gemini 行上的 `gemini-3.8`、`minimax/MiniMax-M3` 上的 `minimax-m3`；其余名字（`gpt-6`、`gpt-5.6`、`gpt-5.5`、`gpt-5.4`、`claude-5`、`claude-4-8`、`claude-4-7`、`claude-4-6`、`gemini-3.7`、`gemini-3.6`、`gemini-3`、`gemini-embedding`、`glm-5.3`、`glm-5.2`、`glm-5.1`、`kimi-k3`、`kimi-k2.6`、`kimi-k2.5`）用户可能经 Web 弹窗、`penguin config model add --client-type` 或 models PUT 手填过。放着不管，这类条目上的 Session 在第一次请求之前就会失败。

决定：**在第一次读取时把文件迁移一次。** `packages/core/src/state/project-config.ts` 中的 `migrateLegacyClientTypes` 把每个 `client_type` 能被 0.4 路由器匹配的 `[[models]]` 条目改写为说同一种线上协议的 MMSP 客户端——`gemini-*` 与 `gemini-embedding` 改为 `gemini-generate-content`（0.4 的 Gemini 客户端说的是 generateContent，Penguin Go 中转服务的也是它）、`claude-*` 改为 `anthropic-official`、`gpt-*` 改为 `openai-official`、`glm-5*` 改为 `zai-official`、`kimi-*` 改为 `moonshot-official`、`minimax-m3` 改为 `minimax-official`、`deepseek-v4*` 改为 `deepseek-official`——文件的两个读取方随即把它写回：core 的 `loadProjectConfig`（CLI、Session 的创建与恢复、机器管理）与服务端的 `ProjectConfigService.readTable`（全部路由与服务）。写回的是原始表，文件里的其他键一律保留。没有可迁移内容的文件不会被写。之后再出现的旧名字——升级前就打开着的页面发来的 models PUT、仍在旧版本上的机器同步来的模型表——在下一次读取时以同样的方式修复。

通用客户端类型（`openai-chat` 及其别名 `openai`、`openai-responses`、`openai-chat-vllm-adapter`、`openai-embedding`、`ant-messages`）没有变化，也不会被改动。

## 用户需要做什么

不需要做任何事。升级后服务端、CLI 或某个 Session 第一次读到该文件时就会改写它，条目的位置、键与设置原样保留。

有两个条目迁移后钉着目录已不再钉的客户端：`deepseek/deepseek-flash` 与 `minimax/MiniMax-M3`，它们的 id 在 MMSP 0.5.0 下自己就能路由。钉着也照常可用；模型页的预置角标把这项差异与其他目录变化一并计数，**同步内置目录**即清掉这个钉。Penguin Go 的授权或同步会自行把它的行改写为平台当前的协议。

没有 `client_type`、且 id 不以 MMSP 认识的任何厂商族开头的条目——厂商分组里带所有者前缀的 id（如 `anthropic/claude-fable-5`）、Bedrock 的 id（如 `global.anthropic.claude-opus-4-8`）——不在迁移之列，因为 0.5.0 下没有任何客户端能路由它；模型页会标出它并提供「移到自定义分组」，与本版本之前对无法路由的厂商分组行的处理一样。

## 何时可以移除

在 0.3.0 发布准备时，由负责该次发布的人移除。前提：0.3.0 的发布说明写明，最后一次打开早于「交付本迁移的那个版本」的 Project，须先在某个 0.2.x 版本上打开一次（任何一次读取——服务端启动、`penguin config model list`、一个 Session——都会完成改写）。移除的内容：

- `packages/core/src/state/project-config.ts` 中的 `LEGACY_CLIENT_TYPES`、`migrateLegacyClientTypes` 以及 `loadProjectConfig` 里的写回；
- `ProjectConfigService.readTable`（`packages/server/src/services/project-config-service.ts`）里的写回；
- `packages/core/test/state.test.ts` 与 `packages/server/test/models.test.ts` 中的迁移用例；
- 设计文档改动历史里关于本迁移的条目。
