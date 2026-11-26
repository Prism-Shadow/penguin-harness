# 新对话的示例改为「构建新应用」「优化已有应用」「发布应用」三个快捷指令

- **Date:** 2026-11-25
- **Type:** feature
- **Scope:** `web`, `ui-gallery`
- **PR:** [#1860](https://github.com/Prism-Shadow/penguin-harness/pull/1860)

[English](2026-11-25-home-shortcuts-simplify.md)

新对话页输入框下方的随机示例改为三个固定的快捷指令，居中排列，以胶囊按钮显示。「构建新应用」填入一段提示词，让 Agent 构建新的工作台应用并上线到应用中心。「优化已有应用」和「发布应用」都打开一个可搜索的应用列表，列出本 Project 在草稿所在机器上的应用（不含系统应用），选中后填入点名该应用的提示词：「优化已有应用」让 Agent 改进它，「发布应用」让 Agent 提交 Pull Request，把它加入 [PenguinHarness Apps](https://github.com/Prism-Shadow/penguin-harness-apps) 并在[插件索引](https://github.com/Prism-Shadow/penguin-harness-plugins)中登记。发布列表不含由插件库插件安装的应用。列表仍在读取或读取失败时，菜单如实说明并提供重试。自定义快捷指令排在三者之后，「换一组示例」与「更多示例」已移除。
