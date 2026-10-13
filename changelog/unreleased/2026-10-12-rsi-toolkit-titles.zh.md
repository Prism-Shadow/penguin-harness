# RSI 工具包：显示名称

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `plugins`, `web`

[English](2026-10-12-rsi-toolkit-titles.md)

五个 RSI 工具包原先没有显示名称，插件市场的卡片和「使用」对话框优化标签页的**方法**列表里显示的都是 `opro-rsi-toolkit` 这样的包名。现在每个工具包的 `package.json` 都带上了 `title` 和 `title_zh`。

## 细节

- 名称：默认 RSI 工具包（Default RSI Toolkit）、OPRO RSI 工具包、APE RSI 工具包、ACE RSI 工具包和 AWM RSI 工具包（英文均为「… RSI Toolkit」）。
- 短描述原先以同一个名称开头，权当显示名；现已去掉这个前缀，卡片和方法提示不再重复名称。完整描述不变。
- 执行优化的智能体缺少 `agent-optimization` Skill 时的中文提示，以及中文版「自我进化」文档页，改用默认工具包的中文名称。
