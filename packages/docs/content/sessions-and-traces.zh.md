---
title: Session 与 Trace
description: 六层运行模型、磁盘上的数据布局、只追加的 Trace 如何写入，以及 Session 如何从中恢复。
---

PenguinHarness 的全部运行时数据都存放在本地文件系统上。配置是可编辑的文件，历史是只追加的 **Trace**。本页逐层定义运行模型和磁盘上的数据布局，然后说明 Trace 如何同时充当历史记录、恢复来源和统计来源。

## 运行模型

运行模型分六层：Project → Agent → Workspace → Session → Task → Request。

| 概念 | 定义 |
| --- | --- |
| Project | 组织 Agent 的顶层单位；持有模型和凭证配置；在多用户 Web 部署中，用户与 Project 多对多 |
| Agent | 执行主体；有且仅有一个 Agent State（一个持久化目录）；一个 Agent 可以服务多个 Workspace |
| Workspace | 一次运行的工作目录，也是模型唯一能看到的文件范围；显式指定的 `workspaceDir` 必须已经存在，未指定时会创建临时 Workspace `workspaces/tmp-<8hex>` |
| Session | 同一（Agent、Workspace）下的一段连续对话；Workspace 在 Session 创建时锁定，模型在创建时选定、之后可在会话内切换（见[会话内切换模型](#会话内切换模型)）；id 形如 `session-YYYY-MM-DD-HH-mm-ss-<8hex>` |
| Task | 由一个 Prompt 启动的一个执行目标；由一个或多个连续 Request 组成 |
| Request | 一次 LLM API 调用：输入上下文和工具定义，输出流式结果 |

各层如何协同工作，见[架构总览](/architecture)。Request 如何在 Task 内推进，见 [Agent 运行循环](/agent-loop)。

## 数据目录

数据根目录由环境变量 `PENGUIN_HOME` 指定，默认为 `~/.penguin/data`。目录布局统一定义在 `packages/core/src/state/paths.ts` 中：

```text
<root>/<project>/
├── .project_config.toml          # Project-level models & credentials (hidden file, 0600)
├── benchmarks/                   # capability Benchmark cases and scores, one directory per
│                                 # Benchmark — a peer of the Agents, evaluating any of them
└── agents/
    └── <agent>/
        ├── agent_state/              # system_config.yaml, AGENTS.md, .vault.toml,
        │                             # tools/, skills/, hooks/, schedule/
        │   └── memory/               # Memory: user/ plus one directory per Workspace,
        │                             # each with its own MEMORY.md index
        ├── traces/
        │   └── <yyyy-mm-dd>/<sessionId>_<index3>.jsonl
        ├── scratchpad/               # temp files, one subdirectory per Session id (e.g. pasted images)
        ├── shared_env/               # shared interpreter/tool environments (virtualenvs, pipx,
        │                             # caches) the Agent creates on demand — a system prompt
        │                             # convention, not a path the code creates, so tooling is
        │                             # installed once for any task; project dependencies stay
        │                             # in the project
        ├── workspaces/               # temporary Workspaces (tmp-<8hex>)
        └── snapshots/                # Agent State version snapshots
```

各配置文件的字段见[配置参考](/configuration)。

## Trace 设计

Trace 是只追加的 JSON Lines 文件，每行是一个 OmniMessage 信封，详见 [OmniMessage 协议](/omni-message)。历史只追加，从不原地修改。

- 一个 Trace 文件对应一个完整的模型上下文。压缩产生新的上下文段时，写入器切换到新文件，索引依次递增：`_002`、`_003`……
- 记录的内容：`session_meta`、完整的 `model_msg`，以及所有 `event_msg`。
- 不记录的内容：
  - 流式的 `partial_*` 片段。片段结束后，由生产方追加完整消息。
  - 带 `origin` 标记的嵌套消息。子 Agent 的消息写入子 Session 自己的 Trace。父 Trace 只在派生子 Agent 的位置保留一条 `subagent` 指针事件，记录子 Session 的 id。
- `request_begin` 与 `request_end(status)` 成对出现，界定一个 Request。重放时以 `request_end.status === "completed"` 判定该轮是否已提交。
- 追加在写入器内部串行执行。并发生产者（模型流、并行的工具执行）写出的记录严格一条接一条落盘，每条都是一整行、中间不断开。数 MB 的记录（比如 base64 图片的 Data URL）绝不会因并发追加而撕裂；文件轮转也绝不会把一条记录切成两半。
- 每条记录都用一次 `write(2)` 追加，不用 `fs.appendFile`：后者会把超过 512 KiB 的负载拆成多次底层写入。因此进程异常退出最多截断最后一条记录，绝不会从中间撕开一条。
- Session 恢复继续写入已有文件之前，写入器会先探测文件尾部。如果上一次崩溃留下了断行（结尾没有换行符），下一条记录前会先补一个换行符，断行就不会吞掉之后追加的记录。

实现见 `packages/core/src/trace/writer.ts`。

### Trace 开头示例

下面是一个示意性的 Trace 开头，每行一个 OmniMessage 信封。注意顺序：

- 用户输入先写入，之后才是与它一起发送的 `request_begin`。
- 首次运行时，工具集以 `tool_list_ready` 事件跟在输入之后；如果配置了 MCP Server，在这之前还有一对 `mcp_connect_begin` / `mcp_connect_end`。`session_meta` 不携带工具定义。

```jsonl
{"timestamp":"2026-07-18T03:10:22.531Z","type":"session_meta","payload":{"session_id":"session-2026-07-18-11-10-22-3f8a1c2d","provider":"deepseek","model_id":"deepseek-v4-pro","model_context_window":1000000,"system_prompt":"…","agent_state":"/home/u/.penguin/data/default_project/agents/default_agent/agent_state","workspace":"/home/u/work"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"user","text":"Create hello.txt"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"tool_list_ready","tools":[…]}}
{"timestamp":"…","type":"event_msg","payload":{"type":"request_begin"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"tool_call","role":"assistant","name":"exec_command","arguments":"{\"cmd\":\"printf hi > hello.txt\"}","tool_call_id":"call_0","stop_reason":"completed"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"approval_decision","decision":"allow","tool_call_id":"call_0"}}
{"timestamp":"…","type":"event_msg","payload":{"type":"token_usage","session":{…},"request":{…}}}
{"timestamp":"…","type":"event_msg","payload":{"type":"request_end","status":"completed"}}
{"timestamp":"…","type":"model_msg","payload":{"type":"tool_call_output","role":"user","output":"[no output]","tool_call_id":"call_0","stop_reason":"completed"}}
```

### 截断的工具输出

工具输出超过 `maxOutputLength` 时，Trace 记录的是模型、Web App 和 CLI 看到的内容：保留的开头部分、截断标记，以及恢复文件在 Session 中的绝对路径。归档文本不会在 Trace 里再存一份。

这条路径会暴露宿主的数据根目录布局。它跨 Task、跨 Session 恢复始终有效：未经脱敏的恢复文件就存放在该 Session 的 scratchpad 里，而删除 Session 会把 scratchpad 和恢复文件一并删除。因此重放 Trace 之后，既还原了模型看到的内容，也留下一个可用的指针，方便后续追问。

## Session 恢复

Trace 是恢复的唯一事实来源，不存在需要保持同步的独立 Session 数据库。`resumeSession` 的工作流程如下：

1. 找到这个 Session 索引最大的 Trace 文件。
2. 从文件里的 `session_meta` 读取运行时配置：
   - Workspace（在 Session 的整个生命周期内不可变），以及这个上下文所用的模型（切换模型会开新文件，所以最新文件总是记录当前模型）；
   - 该上下文开启时使用的系统提示词。
3. 把已提交的历史重放进一个全新的 LLM 上下文。
4. 重建补发内容（未送达的工具输出、中断标记），以及轮次和 Token 计数器。
5. 继续向同一个 Trace 文件追加。

> [!NOTE]
> 思考等级不记录在 `session_meta` 里，恢复时重新确定：先看 Session 是否钉住了等级，其次是 Agent 配置，最后是 Project 默认值。

### 前提与保证

恢复要求 Workspace 仍然存在，并且模型仍然配置在 Project 中。

恢复保证结构上的合法性：

- 只重放已提交的轮次，`tool_call` / `tool_call_output` 配对保持完整。
- 不完整的模型输出（思考、文本）允许丢失。

### 损坏的文件

- 容忍并忽略进程异常退出留下的末尾截断行。
- 文件中间的损坏行（例如在写入器实现追加串行化之前就已损坏的文件里）直接跳过，并在 stderr 输出诊断信息。所有能解析的记录都会保留。

见 `packages/core/src/trace/resume.ts`。

### 压缩完成之后

如果最新的 Trace 文件以一次已完成的压缩结尾，这个上下文已整体关闭，恢复时从一个空上下文开始。

summarize 模式下，恢复后会重建 `[context_summary]`，并把它加在恢复后的第一条输入之前。使用早期尖括号 `<summary>` 形式的旧 Trace 仍然能够识别。

这个空上下文的开启方式与压缩开启的上下文相同：整体按当前 Agent State 组装（提示词、工具集、vault 和运行设置），而不是沿用已关闭文件里记录的提示词。见[上下文压缩](/agent-loop)。

尚未关闭的上下文则不同：它沿用所在文件记录的提示词。工具、Environment 和 vault 只能来自当前 Agent State，因为 Trace 不记录任何可执行配置。

## 会话内切换模型

活跃对话工具栏里的模型选择器在同一个 Session 内切换模型。切换是一次上下文轮换：

1. 先用当前模型压缩上下文，并且总是 summarize 模式，即使 Agent 的 `compaction.mode` 是 `discard`：摘要是带到新模型上的唯一记录。
2. 下一个上下文在目标模型上开启，写进新的 Trace 文件，文件里的 `session_meta` 记录这个上下文的模型。文件在切换完成时立即开启，开头是 `session_meta`，然后是摘要；这条 `session_meta` 也会推入输出流。

这次压缩是普通的 `manual` 压缩：`compaction_begin` / `compaction_end` 事件对上没有任何字段记录模型。刚压缩过的上下文不再记录第二对事件，手中的摘要直接写在新文件开头。没有完成任何一轮的上下文（首个请求失败或被停止）以一对 `discard` 事件收尾，它开启时所带的摘要（如有）会再写一次到新文件开头；其余待发的输入只在内存中带过去，目标模型没有视觉能力时先折叠成路径行。

压缩失败或被中断时，以及摘要放不进目标模型的上下文窗口时，Session 保持原模型：切换自己压缩出的摘要以 `fatal` 结束压缩，已经在手中的摘要则在产生任何事件之前拒绝切换。目标必须在 Project 配置中且能构造出来（凭据齐全），否则切换在发出任何请求之前就被拒绝。从未运行过的 Session 没有上下文可压缩：直接切换，不写入任何内容。

恢复从最新文件读取模型，所以切换后立刻重启的 Session 仍运行在新模型上，摘要待发。仅剩一处缺口：两次切换之间发生重启、其间没有完成任何一轮，重启会把摘要重建为普通的待发输入，之后再次切换时不会再写它一次；它仍留在被关闭的文件里。

选择器的用法见[切换模型](/chat#切换模型)。

## 换模型开新会话（/model）

在 Web App 中，`/model` 命令新开一个 Session 在另一个模型上延续对话，本对话保持不变。它用与 `/agent` 交接相同的方式进行：

1. 选择模型后，先暂存在输入框中。
2. 发送时，通过普通的 Session 创建 API 在同一个 Agent 下创建新 Session。新 Session 使用所选模型和来源 Session 的 Workspace，因此文件仍然可以访问。
3. 第一条消息以 `[model_switch_from]` 来源块开头，后面跟着用户输入的内容。这个块记录来源 Session 的 id、它最新 Trace 文件的绝对路径、Workspace，以及原模型的成对引用。

历史不会注入新上下文。有些模型在重放历史时要求思考负载和 `fidelity` 逐字节一致，这一点无法跨模型满足。所以模型需要更早的上下文时，会自行读取来源 Trace 文件（JSONL，每行一个消息信封）；见[字段保真](#字段保真)。来源 Session 和它的 Trace 保持原样。命令的用法见[切换模型](/chat#切换模型)。

## 字段保真

每条内容消息都携带一个不透明的供应商 `fidelity` 负载：思考签名、阶段标签、加密的推理内容等数据。Trace 原样保存这个负载，也原样发回。

- 有些模型要求重放历史时逐字节一致。
- 任何改写都会破坏兼容性。

Trace 直接存储原始 OmniMessage 信封而不采用后处理格式，这是原因之一。

## 可观测性

每一次审批决策、中止、压缩和 Token 用量都会以事件形式写入 Trace：

| 情形 | 事件 |
| --- | --- |
| 审批决策 | `approval_decision` |
| 中止 | `abort` |
| 压缩 | `compaction_begin` / `compaction_end` |
| Token 用量 | `token_usage` |

Web App 的 Trace 视图和用量、成本统计都来自这份数据，不存在第二个事实来源。

两者的计价规则也相同：按 Project 当前为该模型设置的价格，并按每个请求自身时间戳所处的时段档位计费。因此，一个 Trace 文件中各轮成本加起来，等于对话头部和成本中心为同一批请求显示的金额。见[对话](/chat)和[成本中心](/usage)。

审批机制本身见[工具与审批](/tools)。

### 跨部署迁移 Trace 文件

- **导出：** 在对话的 Trace 面板中，**导出**会把选中的文件原样下载为 JSONL。
- **导入：** 在[系统设置](/settings#导入-trace) → **通用**中，**导入 Trace** 会把文件添加到你选择的 Project 和 Agent，成为一个新对话。文件最大 14 MB。

如果文件的 session id 已在本安装的任何位置存在，导入即失败，因此导入的文件总是成为新 Session 的 001 号文件。
