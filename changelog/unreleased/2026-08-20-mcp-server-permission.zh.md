# MCP Server 的按服务权限设置

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `web`, `docs`
- **PR:** [#364](https://github.com/Prism-Shadow/penguin-harness/pull/364)

[English](2026-08-20-mcp-server-permission.md)

MCP Server 条目新增可选的 `permission` 字段，三种取值——`auto`（缺省）、`r`、`rw`——固定该
Server 所暴露的全部工具的审批等级。`auto` 下每个工具仍按自己的 `readOnlyHint` 注解取值，与此前
一致。`readOnlyHint` 在 MCP 规范中是可选注解，大量 Server 从不设置，其整个工具集因此落到 `rw`、
每次调用都要停下来审批；显式的 `r` 或 `rw` 现在可以一次性覆盖它们的注解。

## 细节

- `tools.mcpServers[].config.permission` 与 `connectTimeoutMs`、`timeoutMs`、
  `maxOutputLength` 并列，同样作用于该 Server 的全部工具。取值不是 `auto` / `r` / `rw` 时该条目
  即为非法：解析器给出警告并跳过该 Server，手写 YAML 的一处笔误因此只赔上一个 Server，而不是整个
  Agent。
- 等级按 Server 而非按工具设置——用户是在添加 Server 时做这个决定的，那时还没有发现任何工具。
- Web App 的添加/编辑 MCP Server 弹窗带上了该控件，沿用内置工具表格的三选一菜单并补入 `auto` 状态，
  Server 表格列出各条目的生效等级。保存 `auto` 不写出该字段，未显式设过等级的条目因此继续跟随缺省值。

## 这个开关管的是什么

`permission` 决定 PenguinHarness 会把该 Server 的哪些工具调用停下来交人工审批，仅此而已。它不是
沙箱：不限制该 Server 的工具运行时的行为，不会发给 Server、也不向 Server 核验，Server 依旧拥有其
transport 赋予的全部能力。把一个实际能写的 Server 标为 `r`，等于撤掉了本该拦住那次写入的审批。
