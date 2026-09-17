---
title: 核心接口
description: 引擎背后的 Human、LLM 与 Environment 契约，附完整签名、内部类型与扩展点。
---

`context_engine` 依赖三个接口：Human、LLM 和 Environment。协议转换全部发生在实现内部，引擎能看到的只有 [OmniMessage](/omni-message)。

本页沿一轮运行的控制流展开：[Human 边界](#human-边界)、[LLM 契约](#llminterface)、[审批回调](#approvefn)和 [Environment 契约](#environmentinterface)。结尾介绍[子 Agent](#子-agent-接口) 和[视觉](#visiondescriberservice)服务，以及[扩展点](#扩展点)。

所有类型都从 `@prismshadow/penguin-core` 导出。源码位于 `packages/core/src/interfaces/`：

- `llm.ts`：模型侧需要的类型。
- `environment.ts`：Environment 侧需要的类型。
- `shared.ts`：两侧真正共用的词汇。
- `index.ts`：`@prismshadow/penguin-core/interfaces` 子路径背后的聚合导出入口。

## 三条边界

```text
            Human (a boundary, not a class)
            session.run(newMessages, { approve, signal })
                          │ ▲
                          ▼ │ streamed OmniMessage
                    context_engine
                     │            │
        LLMInterface │            │ EnvironmentInterface
                     ▼            ▼
        GenerativeModel        Environment
         └─ AgentHub gateway    └─ BuiltinTool registry (exec_command …)
```

| 接口 | 契约 | 内置实现 |
| --- | --- | --- |
| Human | `session.run` 的输入与流式输出 | CLI、Server（SSE） |
| LLM | `LLMInterface.streamGenerate` | `GenerativeModel`（经由 AgentHub） |
| Environment | `EnvironmentInterface.executeTool` 等 | `Environment` 与内置工具注册表 |

每个接口都遵守两条规则：

- **绝不向引擎抛异常。** 错误会转化成携带 `stop_reason` 的消息或返回值。
- **遵守流式纪律。** 流按 `start → delta → stop` 推进，完整消息紧随其后。

### 消息面与控制面

穿过三条边界的**内容**有且只有 OmniMessage：

- `session.run` 的输入与流式输出
- `streamGenerate` 的输入数组与产出的流
- `executeTool` 收到的已批准工具调用与输出流
- 子 Agent 一轮的输入与转发回来的消息
- 每次 Trace 写入

与这些内容并行的部分构成**控制面**。控制面刻意不做成消息形态，因为它们都不是对话内容：

| 控制面项目 | 所在位置 | 为什么不是消息 |
| --- | --- | --- |
| `signal: AbortSignal` | `RunOptions`、`GenerativeModelParameters`、`ToolExecutionRequest` | 中断若要在消息队列里排队等候，就不再是中断。 |
| `thinkingLevel` | `GenerativeModelParameters` | 逐请求参数，与超时同类：它说明请求怎么执行，而不是要说什么。引擎把当前生效的值保存在自己的状态里（`ContextEngine.setThinkingLevel`，由 `Session.thinkingLevel` setter 供值，一个带软限制的旋钮）。请求未携带时，套用 LLM 对象的构造默认值，也就是上下文的起始等级。`RunOptions` 不携带等级。 |
| `approve` 及其 `ApprovalDecision` | `RunOptions`、`ToolExecutionRequest` | 回调接收一个 OmniMessage 工具调用，返回三值枚举；引擎一拿到结果，立即写成一条 `approval_decision` 消息。 |
| `LLMOutcome` | `streamGenerate` 生成器的返回值 | 请求的终态，引擎的重试与重连策略以此为分支依据。生成器返回值由类型系统保证；「最后产出的消息必须是 `request_end`」只能是运行时约定。引擎据此写出那条 `request_end`。 |

其余不属于 OmniMessage 的内容都归 Environment 的管理面，在 [EnvironmentInterface](#environmentinterface) 一节说明。

## Human 边界

Human 刻意不定义成接口类。SDK 调用方*就是* Human：

```ts
const session = await agent.createSession({ workspaceDir, provider, modelId });

session.run(
  newMessages: OmniMessage[],                    // input: the Prompt
  opts?: RunOptions,
): AsyncGenerator<OmniMessage, RunCutoff | null>; // output: streamed OmniMessage; returns null when the run completed

interface RunOptions {
  signal?: AbortSignal;    // interrupt (e.g. Ctrl-C)
  approve?: ApproveFn;     // per-tool approval; denies everything when omitted
  preToolUse?: PreToolUseFn; // pre-tool-use hook consult; the Session wires it from installed hook packages
}

interface RunCutoff {       // how a run was cut off early
  kind: "abort" | "llm_failure" | "compaction_failure" | "max_turns";
  errorCode?: ErrorCode;    // mirrors the terminal record's error_code (none for max_turns)
  errorMessage?: string;    // mirrors the terminal record's error_message
}
```

CLI 把终端 I/O 接到这条边界上，Server 把 HTTP 请求和 SSE 通道接上去。任何以编程方式接入的调用方都成为新的 Human 实现，无需注册任何东西。

返回值说明这次运行是否真正跑完。失败不会发出 abort 事件，只会留下终态的 `request_end` 或 `compaction_end` 记录。所以，不能把被切断的运行当作已完成的代码，应当读取 `RunCutoff`，而不是从流里推断。

## LLMInterface

模型侧的完整契约只有一个方法：

```ts
interface LLMInterface {
  streamGenerate(parameters: GenerativeModelParameters): AsyncGenerator<OmniMessage, LLMOutcome>;
}

interface GenerativeModelParameters {
  newMessages: OmniMessage[];    // only this turn's new messages (the impl owns history; mixed roles rejected)
  signal?: AbortSignal;
  thinkingLevel?: ThinkingLevelName;   // per-request override; omitted = the construction default
}
```

生成器产出 `partial_*` 片段和完整消息，并通过 `token_usage` 事件上报 Token 用量。终态通过**返回值**报告，而不是通过某条产出的消息。

### LLMOutcome 语义

```ts
interface LLMOutcome {
  status: StopReason;      // completed | aborted | retryable | fatal
  errorCode?: ErrorCode;   // classified cause on a non-completed failure; carried onto request_end as error_code
  errorMessage?: string;   // failure detail: on fatal, and on retryable when a concrete error was caught;
                           // carried onto request_end as error_message, so the errors panel shows
                           // the real reason behind a retried request
}
```

| status | 含义 | 引擎反应 |
| --- | --- | --- |
| `completed` | 正常完成（`token_usage` 已经发出） | 继续执行 |
| `retryable` | 值得重试的失败：传输中断、空闲超时、408/429/5xx、格式错误或截断的响应，以及一切无法归类的错误 | 在本次运行内按退避阶梯重连 |
| `fatal` | 重试救不回来的失败：供应商 4xx 拒绝（408 和 429 除外）、凭证被拒，或发起任何网络 I/O 之前就能确定的客户端拒绝（例如给没有快速档位的模型开启快速模式） | 停止运行并呈现 `errorMessage` |
| `aborted` | 用户中断 | 停止，把控制权交还用户 |

status 只回答一个问题：这个请求要不要重试？errorCode 则说明失败属于哪一类。无法归类的错误有意归为 `retryable`：fatal 的判定采用白名单，网关即使用自己的措辞描述瞬时故障，也照样保留重试。

`fatal` 结果的补救办法是修改配置或凭证，然后重新发起请求。Session 创建时只有模型引用固定下来；凭证来自当前 Project 配置，所以更新 API key 后 Session 可以继续。

实现约束：

- 绝不抛异常。
- 不做内部重试。重连是引擎的职责，见 [Agent 运行循环](/agent-loop)。

### GenerativeModelConfig

内置实现的初始化配置，逐字段说明：

```ts
interface GenerativeModelConfig {
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  clientType?: string;             // AgentHub client protocol (openai-chat / openai-responses / …); inferred from modelId when omitted
  tools: ToolDefinition[];
  systemPrompt?: string;           // fully assembled system prompt, placeholders substituted
  contextWindow?: number;
  maxTokens?: number;
  fastMode?: boolean;              // per-model fast mode (AgentHub fast_mode; premium faster tier), off by default
  thinkingLevel?: ThinkingLevelName;   // construction default (a per-request parameter can override); "none" | "low" | "medium" | "high" | "xhigh" | "max"
  requestTimeoutMs?: number;       // Request idle budget: the longest wait for the next upstream event, default 300000; <=0 disables
  sessionId?: string;              // the Session's id, sent only to endpoints whose attribution header names the conversation
  toolCallIds?: ToolCallIdAllocator;   // Session-level tool_call_id registry (pass the same instance across compaction)
}
```

### 内置实现：GenerativeModel

`GenerativeModel`（`packages/core/src/llm/generative-model.ts`）基于 `@prismshadow/agenthub` 模型网关的 `AutoLLMClient` 实现这份契约。

**历史。** 网关**有状态地**维护对话历史，每轮只接收新消息。恢复 Session 时，通过一次性的 `setHistory` 重放已提交的历史。

**事件转换。** 内部的 `EventTranslator` 把网关流事件转换成 `partial_*` 片段和完整消息，并逐字保留每一项的不透明 `fidelity` 负载。分块方式与网关自身的聚合规则一致：

- thinking 块由自己的 fidelity 负载收尾。
- fidelity 相同的连续内容保持在同一个块里。OpenAI 兼容客户端会给每个 delta 打上相同的 `{ reasoning_field }`，不能因此把块切开。
- 文本段在 `fidelity.phase` 出现差异时拆分，出现 `fidelity.signature` 时结束。合并时 fidelity 键会累积。
- 完整消息按 thinking → text → tool_call 的顺序落定。

**思考摘要。** 每次请求都会向网关索取思考摘要（`thinking_summary`）。没有供应商会拒绝这个标记：对没有这项能力的模型家族，网关直接丢弃它；Claude 家族则把它理解为摘要式思考。除了让读者看到模型如何推理，它还能让推理阶段持续有事件到达。

**空闲超时。** `requestTimeoutMs` 度量的正是这些事件。计时器只在等待下一个上游事件时运行，每收到一个事件就重置一次。产出、审批、Trace 写入这些消费侧耗时一律不计。它限制的是静默时长，不是响应长度。

**工具调用 id。** `ToolCallIdAllocator` 用来应对把函数名当作调用 id 的供应商：入站时追加 `#n`，出站时再去掉。作用范围是整个 Session。

**供应商差异。** 工具调用格式、推理内容和流式事件的差异全部在网关内部吸收。见[模型与供应商](/models)。

## ApproveFn

`RunOptions` 和 `ToolExecutionRequest` 都携带这个回调类型：

```ts
type ApprovalDecision = "allow" | "deny" | "forbidden"; // "forbidden" = the command policy's veto
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
```

| 规则 | 行为 |
| --- | --- |
| 调用频率 | 每个完整的 `tool_call` 恰好调用一次 |
| 回调抛出异常 | 按 `deny` 处理 |
| 未注入回调 | 引擎拒绝一切（保守默认） |
| 子 Agent | 子 Agent 继承父级的审批回调，调用时会带上 `origin` 标记，审批策略因此覆盖整棵委托树 |

`"forbidden"` 永远不是宿主给出的答案。`Session.run` 会用 [Project 命令策略](/configuration#命令策略)包装注入的回调，命中策略的命令不会问到宿主，直接得到 `"forbidden"`。

两种拒绝都只产生一行固定的 `aborted` 输出：`"deny"` 对应「Tool call denied by user.」，`"forbidden"` 对应「Tool call denied by policy.」。决定值本身随 `approval_decision` 事件传递，Trace 不用额外字段就能记录决策者。已有回调如果只返回 `"allow"` 或 `"deny"`，无需任何改动。

## EnvironmentInterface

工具执行契约的核心：

```ts
interface EnvironmentInterface {
  listTools(): Promise<ToolDefinition[]>;
  executeTool(request: ToolExecutionRequest): AsyncGenerator<OmniMessage>;
  toolPermission(name: string): "r" | "rw" | undefined;   // for frontend approval-mode decisions
  dispose?(): void;                                        // release runtime resources; idempotent
}
```

这个接口承载两个面，只有第一个属于 Agent 循环：

- **消息面**是 `executeTool`，`context_engine` 在这里调用的唯一方法。进去一个 OmniMessage 工具调用，出来一条 OmniMessage 流。
- **管理面**是 `listTools`、`toolPermission`、`dispose` 和下面的可选成员。它们都不经过引擎，服务于 Session 组装和宿主自己的 UI，比如 Web App 的进程面板和子 Agent 面板，或者审批模式的权限查询。这些都是返回普通数据的普通方法调用，所以不做成消息形态：把它们改成消息，引擎的边界也不会更纯粹。

| 可选管理成员 | 用途 |
| --- | --- |
| `listBackgroundCommands()`、`killBackgroundCommand(processId)` | 列出后台命令进程；按 id 杀掉其中一个（整个进程组） |
| `probeBackgroundCommandServices()` | 重新探测命令的监听端口，更新检测到的服务 URL |
| `detachToolCall(toolCallId)` | 请求把一个运行中的调用转入后台任务继续执行（Web App 卡片上的按钮）；返回 `detached`、`not_running` 或 `not_detachable` |
| `listBackgroundSubagents()`、`hasRunningBackgroundSubagents()` | 列出存活的子 Session；报告后台子 Agent 是否正处于某轮运行中 |
| `sendToBackgroundSubagent(childSessionId, messages, opts?)` | 给运行中的子 Agent 发插话消息、让空闲的子 Agent 开启后续一轮，或者复活已释放的子 Agent（`opts.resume`）；返回 `steered`、`started`、`resumed`、`busy` 或 `gone` |
| `abortBackgroundSubagentRun(childSessionId)` | 停止子 Agent 当前这轮运行；Session 本身继续存活 |
| `setBackgroundSubagentThinkingLevel(childSessionId, level)` | 固定一个存活子 Agent 的思考等级 |
| `setSubagentApprovalFallback(approve)` | 挂上宿主的兜底审批出口，处理子 Session 的审批请求；它与 Session 同生命周期 |
| `setSubagentStateListener`、`setBackgroundStateListener`、`setBackgroundTaskListener`、`setBackgroundMessageListener` | 为子 Agent 运行状态变化、后台任务状态变化、完成报告和后台子 Agent 实时消息各挂上唯一的监听器 |

`executeTool` 产出 `partial_tool_call_output` 片段，最后恰好以一条完整的 `tool_call_output` 收尾。带 `origin` 标记的嵌套消息（例如 `run_subagent` 转发的那些）原样通过。

内置 Environment 可以把截断的文本保存在 Session scratchpad 里，而不必通过这个公开接口暴露存储生命周期钩子。展示给模型的恢复路径是普通的绝对路径。Windows 上路径使用正斜杠，Node 的 fs API 和包内工具所用的 Git Bash 都接受这种写法，所以同一个写法既能直接用作 `read_file` 的参数，也能直接写进 shell 命令。

渲染不在这个接口的职责范围内。流式渲染属于 CLI 和 Web 前端。

### ToolExecutionRequest 与 EnvironmentConfig

```ts
interface ToolExecutionRequest {
  toolCall: OmniMessage<ToolCallPayload>;   // an approved call
  signal?: AbortSignal;
  approve?: ApproveFn;                      // forwarded to tools that spawn child Sessions (approval inheritance)
}

interface EnvironmentConfig {
  workspaceDir: string;
  toolConfig: ToolConfig;                   // { customTools: ToolDefinitionConfig[]; mcpServers: MCPServerConfig[] }
  sessionScratchpadDir?: string;            // this Session's scratchpad (scratchpad/<sessionId>); enables truncated-output recovery
  services?: EnvironmentServices;           // runtime services injected into individual tools
  vault?: Record<string, string>;           // Vault env vars, injected into exec_command / input_command subprocesses
  proxyEnv?: () => ProxyEnvPolicy | null;   // command-subprocess proxy policy; re-read per spawn, absent or null = pass through
  controlEnv?: () => Record<string, string>; // host control variables (API address, token, Session coordinates); re-read per
                                            // spawn; override vault entries, never the hardened ones
  pathPrepend?: () => string[];             // directories put at the front of PATH for command subprocesses; re-read per spawn
  confineSpawn?: () => SpawnConfiner | null; // sandbox confinement for command subprocesses; re-read per spawn,
                                            // absent or null = commands spawn unconfined
}

// "strip" removes HTTP(S)_PROXY/ALL_PROXY (NO_PROXY kept); "inject" forces the explicit
// proxy over the inherited env: HTTP(S)_PROXY (+ lowercase twins) = url, NO_PROXY = noProxy
// (supplied pre-merged by the caller), inherited ALL_PROXY removed. Vault entries still win.
type ProxyEnvPolicy = { mode: "strip" } | { mode: "inject"; url: string; noProxy: string };

// Rewrites the exact argv a command is about to spawn so it runs confined. Fail-closed: a
// confiner that cannot enforce its policy throws, and the command fails to spawn.
type SpawnConfiner = (
  argv: readonly string[],
  opts: { cwd: string; workspaceDir: string },
) => readonly string[];

interface EnvironmentServices {
  subagentRunner?: SubagentRunner;          // needed by run_subagent
  visionDescriber?: VisionDescriberService; // injected for text-only models only: read_file describes images through it
  commandSessions?: CommandSessionManager;  // long-running command session registry (built by Environment)
  subagentSessions?: SubagentSessionManager;// background subagent session registry (likewise)
  backgroundDone?: (event: BackgroundTaskDoneEvent) => void; // completion-report sink for run_in_background launches (likewise)
  backgroundForward?: (msg: OmniMessage) => void;           // live message tap of a background subagent (likewise)
}

interface MCPServerConfig {
  name: string;                             // tool-name prefix: discovered tools appear as mcp__<name>__<tool>
  config: Record<string, unknown>;          // stays an open object at this seam; typed at assembly time by
                                            // environment/mcp into a transport description (stdio / http / sse),
                                            // see /tools § MCP Servers
}
```

`Agent.createSession()` 和 `resumeSession()` 会自动传入 Session scratchpad 目录。自行管理稳定的逐 Session 目录的独立嵌入方，传入这个目录即可启用，不需要任何归档专用的类型：

```ts
const environment = new Environment({
  workspaceDir,
  toolConfig,
  sessionScratchpadDir, // e.g. <dataRoot>/<project>/agents/<agent>/scratchpad/<sessionId>
});
```

### 内层工具契约：BuiltinTool

在 Environment 内部，每个工具都遵循一份刻意更窄的契约（「工具宽松，框架严格」）：

```ts
interface BuiltinTool {
  name: string;
  definition: ToolDefinitionConfig;
  detachable?: boolean;              // has a background form a running call can be moved to
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,       // { workspaceDir, toolCallId, signal?, detachSignal?, approve? }
  ): AsyncGenerator<OmniMessage, ToolResult | void>;
}

interface ToolDefinitionConfig {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;   // JSON Schema
  permission?: "r" | "rw";
  forModel?: "vision" | "text-only";      // assembled per session-model class (unset by the built-in entries)
  timeoutMs?: number;                     // default 120000; <=0 disables
  maxOutputLength?: number;               // default 16000, head-kept truncation; <=0 disables
  call_description?: boolean;             // false filters the `description` call argument out of the schema; missing = kept
}
```

工具只发出内容 delta。分帧、超时、截断、`stop_reason` 优先级，以及把错误转成消息，全部由 Environment 集中处理，工具作者几乎不可能破坏协议。

添加工具就是注册：在 `BUILTIN_TOOL_FACTORIES`（`packages/core/src/environment/tools/registry.ts`）里加一条 `name → factory` 条目。各工具的参数和行为见[工具与审批](/tools)。

## 子 Agent 接口

子 Agent 的创建能力在 `createAgent` 组装层注入，因此 Environment 不会反向依赖上层：

```ts
interface SubagentRunner {
  // Precheck errors (depth limit, unknown agent) are thrown — Environment collapses them to a fatal result
  spawn(input: {
    agentId?: string;     // defaults to the current Agent (self-spawn)
    modelId?: string;     // paired with provider; both omitted = inherit the parent Session's model
    provider?: string;    // required whenever modelId is given (a model reference is the pair)
    thinkingLevel?: ThinkingLevelName; // omitted = inherit the parent Session's effective level
  }): Promise<SubagentHandle>;
  resume?(input: { agentId?: string; sessionId: string }): Promise<SubagentHandle>; // revive a released child Session
}

interface SubagentHandle {
  sessionId: string;      // the child Session id: the origin hop; subagent_id derives from its tail
  takeMeta?(): OmniMessage | null; // one-shot take of the child's session_meta (a background launch forwards it upfront)
  run(input: {
    messages: OmniMessage[];  // the round's input, the shape Session.run takes a Prompt in
    signal?: AbortSignal;
    approve?: ApproveFn;  // the parent's approval callback — forwarding is inheritance
  }): AsyncGenerator<OmniMessage, RunCutoff | null>; // returns null when the round completed
  steer?(messages: OmniMessage[]): boolean; // queue a steering message for a running round; false when none is running
  setThinkingLevel?(level: ThinkingLevelName): void; // pin the child's thinking level from its next request
  dispose(): void;        // release the child Session's runtime resources; idempotent
}
```

创建与运行是分开的两步，所以一轮结束后，同一个子 Session 还能继续接收后续 Prompt。`input_subagent` 就是这样驱动长期运行的子 Agent 的。已释放的子 Session 可以用 `resume` 复活，恢复它自己的历史、模型和 Workspace。子 Session 运行在同一个 Workspace 里，各自拥有独立的 Trace。嵌套深度目前上限为 1。

某一轮中途被切断时，返回值会说明这一点，父级据此把这一轮报告为失败，而不是把半截答案交给模型。

一轮的输入是一个 OmniMessage 列表：和 `steer` 接受的形状相同，也是宿主传给 `EnvironmentInterface.sendToBackgroundSubagent` 的形状。进入子 Session 的两条途径使用同一套词汇。每条消息的 `sender` 由调用方负责。模型自己发起的派发（`run_subagent`、`input_subagent`）会打上 `parent_agent`，宿主面板里来自人的消息则不带标记，子 Agent 的 Trace 由此能记录到底是谁在说话。

## VisionDescriberService

为纯文本模型代读图像的服务。Session 模型无法查看图像时，`read_file` 需要这个服务；工具正是靠它是否存在来判断这一点：

```ts
interface VisionDescriberService {
  modelId: string | null;          // null when the Project has no vision_model — the tool ends with a failed explanation
  createLLM?: () => LLMInterface;  // one-shot LLM for the vision model (no tools, no system prompt)
}
```

## 扩展点

| 目标 | 做法 |
| --- | --- |
| 更换或自定义模型访问 | 实现 `LLMInterface`（或者只为 OpenAI 兼容端点设置 `client_type`） |
| 更换执行沙箱 | 实现 `EnvironmentInterface` |
| 约束 Agent 执行的命令 | 给 `confineSpawn` 提供一个 `SpawnConfiner` |
| 添加工具 | 实现 `BuiltinTool` 并注册工厂，然后在 `system_config.yaml` 的 `tools.builtin` 下列出这个工具（没有注册工厂的条目直接跳过）；或者在 `tools.mcpServers` 下接入 MCP 服务器 |
| 自定义审批策略 | 注入一个 `ApproveFn`（CLI 和 Web 的审批模式都是对它的封装） |
| 修改 Agent 的行为 | 编辑它的 Agent State（`system_config.yaml`、`AGENTS.md`、Skill）；见[配置参考](/configuration) |
