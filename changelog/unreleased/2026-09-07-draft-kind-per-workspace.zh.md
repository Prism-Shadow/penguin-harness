# 新对话按 Workspace 记住上次的开启方式

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `web`
- **PR:** [#644](https://github.com/Prism-Shadow/penguin-harness/pull/644)

[English](2026-09-07-draft-kind-per-workspace.md)

草稿页的第三个 pill 决定新会话开出什么：普通对话，或插件贡献的某个 surface——Claude Code 是其中第一个。它每次都从「对话」开始，于是一个只用 Claude Code 驱动的仓库，每次进来都要重新点两下。

现在这个选择记在做出它的那个 Workspace 上，并在该 Workspace 再次被选中时重新套用——进入页面时如此，切换 Workspace pill 时也如此。旁边的目录保留它自己的答案：同一个 Project 里可以有一个用 Claude Code 驱动的仓库和一个始终是对话的目录，两边都不需要每次纠正。机器是「这是哪个 Workspace」的一部分，因此同一条路径在两台机器上是两个 Workspace、两份记忆。

它刻意没有放进草稿缓存：那份缓存会被它所属的那次发送清掉，而这里是一项常驻偏好，必须活过那次发送。与缓存一样，它存在浏览器本地，并按用户与 Project 隔离。若记住的 surface 所属插件已不再被该 Project 加载，则回落为对话，而不是给出一个只会说「不可用」的输入卡片。
