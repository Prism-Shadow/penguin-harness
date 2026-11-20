# 插件市场可把插件安装到新建的空白 Agent

- **Date:** 2026-11-19
- **Type:** feat
- **Scope:** `web`

[English](2026-11-19-install-to-blank-agent.md)

插件市场的「管理安装」对话框多了首行「新建空白 Agent」。点「新建并安装」，会在列表上方打开「创建 Agent」对话框：名称预填插件的标题，插件已勾选该插件。id 校验、stdio MCP Server 的确认与报错都沿用该对话框原有的处理。创建后对话框关闭，「管理安装」列表保持打开，新 Agent 出现在列表中、标为已装。按一次 Esc 只关闭「创建 Agent」对话框，列表仍然打开。
