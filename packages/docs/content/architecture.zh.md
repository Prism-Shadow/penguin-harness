---
title: 架构总览
description: 三接口边界、context_engine 与 OmniMessage 如何把 SDK、CLI、Server、Web 组织成一个系统。
---

PenguinHarness 是一个 pnpm monorepo，核心是 `@prismshadow/penguin-core` 中的执行引擎；CLI、Server 与 Web App 都只是这同一个引擎的不同「Human 实现」。

## 分层结构

```text
┌─────────────┐  ┌─────────────────────────────┐
│   CLI       │  │  Web App (React SPA)        │
│  (penguin)  │  │    ↑ OmniMessage over SSE   │
│             │  │  Server (Hono + SQLite)     │
└──────┬──────┘  └──────────────┬──────────────┘
       │      session.run(...)  │        ← Human 边界
┌──────┴────────────────────────┴──────────────┐
│  core: context_engine(ReAct 循环)           │
│    ├── LLMInterface ──→ AgentHub ──→ 各模型  │
│    ├── EnvironmentInterface ──→ 内置工具      │
│    ├── Agent State(可编辑文件)              │
│    └── Trace(追加式 JSONL)                  │
└──────────────────────────────────────────────┘
```

| 包 | 角色 |
| --- | --- |
| `packages/core` | SDK 与执行引擎：context_engine、OmniMessage、LLM/Environment 接口、State 与 Trace |
| `packages/cli` | 终端 Human 实现：REPL 与单次运行，直接内嵌 core |
| `packages/server` | Web Human 实现：HTTP 承接输入与审批，SSE 推送输出流 |
| `packages/web` | 渲染层 SPA：按 OmniMessage 协议流式渲染，不含业务引擎 |
| `packages/skills` | 内置技能库(`SKILL.md` 文件集合) |

## 职责划分

判断一个设计归属哪一层，只看它的**事实来源**在哪里。四层的分工：

| 层 | 承担 | 不承担 |
| --- | --- | --- |
| SDK(`core`) | 协议与执行：让消息流动起来的一切 | 持久化用户态、多用户、任何渲染 |
| Server | 常驻进程与多用户运行时 | 引擎逻辑(全部委托给 SDK) |
| 文件层(`~/PenguinHarness`) | 一切可编辑的定义与一切被记录的历史 | 任何计算 |
| CLI / Web | 渲染与交互 | 业务状态 |

逐项对应(设计 → 归属 → 承载文件或模块):

| 设计 | 归属 | 承载 |
| --- | --- | --- |
| OmniMessage 协议、消息解析与分片聚合 | SDK | `core/src/omnimessage/`，见 [OmniMessage 协议](/omni-message) |
| ReAct 循环、补发、重连、压缩 | SDK | `core/src/engine/context-engine.ts`，见 [Agent 运行循环](/agent-loop) |
| 审批机制(每个 tool_call 一次决策) | SDK | `ApproveFn`(`core/src/interfaces.ts`)；具体模式由 CLI/Server 注入 |
| 工具执行与统一收尾 | SDK | `core/src/environment/`，见[工具与审批](/tools) |
| 模型接入(Provider 协议适配) | SDK → AgentHub | `core/src/llm/` + `@prismshadow/agenthub`，见[模型与 Provider](/models) |
| Trace 写入与 Session 恢复逻辑 | SDK | `core/src/trace/`(记录本体在文件层) |
| Subagent 派生与消息回流 | SDK | `run_subagent` 工具 + `SubagentRunner` 注入 |
| 多用户认证与 Project 授权 | Server | `server/src/auth/`、`server/src/services/project-service.ts` |
| Session 索引、并发互斥、SSE 转发 | Server | `server/src/runtime/`，见 [Server API](/server-api) |
| 定时任务(Schedule 执行) | Server | `server/src/runtime/scheduler.ts`；任务定义在文件层 `agent_state/schedule/*.toml` |
| 审批模式持久化与人工决策 | Server | `server/src/runtime/approvals.ts` + SQLite |
| 用量落库与成本统计 | Server | `server/src/runtime/usage-recorder.ts`、`services/usage-service.ts` |
| Agent 行为定义(Prompt、运行参数) | 文件层 | `agent_state/system_config.yaml`、`AGENTS.md`，见[配置参考](/configuration) |
| Skill | 文件层 | `agent_state/skills/<name>/SKILL.md`，见[技能系统](/skills) |
| 密钥 | 文件层 | Vault:`agent_state/.vault.toml`；模型凭据：`.project_config.toml`(均 0600) |
| 模型表与默认模型 | 文件层 | `<project>/.project_config.toml` |
| 运行历史(恢复的唯一事实来源) | 文件层 | `traces/<date>/<session>_<index>.jsonl`，见 [Session 与 Trace](/sessions-and-traces) |
| Benchmark 题库与评分 | 文件层 | `benchmarks/<id>/`，见[自我进化](/self-improvement) |
| 快照 | 文件层 | `snapshots/v<version>.tar.gz`；导入导出服务在 Server |
| 流式渲染、审批 UI、统计图表 | CLI / Web | `cli/src`、`web/src`(纯渲染，不含引擎逻辑) |

一句话判定：**能编辑的与被记录的在文件层；让消息流动起来的在 SDK；需要常驻进程与多用户的在 Server；其余是渲染。**Server 的 SQLite 只存索引与聚合，从不与文件层争当事实来源。

## 源码结构

各包的目录设计(职责单一、按层拆分；文件头注释即该文件的设计说明):

```text
packages/
├── core/src
│   ├── agent.ts / session.ts       # createAgent 组装层与 Session(run / compact / generateTitle)
│   ├── session-title.ts            # 一次性标题生成(旁路 LLM 调用,不入 Trace)
│   ├── engine/context-engine.ts    # ReAct 循环编排:轮生命周期、审批、补发、重连、压缩
│   ├── omnimessage/                # types.ts 协议类型 · builders.ts 构造函数 · aggregate.ts 分片聚合
│   ├── llm/                        # generative-model.ts AgentHub 适配 · tool-call-ids.ts id 唯一化
│   ├── environment/                # environment.ts 执行与收尾 · tools/ 注册表、6 个内置工具、后台会话
│   ├── state/                      # paths · default-config · project-config · model-catalog
│   │                               # agent-state(Skill 安装、提示词装配)· agent-vault · builtin-agents
│   ├── trace/                      # writer.ts 追加式 JSONL · resume.ts 回放恢复
│   └── internal/                   # 日期与 Session 辅助
├── cli/src                         # commander 入口 + run / chat / config / serve 命令与审批交互
├── server/src                      # app 组装 · db(node:sqlite)· auth · http/routes · runtime · services
├── web/src                         # api 客户端 · state · lib/omni 流渲染 · components · features 各页面
├── skills/                         # 加载器 + skills/<name>/SKILL.md 技能库
├── landing/                        # 产品落地页(含博客)
└── docs/                           # 本文档站
```

server 与 web 的内部结构分别见 [Server API](/server-api) 与 [Web App 指南](/web-app)。

## 三接口边界

context_engine 是整个系统的核心，它只做两件事：维护线性消息历史，以及在三个接口之间编排事件流。它只认识 [OmniMessage](/omni-message)，不做任何协议转换：

- **Human**——用户侧边界。它不是一个接口类：SDK 的唯一入口 `session.run(newMessages, { approve, signal })` 就是 Human 边界本身。输入是新增的 OmniMessage 列表与审批回调，输出是流式 OmniMessage。CLI 与 Server 是它的两种实现形态。
- **LLM**——模型侧接口(`LLMInterface`)。把 OmniMessage 翻译为模型网关 AgentHub 的请求，把流式事件翻译回 OmniMessage。所有 Provider 协议适配都在 AgentHub 内完成，core 不直接依赖任何模型厂商 SDK。
- **Environment**——工具执行接口(`EnvironmentInterface`)。执行通过审批的工具调用，把结果以流式 OmniMessage 送回。

这一边界设计的意义：引擎内核不含任何 Provider、工具或 UI 细节，三侧实现均可按配置替换(本地 shell、其他执行沙箱；CLI、Web、程序化调用)，而互不影响。接口签名详见[接口契约](/interfaces)。

## 一个 Task 的数据流

1. Human 把 Prompt(OmniMessage 列表)交给 `session.run`;
2. 引擎发起一次 Request：经 LLMInterface 流式产出 `partial_*` 与完整消息；
3. 每个完整的 `tool_call` 触发一次 `approve` 审批；通过后交 Environment 并发执行；
4. 工具输出按原始顺序回填，进入下一轮 Request;
5. 某轮不再产生 `tool_call`(最终答复)时 Task 结束。

全程的每条消息与事件同时流向两个去处：实时输出给 Human，以及追加写入 [Trace](/sessions-and-traces)。运行循环的细节(中断、重连、压缩)见 [Agent 运行循环](/agent-loop)。

## 状态层

引擎之下是纯文件的状态层，数据根目录为 `~/PenguinHarness`(`PENGUIN_HOME` 可改)，按 `<project>/<agent>/` 组织：

- **Agent State**——`agent_state/` 目录：`system_config.yaml`、`AGENTS.md`、Skills、Vault。Agent 的全部行为定义都是可编辑文件。
- **Project 配置**——`.project_config.toml`：模型表与凭据，模型身份恒为 `(provider, model_id)` 二元组。
- **Trace**——`traces/` 目录：追加式 JSONL，恢复 Session 的唯一事实来源。

Server 额外维护一个 SQLite 索引库(用户、授权、用量统计)，但从不复制文件层的事实——CLI、SDK 与 Web 共用同一份数据目录，可以混用。

## 关键设计决策

- **一个协议，三种职责**:OmniMessage 同时是 SDK 对外接口、Trace 落盘格式与引擎内部通货——「流出去的」「存下来的」「模型看到的」是同一种东西。
- **错误收敛为消息**:LLM 与 Environment 从不向引擎抛异常；结果携带五值 `stop_reason`(`completed | failed | aborted | timeout | malformed`)，仅 LLM 侧的 `timeout / malformed` 触发引擎内重连。
- **薄模型层**:core 只定义 `LLMInterface`,Provider 适配全部下沉到 AgentHub(`@prismshadow/agenthub`)，因此支持任意 OpenAI 兼容端点，见[模型与 Provider](/models)。

源码入口：`packages/core/src/engine/context-engine.ts`、`packages/core/src/interfaces.ts`。
