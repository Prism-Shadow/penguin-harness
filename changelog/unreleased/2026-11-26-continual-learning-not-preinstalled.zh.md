# 外部内置插件钉到正式版；默认 Agent 不再预装持续学习

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`, `cli`, `desktop`, `landing`, `docs`

[English](2026-11-26-continual-learning-not-preinstalled.md)

随产品分发、来自其他仓库的五个插件从候选版换成了正式版；新 Project 的默认 Agent 不再带持续学习插件。它的 stop hook 会在每个长 Task 结束后启动一个后台会话，因此只在有人从插件库安装时才装上。插件仍随产品一起分发，离线也能安装。这撤销了[默认 Agent 插件基线](2026-11-23-default-agent-plugin-baseline.zh.md)中的这一项。

## 细节

- server、CLI、desktop 与 landing 包钉住了 `a2ui` 0.2.19、`skill-porting` 0.2.19、`use-firecrawl` 0.2.19、`default-rsi-toolkit` 0.2.19 与 `continual-learning` 0.2.20；组件画廊钉住了其中它用到的三个。
- 此前持续学习的卡片把它标为默认 Agent 的预装插件。自 0.2.20 起，卡片写明 `preinstall: false`。
- 已经装有该插件的 Agent 保持不变，可在 Agent 设置的「插件」里卸载。
