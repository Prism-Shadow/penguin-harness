# 本批次的向后兼容

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `core`, `server`, `db`, `web`
- **PR:** [#1642](https://github.com/Prism-Shadow/penguin-harness/pull/1642), [#1654](https://github.com/Prism-Shadow/penguin-harness/pull/1654)

[English](2026-11-19-backward-compatibility.md)

本批次的每项兼容决定都只在这里记录一次；各功能条目引用本文件，不再复述。

## 预装之前建出的 Project

[预装的内置插件模块写入 Project 配置](2026-11-19-preinstalled-plugin-modules.zh.md)。新建的 Project 在创建时列入它们，更早建出的 Project 则没有这项列入。不加处理的话，一个功能移进预装插件之后，移入之前的每个 Project 都会少了它。服务端第一次启动带有某个预装模块的构建时，把该模块一次性列入每个已有 Project 中本服务端自己的 `[plugins.<machineId>]` 表，文件的其余部分不变。每个 Project 按包记在 web.db 的 `plugin_module_preinstalls` 中，记下的 Project 不再列入。管理员之后从某个 Project 移除了该模块，那个 Project 就一直没有它。

### 生效范围

服务端启动带有预装模块的构建时，数据根下的每个 `.project_config.toml`，每个包一次。构建不带预装模块的服务端不做任何改动。管理员已停用的模块不列入。配置读不出或写不进的 Project 记日志，下次启动再试；配置不是合法 TOML 的 Project 记日志并永久跳过。

### 用户需要做什么

无需任何操作。

### 保留期限

一次性列入保留到下一个大版本（1.0），由准备 1.0 发布的人移除以下内容：

- `packages/server/src/services/preinstall-once.ts` 及其在 `packages/server/src/hmr/platform.ts` 中的调用；
- `packages/server/src/services/plugin-modules.ts` 中 Project 创建与预装模块启用时的记下；
- `library/setting` 中的 `PluginModulePreinstalls` 与 `PluginModulePreinstallsRepo`；
- `plugin_module_preinstalls` 表，另加一条删表迁移。

Project 创建时的列入是功能本身，予以保留。届时还须决定：1.0 之后才预装的模块是否仍应进入已有 Project；若是，这一机制就转为常设。

## 已有名为 `system_agent` 的 Agent

[每个 Project 都有系统 Agent](2026-11-19-system-agent.zh.md)，id 为 `system_agent`。Agent id 由用户自选，所以 Project 里可能已有这个 id 的 Agent。它的 `system_config.yaml` 没有 `system: true`，因此仍是普通 Agent：照旧对话、删除与导出，供给从不覆盖它。它占着这个 id 时，该 Project 没有系统 Agent；Agents 页给 Project 的 owner 一行提示，点出这个 Agent。

### 生效范围

升级前已有 `agents/system_agent/` 的任何服务端、桌面端或机器上的 Project。

### 用户需要做什么

要让该 Project 有系统 Agent：导出这个 Agent，以另一个 id 导入，再删除原来的。系统 Agent 在该 Project 的 Agent 列表下次被读取时补齐。

### 保留期限

core `state/system-agent.ts` 的维护者把其中写明的「必须带键」作为此情形的处理，连同 Agents 页的提示（`packages/web/src/lib/builtin-agents.ts` 的 `holdsSystemAgentId` 与 `systemIdHeld` 文案）保留到下一个主版本（1.0），在该版本的发布准备中删除这条提示。
