---
title: 架构总览
description: SDK、Server、CLI 和 Web App 如何分工，以及三接口边界与 OmniMessage 如何组织整个系统。
---

PenguinHarness 是一个 pnpm monorepo，核心是 `@prismshadow/penguin-core` 里的执行引擎。Server 是随产品交付的 Human 实现，所有 Task 都由它运行；SDK 嵌入方也可以直接驱动引擎。

Web App 和 CLI 经 HTTP 与 SSE 访问 Server，桌面应用则把 Server 和 Web App 装进同一个窗口。本页依次介绍分层结构、引擎的三接口边界、[一个 Task 的数据流](#一个-task-的数据流)、各项职责的归属和源码结构。

## 分层结构

自上而下：

```text
┌─────────────┐  ┌─────────────────────────────┐
│   CLI       │  │  Web App (React SPA)        │
│  (penguin)  │  │                             │
└──────┬──────┘  └──────────────┬──────────────┘
       │                        │   HTTP · OmniMessage over SSE
┌──────┴────────────────────────┴──────────────┐
│  Server (Hono + SQLite)                      │
└──────────────────────┬───────────────────────┘
                       │ session.run(...)   ← Human boundary
┌──────────────────────┴───────────────────────┐
│  core: context_engine (ReAct loop)           │
│    ├── LLMInterface ──→ AgentHub ──→ models  │
│    ├── EnvironmentInterface ──→ builtin tools│
│    ├── Agent State (editable files)          │
│    └── Trace (append-only JSONL)             │
└──────────────────────────────────────────────┘
```

CLI 和 Web App 经 HTTP 与 SSE 同 Server 通信。随产品交付的各个应用里，只有 Server 调用 `session.run`。

| 包 | 角色 |
| --- | --- |
| `packages/core` | SDK 与引擎：`context_engine`、OmniMessage、LLM 与 Environment 接口、钩子、状态和 Trace |
| `packages/server` | Human 实现：通过 core 运行 Task，经 HTTP 接收输入和审批，用 SSE 流式输出结果 |
| `packages/cli` | Server 的终端客户端：REPL 与单次运行都经 HTTP 和 SSE 完成；本地没有运行中的 Server 时会自动启动一个。只有 `penguin config` 直接经 SDK 读写配置文件 |
| `packages/web` | 纯渲染的 SPA：渲染 OmniMessage 流，不含任何引擎逻辑 |
| `packages/desktop` | 桌面应用：一个 Electron 外壳，把 Server 作为 `utilityProcess` 运行，并在本地 HTTP 地址上打开窗口 |
| `packages/hmr` | 热更新机制：版本存储、原子提交、资源注册表，以及 park → boot → swap |
| `plugins/*` | 内置插件库，每个插件一个包：Skill（`SKILL.md` 目录）和会话钩子（脚本包），由 core 加载 |

## 三接口边界

`context_engine` 是整个系统的核心，只做两件事：维护线性消息历史，以及在三个接口之间编排事件流。它只认识 [OmniMessage](/omni-message)，不做任何协议转换。

- **Human**：用户侧边界。它刻意不是一个接口类：SDK 的唯一入口 `session.run(newMessages, { approve, signal })` *就是* Human 边界。输入是一组新增的 OmniMessage 和一个审批回调，输出是 OmniMessage 流。Server 是随产品交付的实现；CLI 和 Web App 经 HTTP 与 SSE 访问它，SDK 嵌入方则自己调用 `session.run`。
- **LLM**：模型侧接口 `LLMInterface`。它把 OmniMessage 转成发往 AgentHub 模型网关的请求，再把流式事件转回 OmniMessage。供应商协议适配全部在 AgentHub 内完成，core 不引入任何厂商 SDK。
- **Environment**：工具执行接口 `EnvironmentInterface`。它执行通过审批的工具调用，并把结果流式送回。

内核不含任何供应商、工具或 UI 的细节，三侧都能按配置替换而不必改动 core：今天是本地 shell，明天可以换成别的沙箱；调用方可以是 CLI、Web App，也可以是程序化调用。接口签名见[核心接口](/interfaces)。

## 一个 Task 的数据流

1. Human 把一段 Prompt（一组 OmniMessage）交给 `session.run`。
2. 引擎发起一次 Request，`LLMInterface` 流式产出 `partial_*` 分片和完整消息。
3. 每个完整的 `tool_call` 触发一次 `approve` 决策，通过审批的调用在 Environment 中并发执行。
4. 工具输出按原始顺序回填，作为下一次 Request 的输入。
5. 某一轮不再产生 `tool_call` 时，Task 结束：这一轮就是最终答复。

每条消息和事件都同时流向两个去处：实时推给 Human，同时追加写入 [Trace](/sessions-and-traces)。中断、重连、压缩等循环细节见 [Agent 运行循环](/agent-loop)。

## 职责划分

判断一个设计归属哪一层，只看它的**事实来源**在哪里。判定规则只有一条：能编辑的与被记录的在文件层；让消息流动起来的在 SDK；需要常驻进程与多用户的在 Server；其余是渲染。

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| SDK（`core`） | 协议与执行：让消息流动的一切 | 持久化用户状态、多用户、任何渲染 |
| Server | 常驻进程与多用户运行时 | 引擎逻辑，完全委托给 SDK |
| 文件层（`~/.penguin/data`） | 一切可编辑的定义与一切被记录的历史 | 任何计算 |
| CLI / Web | 渲染与交互 | 业务状态 |

逐项对应（设计 → 归属 → 承载文件或模块）：

| 设计 | 归属 | 承载位置 |
| --- | --- | --- |
| OmniMessage 协议、消息解析与分片聚合 | SDK | `core/src/omnimessage/`，见 [OmniMessage 协议](/omni-message) |
| ReAct 循环、补发、重连、压缩 | SDK | `core/src/engine/context-engine.ts`，见 [Agent 运行循环](/agent-loop) |
| 审批机制（每个 `tool_call` 一次决策） | SDK | `ApproveFn`（`core/src/interfaces/shared.ts`）；具体模式由 Server 或 SDK 宿主注入 |
| 工具执行与集中收尾 | SDK | `core/src/environment/`，见[工具与审批](/tools) |
| 模型访问（供应商协议适配） | SDK → AgentHub | `core/src/llm/` + `@prismshadow/agenthub`，见[模型与 Provider](/models) |
| Trace 写入与 Session 恢复逻辑 | SDK | `core/src/trace/`（记录本身存放在文件层） |
| 子 Agent 派生与消息回流 | SDK | `run_subagent` 工具 + 注入的 `SubagentRunner` |
| 多用户认证与 Project 授权 | Server | `server/src/auth/`、`server/src/services/project-service.ts` |
| Session 索引、Session 级互斥、SSE 转发 | Server | `server/src/runtime/`，见 [Server API](/server-api) |
| 定时任务执行 | Server | `server/src/runtime/scheduler.ts`；任务定义放在文件层的 `agent_state/schedule/*.toml` |
| 审批模式持久化与手动决策 | Server | `server/src/runtime/approvals.ts` + SQLite |
| 用量持久化与成本统计 | Server | `server/src/runtime/usage-recorder.ts`、`services/usage-service.ts` |
| Agent 行为定义（Prompt 与运行时参数） | 文件层 | `agent_state/system_config.yaml`、`AGENTS.md`，见[配置参考](/configuration) |
| Skill 与钩子 | 文件层 | `agent_state/skills/<name>/SKILL.md`、`agent_state/hooks/<name>/hooks.json`，见[技能与插件](/skills) |
| 密钥 | 文件层 | Vault：`agent_state/.vault.toml`；模型凭据：`.project_config.toml`（两者权限均为 0600） |
| 模型表与默认模型 | 文件层 | `<project>/.project_config.toml` |
| 运行历史（恢复的唯一事实来源） | 文件层 | `traces/<date>/<session>_<index>.jsonl`，见 [Session 与 Trace](/sessions-and-traces) |
| Benchmark 题目与分数 | 文件层 | `<project>/benchmarks/<id>/`，见[自我进化](/self-improvement) |
| 快照 | 文件层 | `snapshots/v<version>.tar.gz`；导出/导入服务由 Server 提供 |
| 流式渲染、审批 UI、图表 | CLI / Web | `cli/src`、`web/src`（纯渲染，不含引擎逻辑） |

> [!NOTE]
> Server 的 SQLite 只存索引与聚合数据，从不与文件层争当事实来源。

## 状态层

引擎之下是纯文件的状态层。数据根目录为 `~/.penguin/data`（可用 `PENGUIN_HOME` 修改），按 `<project>/agents/<agent>/` 组织：

| 组件 | 位置 | 内容 |
| --- | --- | --- |
| Agent State | `agent_state/` | `system_config.yaml`、`AGENTS.md`、Skill、Vault。一个 Agent 的全部行为都是可编辑的文件。 |
| Project 配置 | `.project_config.toml` | 模型表与凭据。模型身份恒为 `(provider, model_id)` 二元组。 |
| Trace | `traces/` | 追加式 JSONL：恢复 Session 的唯一事实来源。 |

Server 额外维护一个 SQLite 索引库（用户、授权、用量统计），但从不复制文件层的事实。CLI、SDK 与 Web App 共用同一份数据目录，可以混用。

## 源码结构

各包按层拆分，文件职责单一；每个文件的头注释就是它的设计说明。

```text
packages/
├── core/src
│   ├── agent.ts / session.ts       # the createAgent composition layer and Session (run / compact / generateTitle)
│   ├── engine/context-engine.ts    # ReAct loop orchestration: turn lifecycle, approvals, carry-over, reconnect, compaction
│   ├── omnimessage/                # types.ts protocol types · builders.ts constructors · aggregate.ts partial aggregation · markers/
│   ├── interfaces/                 # llm.ts · environment.ts · shared.ts (ApproveFn and the vocabulary both sides share)
│   ├── llm/                        # generative-model.ts AgentHub adapter · tool-call-ids.ts id uniqueness · context-limits.ts
│   ├── environment/                # environment.ts execution close-out · tools/ registry, 7 builtin tools, background sessions · mcp/
│   ├── hooks/                      # the stop / pre_tool_use / user_prompt hook points and the hook-script runner
│   ├── plugins/                    # the built-in plugin library and its loader
│   ├── plugin/ · kernel/           # the plugin contract a server plugin compiles against · the hot-update module kernel
│   ├── state/                      # paths · default-config · project-config · model-catalog · memory
│   │                               # agent-state (Skill install, prompt assembly) · agent-vault · builtin-agents
│   ├── trace/                      # writer.ts append-only JSONL · resume.ts replay-based recovery
│   └── internal/                   # shared helpers: dates, Session support, merge queue, session-title.ts (one-shot title generation, never in Trace)
├── server/src                      # index.ts boot sequence · app assembly · db (node:sqlite) · auth · http/routes · runtime · services · hmr · plugin · terminal
├── cli/src                         # commander entry · commands/ (run / chat / input / logs / ls / agent / project / schedule / config / serve …) · server client and approval prompts
├── web/src                         # api client · state · lib/omni stream rendering · components · feature pages (layout below)
├── desktop/                        # the Electron shell
├── hmr/                            # the hot-update mechanism
├── landing/                        # the product landing page (with the blog)
└── docs/                           # this documentation site
```

### Web App 源码

```text
packages/web/src
├── api/          # fetch wrapper · one function per API (DTOs type-only from @prismshadow/penguin-server/api) · SSE wrapper
├── state/        # auth / project / sessions / company / theme / locale contexts
├── lib/omni/     # OmniMessage stream → view-model reducer; connect-first + dedup stream controller
├── components/   # ui primitives (modal / drawer / select …) and the app layout
├── pages/        # the login pages
└── features/     # chat / agents / skills / plugins / models / usage / traces / benchmark / schedules / company / settings / admin … pages
```

Server 的路由与投递保证见 [Server API](/server-api)，Server 进程如何组装各个子系统见 [Server 启动与子系统](/server-boot)。

## 关键设计决策

### 一个协议，三种职责

OmniMessage 同时是 SDK 的对外接口、Trace 的落盘格式和引擎内部的通货：「流出去的」「存下来的」「模型看到的」是同一种东西。

### 错误收敛为消息

LLM 与 Environment 从不向引擎抛异常。它们的结果携带四值 `stop_reason`，具体原因由 `error_code` 和 `error_message` 承载：

| `stop_reason` | 含义与引擎行为 |
| --- | --- |
| `completed` | 正常完成；循环继续或 Task 结束 |
| `retryable` | 值得重试的 LLM 失败：引擎在同一次运行内自动重连，最多连续 5 次无进展的重试，指数退避并设上限 |
| `fatal` | 确定性的失败，例如凭据被拒：运行立即停止，因为重试也不可能成功 |
| `aborted` | 用户中断 |

### 薄模型层

core 只定义 `LLMInterface`，供应商适配全部下沉到 AgentHub（`@prismshadow/agenthub`），因此任意 OpenAI 兼容端点都能接入。见[模型与 Provider](/models)。

源码入口：`packages/core/src/engine/context-engine.ts`、`packages/core/src/interfaces/`。
