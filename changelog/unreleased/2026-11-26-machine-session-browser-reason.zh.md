# 机器上的对话说明为什么用不了浏览器，不再要求打开桌面应用

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `browser-automation`, `server`, `web`
- **PR:** [#1910](https://github.com/Prism-Shadow/penguin-harness/pull/1910)

[English](2026-11-26-machine-session-browser-reason.md)

在运行于远程机器上的对话里打开浏览器，不再向已经在用桌面应用的人显示「浏览器现在不可用：内置浏览器需要打开 PenguinHarness 桌面应用，你的 Chrome 需要连上 PenguinHarness Browser 扩展」。机器上运行的是不带桌面应用的 `penguin server`，面板此前向那台机器要它的桌面浏览器页面，每次都得到这个错误；现在面板说明此对话运行在另一台机器上、那台机器没有桌面应用、机器上的对话用不了浏览器，也不再向那台机器发任何浏览器请求。

## 机器上

- 本服务端以 `PENGUIN_MACHINE=1` 启动机器上的服务，那台服务端因此知道自己是机器。
- 机器不提供自己的 Chrome 配对（扩展连不到只绑定回环的服务端），也没有可切换的后端。
- 机器上管理员的浏览器请求答 `503 browser_unavailable`，原因为新增的 `hub_disconnected`；那里的 `penguin browser status` 说明会话的浏览器在添加这台机器的那台电脑的 PenguinHarness 里、现在从机器上连不上，不再请用户配对 Chrome。导入与清除数据在机器上答 `405 not_supported`。
