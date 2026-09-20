# 只改 Web 或只改 CLI 的推送也会到达机器

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `server`
- **PR:** [#799](https://github.com/Prism-Shadow/penguin-harness/pull/799)

[English](2026-09-19-handover-harness-identity.md)

被热推送过的服务端会把自己的构建交接给它持有的机器，并以版本号（`<release>+hmr.<sha>`）判断哪些机器落后。其中的 sha 原先只取自平台 bundle，于是只改了 Web 或只改了 CLI 的推送不会改变版本号：所有机器都被视为最新，Machines 页也如此显示，这次推送永远不会被交接。

现在该后缀标识的是整个 harness——平台 bundle、CLI bundle 与 Web 产物合成的一个 sha。assets 有意不计入：它们是 harness 加载的东西（插件、它固定加载的原生模块），不是 harness 本身。

此前为机器记录的版本号带的是旧后缀，因此升级后每台被持有的机器会再被交接一次当前构建，无需手工操作。
