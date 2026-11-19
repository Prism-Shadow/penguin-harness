# 本批次的向后兼容

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`, `db`
- **PR:** [#1644](https://github.com/Prism-Shadow/penguin-harness/pull/1644), [#1642](https://github.com/Prism-Shadow/penguin-harness/pull/1642)

[English](2026-11-19-backward-compatibility.md)

本批次的每项兼容决定都只在这里记录一次；各功能条目引用本文件，不再复述。

## 服务端接缝两侧的运行时与平台

[代码插件只经一个宿主面接触服务端](2026-11-19-plugin-server-seams.zh.md)。内置浏览器扩展的 WebSocket 改为贡献的 `HttpModule.upgrades` 端点，配对路由对写请求同源检查的豁免改为该路由组自己声明的 `origin: "own"`。运行时推送不到，平台推送得到，所以两者可能分属这次改动的两侧：

- **较旧的推送平台运行在较新的运行时之下。** 运行时恢复最后一次推送的平台，比它自己旧的也照样恢复。这样的平台不提供 WebSocket 端点，也说不出哪些路由组自行判定来源。对它，运行时仍按 `BuiltinBrowserModule` / `BrowserExtensionGate` 两个名字找到扩展的 gate，自己完成扩展握手；也仍按路径豁免 `POST /api/builtin-browser/extension/pair`。握手与来源规则是 `packages/server/src/hmr/legacy-browser.ts` 中的冻结副本，运行时不引用浏览器的任何代码。
- **较新的平台推送到较旧的运行时上。** 这些接缝之前安装的运行时只会按名字查找。所以浏览器模块仍叫 `BuiltinBrowserModule`，在贡献端点的同时继续导出 `admit` / `connect` 同形的 `BrowserExtensionGate`。

### 生效范围

运行时与推送平台分属这次改动两侧的每台服务器，限于扩展的 WebSocket（`/api/builtin-browser/extension/ws`）与配对路由。

### 用户需要做什么

无需任何操作。

### 保留期限

服务端维护者把两者都保留到下一个大版本（1.0），并在该版本的发布准备中一并移除：

- `packages/server/src/hmr/legacy-browser.ts`、它在 `hmr/upgrade-seam.ts` 中填入的 `fallback`，以及 `src/app.ts` 中的 `legacyOwnOrigin` 回退；
- 浏览器模块的两个名字，届时可以改名。

## 预装之前建出的 Project

[预装的内置插件模块写入 Project 配置](2026-11-19-preinstalled-plugin-modules.zh.md)。新建的 Project 在创建时列入它们，更早建出的 Project 则没有这项列入。不加处理的话，一个功能移进预装插件之后，移入之前的每个 Project 都会少了它。服务端第一次启动带有某个预装模块的构建时，把该模块一次性列入每个已有 Project 中本服务端自己的 `[plugins.<machineId>]` 表，文件的其余部分不变。每个 Project 按包记在 web.db 的 `plugin_module_preinstalls` 中，记下的 Project 不再列入。管理员之后从某个 Project 移除了该模块，那个 Project 就一直没有它。本批次中这样的模块只有一个，即 [browser-automation](2026-11-19-browser-use-plugin.zh.md) 的 Agent 浏览器：不列入的话，每个已有 Project 升级后都会失去浏览器。

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
