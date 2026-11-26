# 工作台页面的 SDK 不再等待 Agent 的其他工作台

- **Date:** 2026-11-21
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1681](https://github.com/Prism-Shadow/penguin-harness/pull/1681)

[English](2026-11-21-workbench-sdk-no-listing.md)

工作台页面一打开就会加载 SDK（`sdk/amsp.js`、`sdk/workbench.js`）。服务器过去要先加载 Agent 的全部工作台才回应，现在只确认该页面所属的工作台存在且已启用，不再加载其他工作台。从应用中心直接打开应用时，不必再等 Agent 的其他工作台编译完成。
