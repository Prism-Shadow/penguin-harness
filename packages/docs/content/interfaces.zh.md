---
title: 接口契约
description: 自顶向下的接口全览：LLMInterface 与 EnvironmentInterface 的完整签名、内层类型逐字段定义，以及每一处可替换的扩展点。
---

context_engine 依赖三个接口：Human、LLM、Environment。协议转换全部发生在接口实现内部——引擎只见 [OmniMessage](/omni-message)。本页自顶向下：先给出两大接口的完整签名与 Human 边界，再逐层展开每个接口的内部类型。类型全部由 `@prismshadow/penguin-core` 导出，源码见 `packages/core/src/interfaces.ts`。

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
         └─ AgentHub 网关       └─ BuiltinTool 注册表(run_command …)
```

| 接口 | 契约 | 内置实现 |
| --- | --- | --- |
| Human | `session.run` 的入参与流式出参 | CLI、Server(SSE) |
| LLM | `LLMInterface.streamGenerate` | `GenerativeModel`(基于 AgentHub) |
| Environment | `EnvironmentInterface.executeTool` 等 | `Environment` + 内置工具注册表 |

两条铁律贯穿所有接口：**从不向引擎抛异常**(错误收敛为带 `stop_reason` 的消息/返回值),**流式纪律**(`start → delta → stop`，随后立即产出完整消息)。

## LLMInterface

模型侧的完整契约只有一个方法：

```ts
interface LLMInterface {
  streamGenerate(parameters: GenerativeModelParameters): AsyncGenerator<OmniMessage, LLMOutcome>;
}

interface GenerativeModelParameters {
  newMessages: OmniMessage[];    // 仅本轮新增消息(实现自行维护历史,多 role 不接受)
  signal?: AbortSignal;
}
```

生成器逐条产出 `partial_*` 分片与完整消息，Token 用量以 `token_usage` 事件产出；终态经**返回值**(而非产出消息)给出。

### LLMOutcome 语义

```ts
interface LLMOutcome {
  status: StopReason;   // completed | timeout | malformed | aborted | failed
  message?: string;     // failed 时的展示文案
}
```

| status | 含义 | 引擎的反应 |
| --- | --- | --- |
| `completed` | 正常完成(已产出 token_usage) | 继续下一步 |
| `timeout` | 超时/断连 | 同一 run 内自动重连 |
| `malformed` | 响应解析失败 | 同一 run 内自动重连 |
| `aborted` | 用户中断 | 停止交还用户 |
| `failed` | 鉴权/参数等不可重试错误 | 停止交还用户 |

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
  thinkingLevel?: ThinkingLevelName;   // "none" | "low" | "medium" | "high" | "xhigh"
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

`executeTool` 逐条产出 `partial_tool_call_output`，并以恰好一条完整 `tool_call_output` 收尾；带 `origin` 的嵌套消息(如 `run_subagent` 转发的子 Session 消息)原样透传。渲染不是本接口的职责——流式渲染由 CLI / Web 前端完成。

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
  services?: EnvironmentServices;           // 注入给个别工具的运行时服务
  vault?: Record<string, string>;           // Vault 环境变量,注入 run_command / input_command 子进程
}

interface EnvironmentServices {
  subagentRunner?: SubagentRunner;          // run_subagent 所需
  visionDescriber?: VisionDescriberService; // text-only 模型的 describe_image 所需
  commandSessions?: CommandSessionManager;  // 长驻命令会话登记表(Environment 内部构造)
  subagentSessions?: SubagentSessionManager;// 后台 Subagent 会话登记表(同上)
}

interface MCPServerConfig {
  name: string;
  config: Record<string, unknown>;
}
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
type ApprovalDecision = "allow" | "deny";
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
```

约束：每个完整 `tool_call` 恰好被调用一次；回调抛出异常按 `deny` 处理；未注入时引擎默认全部拒绝(保守策略)。Subagent 继承父级的审批回调(调用时带 `origin` 标记)，审批策略天然贯穿整个委托树。

## Subagent 接口

Subagent 的创建能力在 `createAgent` 组装层注入，避免 Environment 反向依赖上层：

```ts
interface SubagentRunner {
  // 深度超限、目标 Agent 不存在等前置错误以抛出表达(由 Environment 收敛为 failed)
  spawn(input: {
    agentId?: string;     // 缺省复用当前 Agent(自派生)
    modelId?: string;     // 缺省继承父 Session 的模型
  }): Promise<SubagentHandle>;
}

interface SubagentHandle {
  sessionId: string;      // 子 Session id:消息 origin 的一跳,subagent_id 由其尾部派生
  run(input: {
    prompt: string;
    signal?: AbortSignal;
    approve?: ApproveFn;  // 父级审批回调,转发即继承
  }): AsyncGenerator<OmniMessage>;
  dispose(): void;        // 释放子 Session 运行时资源,幂等
}
```

派生(spawn)与运行(run)分离，同一子 Session 可以在一轮结束后接受追加 Prompt 继续运行(长驻 Subagent，经 `input_subagent` 驱动)。子 Session 在同一 Workspace 中运行、拥有独立 Trace；嵌套深度当前限制为 1。

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
