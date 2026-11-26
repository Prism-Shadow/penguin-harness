# 加载失败的工作台提供「用 AI 修复」与「报告问题」

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `web`

[English](2026-11-26-workbench-fail-actions.md)

Web App 显示工作台文件加载失败的各处，现在在「重新加载」之外另提供两个操作。设计见 penguin-harness-design [#617](https://github.com/Prism-Shadow/penguin-harness-design/pull/617)。

## 细节

- **用 AI 修复**沿用插件的修复：先确认，再由默认 Agent 在临时 Workspace 开新对话，修复提示词预填进输入框、不代为发送。提示词写明工作台、所属 Agent 与所在机器、目录（`<app_data_dir>/agents/<agent>/agent_state/workbenches/<id>/`）与原样的加载错误；说明加载是在宿主固定的选项下检查 `index.ts`，保存文件即重新加载，结果记在 `.build/status.json`；要求 Agent 改动之前先说明打算。错误出自平台提供的部分（Node 或 TypeScript 的声明、宿主类型、打包）时，要求 Agent 直接说明、不做改动，并建议报告问题。已连接机器上的工作台由那台机器的默认 Agent 在那台机器上修复。没有可接手的 Agent 时以提示条说明。
- **报告问题**打开共用的问题报告：写明工作台以及它是否运行在已连接的机器上，最后是加载错误，按所有报告的规则打码。
- 出现的位置：
  - 应用中心窗口里没有可显示页面的应用面板。这里「重新加载」改为主按钮，「用 AI 修复」是旁边的次按钮。整页上的同一面板位于应用外壳之外，没有可开新对话的 Project，只提供「重新加载」与「报告问题」。
  - 应用中心的「查看错误」对话框。
  - Agent 设置工作台行的「更多」菜单，仅在加载失败时出现。
  - 导入后加载失败的提示条，带「报告问题」。
