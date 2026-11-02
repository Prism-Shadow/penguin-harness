# 新对话不再把 Workspace 路径配到另一台机器上

- **Date:** 2026-11-02
- **Type:** fix
- **Scope:** `web`
- **Issue:** [#1414](https://github.com/Prism-Shadow/penguin-harness/issues/1414)

[English](2026-11-02-draft-workspace-machine.md)

保存 Project 的新对话默认设置时，草稿缓存里的 Workspace 路径会被清掉，它所在的机器却留了下来。下一次新建对话时，Workspace 取的是 Project 的默认路径（这台服务器上的路径），Session 却建到了缓存里记住的那台机器上。现在草稿的机器跟着路径走：保存默认设置时两者一起清掉，缓存里只有机器没有路径时忽略这台机器，保存时正开着的草稿也会连同新的默认 Workspace 一起回到这台服务器。
