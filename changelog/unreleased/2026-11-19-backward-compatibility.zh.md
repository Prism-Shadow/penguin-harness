# 本批次的向后兼容

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `core`, `server`, `web`
- **PR:** [#1644](https://github.com/Prism-Shadow/penguin-harness/pull/1644), [#1654](https://github.com/Prism-Shadow/penguin-harness/pull/1654)

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

## 已有名为 `system_agent` 的 Agent

[每个 Project 都有系统 Agent](2026-11-19-system-agent.zh.md)，id 为 `system_agent`。Agent id 由用户自选，所以 Project 里可能已有这个 id 的 Agent。它的 `system_config.yaml` 没有 `system: true`，因此仍是普通 Agent：照旧对话、删除与导出，供给从不覆盖它。它占着这个 id 时，该 Project 没有系统 Agent；Agents 页给 Project 的 owner 一行提示，点出这个 Agent。

### 范围

升级前已有 `agents/system_agent/` 的任何服务端、桌面端或机器上的 Project。

### 需要做什么

要让该 Project 有系统 Agent：导出这个 Agent，以另一个 id 导入，再删除原来的。系统 Agent 在该 Project 的 Agent 列表下次被读取时补齐。

### 保留期限

core `state/system-agent.ts` 的维护者把其中写明的「必须带键」作为此情形的处理，连同 Agents 页的提示（`packages/web/src/lib/builtin-agents.ts` 的 `holdsSystemAgentId` 与 `systemIdHeld` 文案）保留到下一个主版本（1.0），在该版本的发布准备中删除这条提示。
