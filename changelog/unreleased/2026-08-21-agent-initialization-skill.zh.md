# `agent-creation` 更名为 `agent-initialization`

- **Date:** 2026-08-21
- **Type:** change
- **Scope:** `skills`, `web`, `docs`
- **PR:** [#400](https://github.com/Prism-Shadow/penguin-harness/pull/400)
- **Breaking:** 技能库中不再有名为 `agent-creation` 的 Skill

[English](2026-08-21-agent-initialization-skill.md)

Agent 调优分组下的 `agent-creation` 现更名为 **`agent-initialization`**。新名字说的是它实际做的事：初始化一个
Agent 的设置——AGENTS.md、身份信息，以及这个 Agent 需要的 Skill——而不是「创建 Agent」，后者由产品的其他入口负责。

Skill 正文随名字一并调整（`# Agent Initialization`、重写的 description 与两条 short description），`version`
升到 8。行为没有变化：步骤、产出、写入的文件都与之前一致。

所有仍在生效的引用同步更新——分组注册表、文档里的 Skill 库表格、首页示例中声明该 Skill 的那一条、SDK Skill 的交叉引用、
各 README 与 SDK 示例。已发布的博客文章与已发布版本的 changelog 条目保留旧名：它们记录的是写下时的事实。

## 兼容性

已经安装过 `agent-creation` 的 Agent，磁盘上 `agent_state/skills/agent-creation/` 那份副本会原样保留。它仍然可用
（本身就是一个自包含目录），但不再对应技能库里的任何 Skill，因此永远不会再收到更新；技能库会把
`agent-initialization` 作为「未安装」另行列出。**装上新的之后，磁盘上会同时存在两份、做同一件事、名字不同。**

这里有意不做自动迁移。要迁移：在技能库安装 `agent-initialization`，再到该 Agent 的技能标签页删除 `agent-creation`。
任何按名字声明该 Skill 的地方——提示词里写的「使用 agent-creation skill」、保存的快捷指令、点名它的 AGENTS.md——都需要改成
新名字；旧名字不会报错，只会静默地什么都匹配不到。
