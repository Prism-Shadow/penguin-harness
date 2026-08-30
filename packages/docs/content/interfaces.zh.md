---
title: 接口契约
description: 自顶向下的接口全览：LLMInterface 与 EnvironmentInterface 的完整签名、内层类型逐字段定义，以及每一处可替换的扩展点。
---

context_engine 依赖三个接口：Human、LLM、Environment。协议转换全部发生在接口实现内部——引擎只见 [OmniMessage](/omni-message)。本页自顶向下：先给出两大接口的完整签名与 Human 边界，再逐层展开每个接口的内部类型。类型全部由 `@prismshadow/penguin-core` 导出，源码见 `packages/core/src/interfaces/`——`llm.ts`(模型侧所需)、`environment.ts`(Environment 侧所需)、`shared.ts`(两侧确实共用的词汇)，以及 `index.ts`：`@prismshadow/penguin-core/interfaces` 子路径背后的 barrel。

## 总览

```text
            Human(边界,非接口类)
            session.run(newMessages, { approve, signal })
                          │ ▲
                          ▼ │ 流式 OmniMessage
                    context_engine
                     │            │
        LLMInterface │            │ EnvironmentInterface
                     ▼            ▼
        GenerativeModel        Environment
         └─ AgentHub 网关       └─ BuiltinTool 注册表(exec_command …)
```

| 接口 | 契约 | 内置实现 |
| --- | --- | --- |
| Human | `session.run` 的入参与流式出参 | CLI、Server(SSE) |
| LLM | `LLMInterface.streamGenerate` | `GenerativeModel`(基于 AgentHub) |
| Environment | `EnvironmentInterface.executeTool` 等 | `Environment` + 内置工具注册表 |

两条铁律贯穿所有接口：**从不向引擎抛异常**(错误收敛为带 `stop_reason` 的消息/返回值),**流式纪律**(`start → delta → stop`，随后立即产出完整消息)。

### 消息面与控制面

三条边界上流动的**内容**只有 OmniMessage，没有别的——`session.run` 的输入与流式输出、`streamGenerate` 的输入数组与产出流、`executeTool` 的已批准调用与其输出流、子会话一轮的输入与被转发的消息，以及每一次 Trace 写入。

与之**并行**流动的是**控制面**，刻意不做成消息形态——它们都不是对话内容：

| 控制面项 | 位置 | 为什么不是消息 |
| --- | --- | --- |
| `signal: AbortSignal` | `RunOptions`、`GenerativeModelParameters`、`ToolExecutionRequest` | 要在消息队列里排队才生效的打断，就不叫打断了。 |
| `thinkingLevel` | `GenerativeModelParameters` | 逐次请求参数，与超时同类——它说的是这次请求怎么跑，而不是说了什么。引擎从不设置它：模型上下文的思考等级是 LLM 对象的构造默认值，上下文内固定（`RunOptions` 不带等级）。 |
| `approve` 及其 `ApprovalDecision` | `RunOptions`、`ToolExecutionRequest` | 回调的入参是 OmniMessage 工具调用；答案是三值枚举，引擎拿到后立刻转写为 `approval_decision` 消息。 |
| `LLMOutcome` | `streamGenerate` generator 的返回值 | 本次 Request 的结束态，引擎的重试与重连策略全部据此分支。generator 的返回值由类型强制存在；「最后产出的消息必须是 `request_end`」只能是运行期约定。引擎正是据它写出那条 `request_end`。 |

除此之外仍非 OmniMessage 的部分，属于 Environment 的管理面，见下。


## LLMInterface

模型侧的完整契约只有一个方法：

```ts
interface LLMInterface {
  streamGenerate(parameters: GenerativeModelParameters): AsyncGenerator<OmniMessage, LLMOutcome>;
}

interface GenerativeModelParameters {
  newMessages: OmniMessage[];    // 仅本轮新增消息(实现自行维护历史,多 role 不接受)
  signal?: AbortSignal;
  thinkingLevel?: ThinkingLevelName;   // 本次请求的思考等级覆盖;缺省用构造默认值
}
```

生成器逐条产出 `partial_*` 分片与完整消息，Token 用量以 `token_usage` 事件产出；终态经**返回值**(而非产出消息)给出。

### LLMOutcome 语义

```ts
interface LLMOutcome {
  status: StopReason;   // completed | timeout | malformed | aborted | failed | auth
  message?: string;     // 失败详情:failed/auth 时携带;timeout/malformed 捕获到具体
                        // 错误时也携带——透传到 request_end,错误面板据此展示被重试
                        // 请求背后的真实原因
  permanent?: boolean;  // 标记该 failed 为确定性失败(发起网络请求前在客户端就被拒绝,
                        // 如在没有 fast 档位的模型上启用 fast_mode):引擎直接带消息
                        // 终止,不再重试
}
```

| status | 含义 | 引擎的反应 |
| --- | --- | --- |
| `completed` | 正常完成(已产出 token_usage) | 继续下一步 |
| `timeout` | 超时/传输层断连 | 同一 run 内自动重连 |
| `malformed` | 响应解析失败 | 同一 run 内自动重连 |
| `failed` | 分类器未判定为瞬时的错误(参数等) | 同样在同一 run 内自动重连——状态本身仍如实上报为 `failed`。例外：携带 `permanent: true`（确定性的客户端拒绝，如在没有 fast 档位的模型上启用快速模式）时立即带消息停止 |
| `aborted` | 用户中断 | 停止交还用户 |
| `auth` | 凭据被拒绝 | 停止交还用户——唯一从不重试的 LLM 终态；宿主据此禁用输入，直到该模型的 API key 被更新 |

实现约束：从不抛异常；不做内部重试(重连是引擎的职责，见 [Agent 运行循环](/agent-loop))。

### GenerativeModelConfig

内置实现的初始化配置，逐字段：

```ts
interface GenerativeModelConfig {
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  clientType?: string;             // AgentHub 客户端协议(openai / …);缺省按 modelId 推断
  tools: ToolDefinition[];
  systemPrompt?: string;           // 占位符替换完成后的完整系统提示词
  contextWindow?: number;
  maxTokens?: number;
  fastMode?: boolean;              // 单模型快速模式(AgentHub fast_mode;溢价快速档位),默认关闭
  thinkingLevel?: ThinkingLevelName;   // 构造期默认档位(逐请求参数可覆盖);"none" | "low" | "medium" | "high" | "xhigh" | "max"
  requestTimeoutMs?: number;       // 单次 Request 超时,默认 120000;<=0 关闭
  toolCallIds?: ToolCallIdAllocator;   // Session 级 tool_call_id 唯一性登记表(压缩重建时传同一实例)
}
```

### 内置实现：GenerativeModel

`GenerativeModel`(`packages/core/src/llm/generative-model.ts`)把契约落到模型网关 `@prismshadow/agenthub` 的 `AutoLLMClient` 上：

- 网关**有状态**地维护会话历史，每轮只接收新消息；恢复 Session 时经一次性的 `setHistory` 重放已提交历史；
- 内部的 `EventTranslator` 把网关流式事件翻译为 `partial_*` 分片 + 完整消息，逐条原样保留不透明的 `fidelity` 保真负载；分段与网关自身的聚合一致——thinking 块由其 fidelity 负载闭合，连续相同的 fidelity 归为同一块(OpenAI 兼容客户端给每条增量盖同一个 `{ reasoning_field }`，不能因此切块)，text 段遇到不同的 `fidelity.phase` 即切分、遇到 `fidelity.signature` 即闭合，合并时 fidelity 键累积；完整消息按 thinking → text → tool_call 顺序落盘；
- `ToolCallIdAllocator` 处理个别 Provider 用函数名充当调用 id 的情况(入站追加 `#n`、出站剥离)，作用域覆盖整个 Session;
- Provider 协议差异(工具调用格式、思考内容、流式事件)全部在网关内抹平，见[模型与 Provider](/models)。

## EnvironmentInterface

工具执行侧的完整契约：

```ts
interface EnvironmentInterface {
  listTools(): Promise<ToolDefinition[]>;
  executeTool(request: ToolExecutionRequest): AsyncGenerator<OmniMessage>;
  toolPermission(name: string): "r" | "rw" | undefined;   // 供前端审批模式判定
  dispose?(): void;                                        // 释放运行时资源,幂等
}
```

本接口承载两条面，只有第一条属于 Agent 循环：

- **消息面**——`executeTool`，`context_engine` 在此唯一调用的方法：进去一条 OmniMessage 工具调用，出来一串 OmniMessage；
- **管理面**——`listTools` 与 `toolPermission`，以及可选的后台命令与子会话成员(各类列举、`killBackgroundCommand`、`sendToBackgroundSubagent`、`abortBackgroundSubagentRun`、监听器挂载与 `dispose`)。它们都不经过引擎：服务于 Session 装配与宿主自己的 UI——Web App 的进程面板与子会话面板、审批模式的权限查询——是返回普通数据的普通方法调用。这正是它们不做成消息形态的原因，也是把它们消息化并不会让引擎边界更纯的原因。

`executeTool` 逐条产出 `partial_tool_call_output`，并以恰好一条完整 `tool_call_output` 收尾；带 `origin` 的嵌套消息(如 `run_subagent` 转发的子 Session 消息)原样透传。内置 Environment 可以把被截断文本保存在 Session scratchpad 中，无需在此公共接口暴露存储生命周期钩子。其模型可见 recovery 路径是普通绝对路径；Windows 上统一写成正斜杠——Node 的 fs API 与包内 (Git) Bash 工具 Shell 都接受这种写法，同一拼写既可直接作 `read_file` 参数、也可用于 Shell 命令。渲染不是本接口的职责——流式渲染由 CLI / Web 前端完成。

### ToolExecutionRequest 与 EnvironmentConfig

```ts
interface ToolExecutionRequest {
  toolCall: OmniMessage<ToolCallPayload>;   // 已通过审批的调用
  signal?: AbortSignal;
  approve?: ApproveFn;                      // 转发给需要派生子 Session 的工具,实现审批继承
}

interface EnvironmentConfig {
  workspaceDir: string;
  toolConfig: ToolConfig;                   // { customTools: ToolDefinitionConfig[]; mcpServers: MCPServerConfig[] }
  sessionScratchpadDir?: string;            // 本 Session 的 scratchpad（scratchpad/<sessionId>），提供后启用截断输出恢复
  services?: EnvironmentServices;           // 注入给个别工具的运行时服务
  vault?: Record<string, string>;           // Vault 环境变量,注入 exec_command / input_command 子进程
  proxyEnv?: () => ProxyEnvPolicy | null;   // 命令子进程代理策略；每次 spawn 重读，缺省或 null 即原样透传
}

// "strip" 剥除 HTTP(S)_PROXY/ALL_PROXY（保留 NO_PROXY）；"inject" 以显式代理覆盖继承环境：
// HTTP(S)_PROXY（含小写拼写）= url、NO_PROXY = noProxy（由调用方预先合并），继承的 ALL_PROXY
// 一并移除。Vault 条目仍然优先。
type ProxyEnvPolicy = { mode: "strip" } | { mode: "inject"; url: string; noProxy: string };

interface EnvironmentServices {
  subagentRunner?: SubagentRunner;          // run_subagent 所需
  visionDescriber?: VisionDescriberService; // text-only 模型的 describe_image 所需
  commandSessions?: CommandSessionManager;  // 长驻命令会话登记表(Environment 内部构造)
  subagentSessions?: SubagentSessionManager;// 后台 Subagent 会话登记表(同上)
  backgroundDone?: (event: BackgroundTaskDoneEvent) => void; // run_in_background 完成回报的汇聚点(同上)
  backgroundForward?: (msg: OmniMessage) => void;           // 后台 Subagent 消息的实时转发出口(同上)
}

interface MCPServerConfig {
  name: string;                             // 工具名前缀:发现的工具以 mcp__<name>__<tool> 暴露
  config: Record<string, unknown>;          // 接口层保持开放对象;装配期由 environment/mcp 校验成
                                            // transport 描述(stdio / http / sse),见 /tools § MCP Server
}
```

`Agent.createSession()` 与 `resumeSession()` 会自动传入 Session scratchpad 目录。自行管理稳定
per-Session 目录的独立 embedder 只需提供该目录即可启用，不暴露归档专用类型：

```ts
const environment = new Environment({
  workspaceDir,
  toolConfig,
  sessionScratchpadDir, // 例如 <dataRoot>/<project>/agents/<agent>/scratchpad/<sessionId>
});
```

### 内层工具契约：BuiltinTool

Environment 之内，单个工具遵循更窄的契约(「松工具、紧框架」):

```ts
interface BuiltinTool {
  name: string;
  definition: ToolDefinitionConfig;
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,       // { workspaceDir, toolCallId, signal?, approve? }
  ): AsyncGenerator<OmniMessage, ToolResult | void>;
}

interface ToolDefinitionConfig {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;   // JSON Schema
  permission?: "r" | "rw";
  forModel?: "vision" | "text-only";      // 按 Session 模型类别装配
  timeoutMs?: number;                     // 默认 120000;<=0 关闭
  maxOutputLength?: number;               // 默认 16000,头部保留截断;<=0 关闭
}
```

工具只产出内容增量；封帧、超时、截断、`stop_reason` 优先级、错误转消息全部由 Environment 统一处理——工具作者几乎不可能写出破坏协议的工具。注册即扩展：向 `BUILTIN_TOOL_FACTORIES`(`packages/core/src/environment/tools/registry.ts`)添加一个 `名称 → 工厂` 条目即可。逐工具的参数与行为见[工具与审批](/tools)。

## Human 边界

Human 刻意不设计为接口类。SDK 的调用方就是 Human:

```ts
const session = await agent.createSession({ workspaceDir, provider, modelId });

session.run(
  newMessages: OmniMessage[],                    // 输入:Prompt
  opts?: RunOptions,
): AsyncGenerator<OmniMessage>;                  // 输出:流式 OmniMessage

interface RunOptions {
  signal?: AbortSignal;    // 中断信号(如 Ctrl-C)
  approve?: ApproveFn;     // 逐工具审批;未注入时默认全部拒绝
}
```

CLI 把终端输入输出接到这个边界上；Server 把 HTTP 请求与 SSE 通道接上来。任何程序化调用方接上来就是一种新的 Human 实现，无需注册。

## ApproveFn

```ts
type ApprovalDecision = "allow" | "deny" | "forbidden"; // "forbidden" = 命令策略的拦截
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
```

约束：每个完整 `tool_call` 恰好被调用一次；回调抛出异常按 `deny` 处理；未注入时引擎默认全部拒绝(保守策略)。Subagent 继承父级的审批回调(调用时带 `origin` 标记)，审批策略天然贯穿整个委托树。

`"forbidden"` 从不出自宿主之手：`Session.run` 用 [Project 命令策略](/configuration#沙箱安全策略)包装注入进来的回调，命中的命令在宿主被问到之前就以 `"forbidden"` 作答。两种拒绝的工具输出都是固定的 `aborted` 一句——`"deny"` 为 `Tool call denied by user.`，`"forbidden"` 为 `Tool call denied by policy.`——决定值本身随 `approval_decision` 事件落 Trace，无需额外字段即可分辨决定者。返回 `"allow"` / `"deny"` 的既有回调无需改动。

## Subagent 接口

Subagent 的创建能力在 `createAgent` 组装层注入，避免 Environment 反向依赖上层：

```ts
interface SubagentRunner {
  // 深度超限、目标 Agent 不存在等前置错误以抛出表达(由 Environment 收敛为 failed)
  spawn(input: {
    agentId?: string;     // 缺省复用当前 Agent(自派生)
    modelId?: string;     // 与 provider 成对给出;两者都缺省时继承父 Session 的模型
    provider?: string;    // 给出 modelId 时必填(模型引用即二元组)
    thinkingLevel?: ThinkingLevelName; // 缺省继承父 Session 的有效思考等级
  }): Promise<SubagentHandle>;
}

interface SubagentHandle {
  sessionId: string;      // 子 Session id:消息 origin 的一跳,subagent_id 由其尾部派生
  run(input: {
    messages: OmniMessage[];  // 本轮输入，与 Session.run 接收 Prompt 的形状一致
    signal?: AbortSignal;
    approve?: ApproveFn;  // 父级审批回调,转发即继承
  }): AsyncGenerator<OmniMessage>;
  dispose(): void;        // 释放子 Session 运行时资源,幂等
}
```

派生(spawn)与运行(run)分离，同一子 Session 可以在一轮结束后接受追加 Prompt 继续运行(长驻 Subagent，经 `input_subagent` 驱动)。子 Session 在同一 Workspace 中运行、拥有独立 Trace；嵌套深度当前限制为 1。

一轮的输入是 OmniMessage 数组——与 `steer` 相同的形状，也与宿主调用 `EnvironmentInterface.sendToBackgroundSubagent` 时相同的形状——通往子会话的两条路径由此说同一套词汇。每条消息的 `sender` 由调用方决定：模型自己派发(`run_subagent`、`input_subagent`)标记 `parent_agent`，宿主面板上真人发出的消息不带 sender，子会话的 Trace 因此记录的是真正说话的人。

## VisionDescriberService

text-only 模型的图像代读服务(`describe_image` 所需):

```ts
interface VisionDescriberService {
  modelId: string | null;          // Project 未配置 vision_model 时为 null,工具以 failed 说明收尾
  createLLM?: () => LLMInterface;  // 构造该视觉模型的一次性 LLM(无工具、无系统提示词)
}
```

## 扩展点一览

| 想要 | 做法 |
| --- | --- |
| 更换/自定义模型接入 | 实现 `LLMInterface`(或仅配置 `client_type` 走 OpenAI 兼容协议) |
| 更换执行沙箱 | 实现 `EnvironmentInterface` |
| 新增工具 | 实现 `BuiltinTool` + 注册工厂；或在 `system_config.yaml` 的 `tools.builtin` 中声明 |
| 定制审批策略 | 注入 `ApproveFn`(CLI/Web 的四种模式即其封装) |
| 改变 Agent 行为 | 编辑 Agent State:`system_config.yaml`、`AGENTS.md`、Skills，见[配置参考](/configuration) |
