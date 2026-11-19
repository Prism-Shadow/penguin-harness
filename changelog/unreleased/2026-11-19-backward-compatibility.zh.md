# 本批次的向后兼容

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`, `db`
- **PR:** [#1642](https://github.com/Prism-Shadow/penguin-harness/pull/1642)

[English](2026-11-19-backward-compatibility.md)

本批次的每项兼容决定都只在这里记录一次；各功能条目引用本文件，不再复述。

## 预装之前建出的 Project

[预装的内置插件模块写入 Project 配置](2026-11-19-preinstalled-plugin-modules.zh.md)。新建的 Project 在创建时列入它们，更早建出的 Project 则没有这项列入。不加处理的话，一个功能移进预装插件之后，移入之前的每个 Project 都会少了它。服务端第一次启动带有某个预装模块的构建时，把该模块一次性列入每个已有 Project 中本服务端自己的 `[plugins.<machineId>]` 表，文件的其余部分不变。这次列入按包记在 web.db 的 `plugin_module_preinstalls` 中，不再重复。管理员之后从某个 Project 移除了该模块，那个 Project 就一直没有它。

### 生效范围

服务端启动带有预装模块的构建时，数据根下的每个 `.project_config.toml`，每个包一次。构建不带预装模块的服务端不做任何改动。管理员已停用的模块不列入。配置读不出的 Project 跳过并记日志。

### 用户需要做什么

无需任何操作。

### 保留期限

一次性列入保留到下一个大版本（1.0），由准备 1.0 发布的人移除以下内容：

- `packages/server/src/services/preinstall-once.ts` 及其在 `packages/server/src/hmr/platform.ts` 中的调用；
- `library/setting` 中的 `PluginModulePreinstallsRepo`；
- `plugin_module_preinstalls` 表，另加一条删表迁移。

Project 创建时的列入是功能本身，予以保留。届时还须决定：1.0 之后才预装的模块是否仍应进入已有 Project；若是，这一机制就转为常设。
