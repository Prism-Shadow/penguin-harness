---
title: Session 与 Trace
description: 运行模型的六层结构、本地数据目录布局、Trace 文件设计与 Session 恢复机制。
---

PenguinHarness 的全部运行数据都落在本地文件系统：配置是可编辑文件，历史是 append-only 的 Trace。本页定义运行模型的各层概念，并说明 Trace 如何同时充当历史记录、恢复依据与统计来源。

## 运行模型

六层结构：Project → Agent → Workspace → Session → Task → Request。

| 概念 | 定义 |
| --- | --- |
| Project | 组织 Agent 的顶层单位，持有模型与凭证配置；Web 多用户部署中，用户与 Project 是多对多关系 |
| Agent | 执行主体，恰好拥有一份 Agent State（持久化目录）；一个 Agent 可服务多个 Workspace |
| Workspace | 一次运行的工作目录，是模型可见的唯一文件范围；显式指定的 `workspaceDir` 必须已存在，未指定时自动创建临时 Workspace `workspaces/tmp-<8hex>` |
| Session | 同一（Agent、Workspace）下的一段连续对话；模型与 Workspace 在 Session 创建时锁定，id 形如 `session-YYYY-MM-DD-HH-mm-ss-<8hex>` |
| Task | 由一条 Prompt 发起的一个执行目标，由一个或多个连续的 Request 组成 |
| Request | 一次 LLM API 调用：上下文与工具定义送入，流式输出返回 |

各层组件如何协作见[架构总览](/architecture)；Task 内部 Request 如何推进见 [Agent 运行循环](/agent-loop)。

## 数据目录

数据根目录取环境变量 `PENGUIN_HOME`，缺省 `~/.penguin/data`。目录布局由 `packages/core/src/state/paths.ts` 统一定义：

```text
<root>/<project>/
├── .project_config.toml          # Project 级模型与凭证（隐藏文件，0600）
└── agents/
    └── <agent>/
        ├── agent_state/              # system_config.yaml、AGENTS.md、.vault.toml、
        │                             # tools/、memory/、skills/、schedule/
        ├── traces/
        │   └── <yyyy-mm-dd>/<sessionId>_<index3>.jsonl
        ├── scratchpad/               # 临时文件，按 Session id 建子目录（如粘贴的图片）
        ├── workspaces/               # 临时 Workspace（tmp-<8hex>）
        ├── benchmarks/               # 能力评测题库与得分
        └── snapshots/                # Agent State 版本快照
```

配置文件的字段详见[配置参考](/configuration)。

## Trace 设计

Trace 是 append-only 的 JSON Lines 文件，每行一个 OmniMessage 信封（协议见 [OmniMessage 协议](/omni-message)）。历史事件只追加、从不原地修改。

- 一个 Trace 文件对应一份完整的模型上下文。上下文压缩产生新的上下文段时，写入器轮转到 `_002`、`_003`……新文件，索引递增。
- 记录的消息：`session_meta`、完整的 `model_msg`、全部 `event_msg`。
- 不记录的消息：流式 `partial_*` 分片（片段结束后由生产方补写完整消息）；带 `origin` 标记的嵌套消息——子 Agent 的消息写入子 Session 自己的 Trace，父 Trace 只在派生位置保留一个 `subagent` 指针事件，记录子 Session id。
- `request_begin` 与 `request_end(status)` 成对出现，界定一轮 Request；回放以 `request_end.status === "completed"` 作为该轮已提交的判据。

实现见 `packages/core/src/trace/writer.ts`。

一条 Trace 的开头(示意，每行一个 OmniMessage 信封):

```jsonl
{"timestamp":"2026-07-18T03:10:22.531Z","type":"session_meta","payload":{"session_id":"session-2026-07-18-11-10-22-3f8a1c2d","provider":"deepseek","model_id":"deepseek-v4-pro","model_context_window":1000000,"system_prompt":"…","tools":[…],"thinking_level":"medium","agent_state":"/home/u/.penguin/data/default_project/agents/default_agent/agent_state","workspace":"/home/u/work"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"request_begin"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"user","text":"创建 hello.txt"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"tool_call","role":"assistant","name":"run_command","arguments":"{\"cmd\":\"printf hi > hello.txt\"}","tool_call_id":"call_0"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"approval_decision","decision":"allow","tool_call_id":"call_0"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"tool_call_output","role":"user","output":"[no output]","tool_call_id":"call_0"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"request_end","status":"completed"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"token_usage","session":{…},"request":{…}}}
```

## Session 恢复

Trace 是恢复的唯一事实来源，没有独立的会话数据库需要与之对齐。`resumeSession` 的流程：

1. 定位该 Session 索引最大的 Trace 文件；
2. 从文件内的 `session_meta` 读取运行配置——模型、系统提示词、Workspace，三者在 Session 生命周期内不可变；
3. 将已提交的历史回放进一份全新的 LLM 上下文；
4. 重建 carry-over（未送达的工具输出、中断标记）与轮数、Token 计数器；
5. 继续追加写入同一个 Trace 文件。

恢复的前提是 Workspace 与模型仍然存在。恢复保证的是结构合法性：只回放已提交的轮次，`tool_call` 与 `tool_call_output` 配对完整；未完成的模型输出（thinking、文本）允许丢失。异常退出留下的截断末行会被容忍并忽略。实现见 `packages/core/src/trace/resume.ts`。

特殊情形：若最新 Trace 文件以一次完成的压缩收尾，则该上下文已整体关闭——恢复从空上下文开始；summarize 模式下会重建 `<context_summary>` 摘要，前置到恢复后第一轮输入中。

## 字段保真

内容消息携带的不透明 Provider 保真负载 `fidelity`（思考签名、phase 分段标记、加密推理等）在 Trace 中原样保存、原样回传——部分模型在历史回放时要求该负载逐字一致，任何转写都会破坏兼容性。这也是 Trace 直接存储 OmniMessage 信封而非二次加工格式的原因之一。

## 可观测性

每一次审批决策（`approval_decision`）、中断（`abort`）、压缩（`compaction_begin` / `compaction_end`）与 `token_usage` 都作为事件落入 Trace。Web 的 Trace 视图与用量、成本统计均由这同一份数据派生，不存在第二事实来源；见 [Web App 指南](/web-app)。审批机制本身见[工具与审批](/tools)。
