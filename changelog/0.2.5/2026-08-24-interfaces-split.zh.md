# 接口契约按「引擎哪一侧需要」拆分

- **Date:** 2026-08-24
- **Type:** refactor
- **Scope:** `core`, `server`, `docs`
- **PR:** [#459](https://github.com/Prism-Shadow/penguin-harness/pull/459)
- **Breaking:** yes — `SubagentHandle.run` 与 `sendToBackgroundSubagent` 改收 OmniMessage 数组而非字符串，且 build/version 类型移出 `/interfaces` 子路径

[English](2026-08-24-interfaces-split.md)

`packages/core/src/interfaces.ts` 把四组互不相关的东西塞在一个 749 行的文件里，其中 build/version
类型还在物理上把 Environment 段劈成两半。现在它是一个目录，按 `context_engine` 的哪一侧需要该契约
划分；贯穿三条边界的「消息面 / 控制面」之分也一并写进文档。

## 划分

- `interfaces/llm.ts`——模型请求契约（`GenerativeModelConfig`、`GenerativeModelParameters`、
  `LLMOutcome`、`LLMInterface`）。
- `interfaces/environment.ts`——工具执行、配置、子会话契约，以及管理面 API。
- `interfaces/shared.ts`——两侧确实共用的词汇：`ToolDefinition`、`ThinkingLevelName`、
  `ApproveFn`、命令策略。
- `interfaces/index.ts`——barrel，仍是对外发布的 `@prismshadow/penguin-core/interfaces` 入口，
  既有导入路径全部照旧。
- `version-info.ts`——`BuildInfo` / `HarnessInfo` / `VersionReport` 一族，它们描述的既不是 LLM
  也不是 Environment，改由包根导出。

## 两条面，写明

文档页（[接口契约](/interfaces)）现在写明每条边界上流动的是什么。**内容**只有 OmniMessage。与之
并行的是刻意不做成消息形态的**控制面**——`signal`、`thinkingLevel`、`approve` 及其
`ApprovalDecision`、以及 `streamGenerate` 的 `LLMOutcome` 返回值——每一项都附上它为何仍是参数。
Environment 其余的非消息成员被命名为它的**管理面**：`listTools`、`toolPermission`、后台命令与
子会话的各类列举、停止/插话入口与监听器挂载——它们根本不经过引擎，服务的是 Session 装配与宿主
自己的 UI。

## 通往子会话的一套词汇

`SubagentHandle.run` 收 `prompt: string`，而同一个 handle 的 `steer` 收 `OmniMessage[]`；
`sendToBackgroundSubagent` 收 `text: string`。两者现在都收 `Session.run` 所收的 OmniMessage 数组。

每条消息的 `sender` 由调用方决定，这顺带修掉一处归属错误：从子会话面板对空闲子会话发起的一轮，
此前被标记为 `parent_agent`，于是用户自己的话被记进子会话 Trace，仿佛是父 Agent 派发的。现在只有
模型自己的派发标记 `parent_agent`，面板消息不带 sender——与面板的插话路径本来的做法一致。

## 兼容性

不涉及任何存量数据或存量配置，除上述 `sender` 修正外也不改变任何宿主可见行为。对 SDK 嵌入方有两处
源码级不兼容：

- 自带 `SubagentRunner` 的嵌入方需把 `run({ prompt })` 改为 `run({ messages })`——`messages` 是
  本轮输入，形状与 `Session.run` 相同（`[userText(prompt, "parent_agent")]` 精确复现旧行为）。
  自定义 `EnvironmentInterface.sendToBackgroundSubagent` 同理。
- `BuildInfo`、`BuildRuntimeInfo`、`HarnessInfo`、`HarnessSource`、`VersionReport` 不再从
  `@prismshadow/penguin-core/interfaces` 导出，改从 `@prismshadow/penguin-core` 导入。

两处都不保留兼容层：它们都是编译期报错、一行即可修好；而让 `run` 同时接受两种形状，等于把这次改动
消除的那份含糊重新引进来。
