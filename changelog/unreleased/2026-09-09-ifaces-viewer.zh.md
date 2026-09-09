# 模块树一键打开

- **Date:** 2026-09-09
- **Type:** process
- **Scope:** `landing`, `ci`
- **PR:** [#450](https://github.com/Prism-Shadow/penguin-harness/pull/450)

`penguin.ooo/ifaces/` 是一个静态查看页，用于打开 CI 以 workflow artifact 形式上传的接口页面：给定 `?owner=…&repo=…&run=…&artifact=…`，它经 artifact 代理取回 zip，在浏览器里解开，把页面放进 frame 展示，`ifaces.json` 仍可在旁边下载。`artifact` 参数可省略——会列出该 run 的 `ifaces-page-*` artifact 自行找到。取回失败时（代理拒绝，或 artifact 已在 14 天后过期），手动下载的 zip 可通过文件选择器打开。`ifaces-page` 的 job summary 现在链到这里，zip 链接在旁。
