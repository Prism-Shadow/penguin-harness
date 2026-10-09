# Skill 先问程序是用 SDK 内嵌 Agent，还是经 Agent API 调用

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `plugins`, `docs`

[English](2026-10-09-skills-sdk-or-api.md)

程序接入 Penguin Agent 有两种方式：一是用 SDK `@prismshadow/penguin-core` 内嵌，完全脱离 Penguin 服务器，只提供最基础的 Agent 循环；二是经服务器的 Agent API，按 AMSP 协议，用 `@prismshadow/amsp` 客户端或 curl 调用。负责构建 Agent 应用与创建 Agent 的 Skill 写明了这两种方式，并在动手之前先问用户选哪一种。`agent-development` 与 `agent-tuning` 插件升到 `2026.10.09.1`。

## 细节

- **`penguin-sdk`** 以 *Two ways to reach an agent* 一节开篇：逐一说明每种方式是什么、能得到什么、缺什么或需要什么、何时选用。用户要把程序接入 Agent，或要构建内含 Agent 的程序时，即使需求已经具体，Skill 也先问用哪种方式。这个问题是一个 a2ui 选项块，Web App 渲染为两个按钮，CLI 与消息渠道显示为编号列表。用户的消息或此前的回答已经选定时不再问，工作流与远程控制机器人也不问。问过之后，Skill「不追问」的默认规则照旧。
- 原有的 SDK 内容原样移入 *The SDK path* 一节，验证步骤也在其中。新增的 *The API path* 一节与 `reference/agent-api.md` 覆盖另一种方式：Project 所有者在 Agent 的 **API** 标签页或用 `penguin agent api` 要做的步骤、建议的审批模式、Base URL（用 `localhost`，不用 `127.0.0.1`）、形如 `<projectId>/<agentId>` 的 Agent ID、`AgentClient` 的 `ask` 与 `run`、按 Session 续接对话与 `onApproval`、curl、错误码，以及交付前的检查。
- Agent 从不自行开启某个 Agent 的 API 访问或无密钥访问，不修改其审批模式或服务器总开关，也不创建、删除密钥，尽管它 shell 里的令牌允许这样做；它请用户来做，并指明在哪里做。密钥只放在环境变量 `PENGUIN_AGENT_KEY` 里，不进代码，也不进对话。
- **`agent-initialization`** 在所要的 Agent 供程序使用时问同一个问题。选 SDK 时转交 `penguin-sdk`，配置程序内嵌的 Agent；选 API 时在 Project 中创建 Agent，并在报告里写明所有者要做的步骤、Agent ID 与 Base URL。
- **`penguin-orchestration`** 在注意事项里写明 `penguin agent api`：只读命令 Agent 可以自己运行，修改类命令归所有者。
- `agent-development` 插件的描述与文档的 Skill 页在 SDK 旁写上了 Agent API。
