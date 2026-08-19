# 文件工具诊断缺失路径，而不是暗示绝对路径被拒绝

- **Date:** 2026-08-02
- **Type:** fix
- **Scope:** `core`, `skills`
- **PR:** [#155](https://github.com/Prism-Shadow/penguin-harness/pull/155)
- **Issue:** [#138](https://github.com/Prism-Shadow/penguin-harness/issues/138)

[English](2026-08-02-file-tool-missing-path-diagnostics.md)

`read_file` / `edit_file` 一直都接受绝对路径，但它们的「File not found」消息只提到按工作区相对解析——于是一个真正缺失的文件（通常是漏掉了 `agent_state/` 这一段）读起来像是「不支持绝对路径」，模型便去反复尝试各种路径形式，而不是去质疑这个路径本身（[#138](https://github.com/Prism-Shadow/penguin-harness/issues/138)）。

## 细节

- 两个工具现在都会说明支持绝对路径，并附上一段诊断：最深的已存在祖先目录、第一个缺失的路径段，以及该祖先目录中按与缺失段的名称相似度排序的条目（至多 8 个，目录带结尾斜杠）——对于所报告的那个案例，提示会直接点名 `agent_state/`。
- ENOTDIR（某个路径段是文件而非目录）现在得到同样的诊断，而不是一条裸的 errno 消息。
- agent-creation Skill 现在写明 `AGENTS.md` 位于 `agent_state/` 之下，而不是 Agent 目录的根部——这正是那段路径被漏掉的可能来源（Skill 版本 7）。
