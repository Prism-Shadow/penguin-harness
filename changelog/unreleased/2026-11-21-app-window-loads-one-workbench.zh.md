# 应用窗口打开时不再等待 Agent 的其他工作台

- **Date:** 2026-11-21
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1683](https://github.com/Prism-Shadow/penguin-harness/pull/1683)

[English](2026-11-21-app-window-loads-one-workbench.md)

应用中心的窗口和全屏页从 Agent 的工作台列表里读取要显示的应用，而服务器要把这个 Agent 的全部工作台编译完才回应列表。重启或更新之后第一次打开应用，窗口一直空着、只显示「正在打开页面…」，要等所有编译结束。Agent 上同时装了几个日常工作台时，AI PPT 最容易遇到。现在窗口只请求自己的工作台（`GET …/workbenches?id=<id>`），服务器也只编译这一个。不认识 `id` 的服务器照旧返回完整列表，窗口照常读取。
