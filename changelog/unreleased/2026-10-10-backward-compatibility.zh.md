# 向后兼容：存量的 `gemini-official`

- **Date:** 2026-10-10
- **Type:** process
- **Scope:** `core`, `web`

[English](2026-10-10-backward-compatibility.md)

[MMSP 0.5.2](2026-10-10-mmsp-0-5-2-clients.zh.md) 把 Google 的官方 Gemini 客户端命名为 `google-official`，它在 MMSP 0.5.0 与 0.5.1 中的名称 `gemini-official` 在 MMSP 中保留为别名。`.project_config.toml` 可能存着旧名称：在模型条目上，或在分组的 `[providers.<id>]` 表里，由 `penguin config model add --client-type`、模型表的 PUT 或手工写入。

## 旧形态：`client_type = "gemini-official"`

旧名称按别名读取。`packages/core/src/state/model-catalog.ts` 的 `MMSP_CLIENTS` 保留 `gemini-official` 一行，其环境变量（`GEMINI_*`）、请求路径（`/v1beta/interactions`）与快速模式协议都与 `google-official` 相同。路由、环境变量回退、快速模式、Web 端的协议路径以及厂商分组的可路由检查，因此都把存量值当作新名称处理。磁盘上的内容从不改写：读取时不做任何迁移，模型页保存时按读到的原值写回。模型弹窗与分组设置按存储的值显示。

协议菜单同样把存量的 `gemini-generate-content`（`google-genai` 在 0.5.0 中的名称，MMSP 0.5.1 起为别名）显示为 Google GenAI，不改写它。

## 用户需要做什么

无需任何操作。

## 何时可以移除

随去掉 `gemini-official` 别名的那次 MMSP 升级一起移除，由负责该次升级的人处理。存量值从不被改写，所以那次升级要先与用户确定仍存旧名称的 Project 如何处理：一次性迁移为 `google-official`，或在发布说明中请用户自行修改。移除的内容：

- `MMSP_CLIENTS` 中的 `gemini-official` 一行及其 `compat` 注释；
- `packages/core/test/state.test.ts` 中存量别名的用例，以及 `packages/web/test/protocol-path.test.ts` 与 `packages/web/test/provider-settings.test.ts` 中 `gemini-official` 的用例；
- `configuration` 文档与 `unified-llm-api` Skill 中关于 `gemini-official` 的句子。

`packages/web/src/features/models/protocol-types.ts` 中 `PROTOCOL_ALIASES` 的 `gemini-generate-content` 一项，随去掉该别名的那次 MMSP 升级，与 `MMSP_CLIENTS` 的 `gemini-generate-content` 一行一起移除。
