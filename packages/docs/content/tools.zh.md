---
title: 工具与审批
description: 内置工具如何运行在同一套执行契约之下，每次调用如何经过审批、在 Trace 中留下审计记录，以及 MCP Server 如何接入。
---

PenguinHarness 刻意只提供一套极简的内置工具集。专用文件工具（`read_file` / `edit_file` / `write_file`）负责精确的读取和编辑，因为带行号的输出和精确字符串替换，比手写 `sed` 单行命令更可靠。Shell（`exec_command`）则是其他一切的通用兜底：运行程序、搜索、安装依赖。留下来的每个工具，都配得上它在 schema 上占用的 Token。

Environment 让每一次工具调用都走同一套共享契约，并集中处理收尾。本页先讲这套契约，之后依次介绍：各工具的配置字段、7 个内置工具和它们的后台行为、记录在 Trace 中的逐次调用审批，以及如何自定义工具集、添加 MCP Server。

## 执行契约

每个内置工具都实现同一个 `BuiltinTool` 接口（`packages/core/src/environment/tools/types.ts`）：

```ts
interface BuiltinTool {
  name: string;
  definition: ToolDefinitionConfig;
  detachable?: boolean; // has a background form a running call can be moved to (exec_command, run_subagent)
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): AsyncGenerator<OmniMessage, ToolResult | void>;
}

interface ToolExecutionContext {
  workspaceDir: string;
  toolCallId: string;
  signal?: AbortSignal;
  detachSignal?: AbortSignal; // fires when the host asks this call to continue as a background task
  approve?: ApproveFn; // forwarded to tools that spawn child Sessions (approval inheritance)
}

interface ToolResult {
  stopReason?: StopReason; // the tool's self-reported terminal state (lowest priority, see below)
  note?: string; // terminal marker appended outside the output budget (e.g. exit code)
  images?: string[]; // data-URL images, appended after the text output
}
```

工具本身只产出 `partial_tool_call_output` 增量，收尾由 Environment 集中处理：

- 流式分帧（start / stop），以及 `tool_call_id` 的全程传递；
- 超时控制，以及输出超过 `maxOutputLength`（默认 16000 字符）后只保留头部和尾部的截断；
- `stop_reason` 的优先级：用户中断 > 超时 > 工具抛错 > 工具自报。超时或抛错都会让调用以 `fatal` 结束；
- 输出永不为空：调用既没有产出文本也没有 note 时，用 `[no output]` 代替；
- `note`（例如退出码）和图片不计入输出预算、直接追加在末尾，因此截断长输出也不会丢掉终止标记。

截断时预算一分为二，头部窗口实时流出。收尾时，Environment 会发出 `[output truncated: kept first H and last T of C chars]` 标记，随后跟上尾部窗口。这个总数 `C` 能帮模型判断[恢复文件](#过长输出恢复)值不值得读。如果输出超过头部窗口、但在预算之内结束，收尾时会原样刷出，不加标记。

工具和 Environment 都不会向引擎抛异常。错误会转成模型能读懂、能据此作出反应的 `tool_call_output` 消息。参数不符合工具要求的调用会以 `fatal` 结束，全部输出就是一份纠错指南：

- 错在哪里；
- 实际收到的参数名，并指出哪些是未知的；
- 从 schema 复述出来的工具参数；
- 一次正确调用应有的结构。

只凭这份输出，就足以修好这次调用。消息结构见 [OmniMessage 协议](/omni-message)。

### 过长输出恢复

Agent Session 中的工具文本超过 `maxOutputLength` 时，模型、Web App 和 CLI 收到的仍是同样的头部和尾部窗口、带计数的截断标记和终止标记。「用户可见输出等于模型可见输出」这条流式不变量保持不变。

在这个可见上限之外，Environment 会追加一条简短的归档状态或路径 note，并保存一份归 Session 所有的恢复文件。文件里保存单次调用归档预算内的精确原文，超出部分则是限定大小的头部和尾部窗口。它是 Environment **收到的完整文本**：命令会话或子 Agent 会话这类生产者，可能已经在自己有限的未读缓冲区里，把溢出内容替换成了 `[... N chars of earlier output dropped ...]` 标记，在那之前丢失的文本，归档无法找回。

普通的多行归档，Agent 用现成的 `read_file`（`offset` / `limit`）读取。要读字节尾部或超长行，它会构造针对性的 shell 命令，比如 `rg` 或 `tail`；没有专门的取回工具。

note 里带一个普通绝对路径，总是括号内的最后一个元素。在 Windows 上路径使用正斜杠：`exec_command` 经 Git Bash 运行，Node 的 fs API 也接受正斜杠，所以同一种写法在 JSON 工具参数和 shell 命令里都能用。POSIX 路径原样保留，Session 路径本来就是普通绝对路径（从不带 `\\?\` 前缀），因此更换分隔符不会丢失任何内容。和其他路径一样，里面有空格时，在 shell 命令中要加引号。

core 为模型拼出的每一条路径都遵循同一写法规则：

- 系统提示词中的 App Data Dir / CWD 行；
- `[attached image/file: …]` 行；
- 目标模式的 goal 文件行（SDK 里的 `modelVisiblePath`）。

| 属性 | 恢复文件的行为 |
| --- | --- |
| 位置 | `scratchpad/<session-id>/truncated-tool-output/`，位于 Session 之下 |
| 创建 | 只在实际发生截断后才创建 |
| 权限 | 平台支持时设为私有 |
| 单次调用大小 | 最多 8 MiB；生产环境的字节上限还要再低 1 字节，保证 `read_file` 始终低于 8 MiB 的扫描上限 |
| 更大的输出 | 限定大小的头部和尾部窗口，中间带有明确的缺口标记 |
| 配额 | 只按单次调用计：Session 没有总字节数或文件数配额；并发捕获时，每次捕获各自最多保留一次调用的预算 |
| 生命周期 | 跨 Task、运行时销毁和 Session 恢复都可读，直到显式删除 Session 才随整个 scratchpad 一起移除；归档没有单独的清理机制 |

> [!WARNING]
> 恢复文件里是 Environment 收到的未经脱敏的工具文本。如果工具不小心读到凭据或其他敏感数据，磁盘上的本地副本会从可见窗口扩大到整个归档预算。

Trace 不会再存一份这些内容，但会记录展示给模型、Web App 和 CLI 的同一个绝对 Session 路径，这会暴露宿主的数据根目录布局。

归档写入失败不会改变原工具的 `stop_reason`。可见 note 和 stderr 警告只带一个简短的错误码（stderr 上另有工具名），从不带路径，也不带原始错误信息。

## 配置字段

每个工具由一个 `ToolDefinitionConfig` 描述：

| 字段 | 含义 |
| --- | --- |
| `name` | 工具名，与模型的 `tool_call.name` 对应 |
| `description` | 交给模型的工具描述 |
| `parameters` | 参数的 JSON Schema |
| `permission` | `"r"` 只读 / `"rw"` 读写 |
| `forModel` | `"vision"` / `"text-only"`：按 Session 模型的类别选用。省略表示对所有模型可用。没有内置条目设置它，因为 `read_file` 要同时服务两类模型 |
| `timeoutMs` | 单次调用超时（毫秒），默认 120000；`<=0` 表示禁用 |
| `maxOutputLength` | 输出长度上限（字符）；`<=0` 表示禁用 |
| `call_description` | 针对 `parameters` 中声明的 `description` 调用参数的逐工具开关（开启时必填）。缺省表示保留；`false` 则在组装时从 schema 中移除这个属性和它的 `required` 条目 |

## 内置工具

内置工具共 7 个，通过 `packages/core/src/environment/tools/registry.ts` 组装：

| 工具 | 权限 | 超时（ms） | 用途 |
| --- | --- | --- | --- |
| `exec_command` | rw | 120000 | 在 Workspace 中执行 shell 命令（有 bash 的环境通过 `bash -lc` 执行），流式输出 stdout/stderr |
| `input_command` | rw | 120000 | 通过 `process_id` 操控命令会话：写入 stdin、发送 Ctrl-C、轮询输出，或终止会话（`kill: true`） |
| `read_file` | r | 60000 | 读取文本文件，返回带行号（`cat -n`）的窗口，按 offset/limit 分页；或读取图片（路径或 URL）返回图片内容；对纯文本模型，由 `vision_model` 用文字描述图片 |
| `edit_file` | rw | 30000 | 在已有文件中精确替换字符串，并回显变更的 diff |
| `write_file` | rw | 30000 | 创建或覆盖整个文件，必要时自动创建父目录 |
| `run_subagent` | rw | 600000 | 把一个自包含的子任务委托给同一 Workspace 中的子 Agent |
| `input_subagent` | rw | 600000 | 轮询后台子 Agent、在运行中向它插话、停止它当前这次运行，或用后续 Prompt 继续对话 |

已有 Agent 保存的 `tools.builtin` 列表与写入时完全一致；设置界面可以编辑条目，但不会新增。因此：

- 在这套工具集出现之前创建的 Agent，不会自动获得后续新增的工具（例如文件工具）和新增的参数（`run_in_background`、`kill`、`abort`）。
- 已删除工具（`kill_command`、`kill_subagent`、`read_image`、`describe_image`）的条目不再参与组装。模型调用这类工具，会得到标准的未知工具错误。
- 在 `read_file` 支持图片之前保存的条目，仍保留旧的描述和超时，尽管背后的实现已经能读取图片。

要采用当前的定义，需要手动编辑 Agent 的 `system_config.yaml`，并从 `packages/core/src/state/default-config.ts` 的默认配置中复制相应条目。Agent 设置页上的**更新内核**只有在 **工具** 标签页不存在、或仍是未经编辑的旧默认值时才会重写这份列表；**还原为默认配置**则会始终重写，但会把整个配置一并重置。见[内核更新](/configuration#内核更新)。

### 调用描述

命令类和子 Agent 类工具（`exec_command`、`input_command`、`run_subagent`、`input_subagent`）都接受一个 `description` 参数：由模型撰写的一句话，说明这次调用正在做什么，CLI 和 Web App 会在调用执行期间显示这句话。

这个参数在 `system_config.yaml` 中声明为每个条目 `parameters` 里的一个普通 `description` 属性，因为工具 schema 完全存放在可编辑的配置里。它在配置中是 **必填** 的，因此凡提供这个参数的工具，模型总会给出值。前端可以从 schema 直接确定调用的展示形式，而不必在参数流式传来的过程中猜测；同时要求模型最先输出这个参数。

每个条目的 `call_description` 字段控制整个功能。字段缺省表示保留；`call_description: false` 会在组装时从 schema 中移除这个属性及其 `required` 条目。这个变更只发生在内存里，YAML 文件本身不会改动。

文件工具不接受这个参数，因为它们的 `file_path` 已经说明了调用在做什么。

### 命令会话

`exec_command` 先在前台等待。如果命令在 `yield_time_ms` 内没有结束，就转入后台，调用返回目前的输出和一个 `process_id`；此后由 `input_command` 操控。设置 `run_in_background: true` 后，`exec_command` 跳过前台等待：调用立即返回 `process_id`；进程退出时，结果会以一条自动用户消息的形式送达（参见[后台完成回报](#后台完成回报)）。

带 `kill: true` 的 `input_command` 可以终止以任一方式启动的会话。进程是真实的操作系统对象，终止就是真的销毁，因此「终止」是访问工具的一个参数，而不是一个独立的工具：

```text
exec_command(cmd)
  ├─ finishes within the foreground window (yield_time_ms, default 60000)
  │        ──► full output (+ an exit-code or signal note when it failed)
  ├─ still running ──► backgrounds, returns output so far + process_id
  │                  │
  │  input_command(process_id[, chars]) ──► write stdin / send Ctrl-C / poll
  │                  └─ loop until the command exits
  └─ run_in_background: true ──► returns process_id immediately
                     └─ on exit: completion report arrives as a user message
     input_command(process_id, kill: true) ──► SIGTERM the process group (SIGKILL after a grace period)
```

正常退出的命令不附加任何注记。非零退出会附加 `[exit code: N]`，因信号终止会附加 `[terminated by signal S]`；两种情况都以 `fatal` 结束调用。

工具参数（显式键）：

```ts
// exec_command
{
  cmd: string;             // required: the shell command to run (also accepted as `command`; the schema names only `cmd`)
  workdir?: string;        // working directory; defaults to the Workspace root, relative paths resolve against it
  yield_time_ms?: number;  // foreground wait; default 60000, minimum 250, capped below the tool timeout
  run_in_background?: boolean; // true = return process_id immediately; completion arrives as a user message
  description: string;     // required while call_description is on: one sentence shown to the user while the call runs, emitted first
}

// input_command
{
  process_id: string;      // required: the command-session id returned by exec_command
  chars?: string;          // characters for stdin; send "\u0003" alone to deliver Ctrl-C; empty = poll only
  kill?: boolean;          // true = terminate: kill the whole process group, return undelivered output, remove the session
  yield_time_ms?: number;  // wait; defaults 250 for writes, 110000 for empty polls (one poll waits out most builds; pass a smaller value to peek)
  description: string;     // required while call_description is on
}
```

**Shell：** 只要有 bash，命令就通过 `bash -lc` 执行，系统提示词会告诉模型当前使用的是哪个 shell。`PENGUIN_SHELL`（可执行文件名或路径）在所有平台上都能覆盖这个选择。否则按以下顺序挑选 shell：

- POSIX 上：先找 PATH 中的 `bash`，再找常见的 bash 绝对路径，然后是 `$SHELL` 登录 shell，最后是 `sh`。
- Windows 上：先找 PATH 中非 WSL 启动器的 `bash`（例如 Git for Windows），然后是内置的 MinGit bash，然后是 `pwsh`，最后是 `powershell`。

**Ctrl-C：** 在 POSIX 上，Ctrl-C 向会话的进程组发送 `SIGINT`，中断前台命令。Windows 无法向通过管道连接的子进程发送控制台信号，因此 Ctrl-C 在这里变成硬杀整个命令会话树（`taskkill /t /f`）：前台命令及其启动的所有子进程一并终止，而不只是中断前台命令。

### 文件工具

`read_file` / `edit_file` / `write_file` 与 shell 工具一样，以用户的完整权限运行。相对路径以 Workspace 为基准解析，也允许绝对路径。符号链接会解析到它指向的文件：读取、编辑和写入都作用于目标文件，链接本身仍是链接。`read_file` 拒绝读取机密存储 `.vault.toml` 和 `.project_config.toml`：无论文件位于哪个目录、路径是否经过符号链接，都按文件名匹配。

文件工具返回单个最终输出，而不是流式输出；唯一的例外是：对纯文本模型，`read_file` 会流式返回视觉模型对图片的描述。这些工具从不抛出异常。失败时以解释性文字返回，并带有 `stop_reason: fatal`。

`edit_file` 和 `write_file` 在服务器进程内按文件串行执行，串行键取文件的真实路径，因此符号链接与其目标算作同一个文件。并行编辑同一文件时，会依次应用各次修改；如果前一次编辑已经移除了某个 `old_string`，后续编辑将匹配失败，而不是覆盖前面的修改。其他进程的写入不受这把锁约束。

`read_file` 除文本外还能读取图片。图片分支接受不超过 5MB 的 png、jpeg、gif 或 webp 文件（先按魔数识别，再按扩展名识别），也接受 `file_path` 中给出的 http(s) URL。URL 只能用作图片来源，且会先检查响应的 content-type。

返回什么取决于 Session 模型的 vision 标志：

- 支持图片的模型会直接拿到图片内容，文字输出只有一行，例如 `image/png, 123.4 kB`。
- 纯文本模型则由 Project 的 `vision_model` 回答 `prompt`（默认是一段详细描述），以工具文字输出的形式流式返回。图片本身不会进入这个 Session 的历史。未配置 `vision_model` 时，在纯文本 Session 中读取图片会失败，并提示用户到模型设置中选择一个。参见[模型与供应商](/models)。

走哪个分支由 `VisionDescriberService` 决定；SDK 只在纯文本 Session 时才向 Environment 注入它，因此一条配置（不带 `forModel`）即可同时服务两类模型。

```ts
// read_file — cat -n style output (line number, tab, content) for text; overlong single lines
// are truncated, and binary content that is no supported image (NUL bytes) is rejected with
// advice to use the shell. An image (or an http(s) URL) returns image content or a text
// description instead, and ignores offset/limit.
{
  file_path: string;       // required: absolute, or relative to the Workspace; an http(s) URL for an image
  offset?: number;         // 1-based line to start from; default 1
  limit?: number;          // max lines returned; default 2000 — a trailing note points at the continuation
  prompt?: string;         // a question about an image, answered by the vision_model for a text-only model; default: a detailed description
}

// edit_file — the file must exist; old_string must occur exactly once (or set replace_all);
// success echoes "Replaced N occurrence(s)" plus a git-style unified diff of the changed
// regions (one hunk per site, nearby sites merged; replace_all storms are capped at a few
// hunks plus an "…and N more replacements" note).
{
  file_path: string;       // required
  old_string: string;      // required: exact text to replace, including whitespace/indentation
  new_string: string;      // required: must differ from old_string
  replace_all?: boolean;   // replace every occurrence; default false
}

// write_file — creates parent directories as needed; reports "Created" vs "Overwrote" with
// lines/bytes. An overwrite also shows a small unified diff against the previous content,
// or a one-line +X/−Y summary when the change is large.
{
  file_path: string;       // required
  content: string;         // required: full file content; an empty string creates an empty file
}
```

### 子 Agent

`run_subagent` 把一个能用单条 Prompt 完整描述的子任务交给子 Agent。它的两阶段流程与命令一致：前台窗口期（默认 300000ms）过后，子 Agent 转入后台并获得一个 `subagent_id`，之后由 `input_subagent` 操控。轮询等待期间，子 Agent 待审批的请求也会一并呈现。

`input_subagent` 覆盖四种操作：

1. `prompt` 为空表示轮询。
2. 子 Agent **运行中**时发送的 `prompt`，会在运行途中注入一条插话消息。这与用户在主会话中插话是同一机制：消息会在子 Agent 的下一步以 `[user_steering]` 到达，记入子 Agent 的 Trace 时发送者标记为 `parent_agent`。
3. 子 Agent 空闲时发送的 `prompt`，会在同一 Session 中开启一轮后续对话。
4. `abort: true` 只停止子 Agent **当前这次运行**。Session 保留下来，仍可插话和继续对话；配合 `prompt` 使用，则中断当前运行并把它引向新的方向。

每次 `input_subagent` 调用都会向模型返回子 Agent **最近一次完整回复**：这是对它上一次发言的幂等快照，而不是增量式的逐段取回。

设置 `run_in_background: true` 后，启动调用立即返回 `subagent_id`；模型发起的每一轮结束时，都会以一条自动用户消息送达完成通知。从面板启动的轮次、以及经显式 abort 结束的轮次则保持静默（参见[后台完成回报](#后台完成回报)）。

子 Agent **没有对应的 kill 操作**。与主 Agent 的 Session 一样，子 Agent 的 Session 永不销毁。释放一个空闲 Session 只是腾出它的槽位；已释放的 `subagent_id` 再次收到消息时会**自动复活**，模型和面板共用同一条恢复路径。

Web App 的子 Agent 面板用**与主对话相同的输入框**（子 Agent 变体）操控选中的子 Agent，包含：

- 消息正文；
- Skill 和斜杠 Skill 命令；
- 思考等级选择器，从子 Session 的下一次 LLM 请求起固定它的思考等级；
- 上下文环，显示子 Agent 自身的用量；
- 模型锁定徽标；
- 审批模式选择器，修改的是父 Session 的模式，因为子 Agent 的审批正是按这个模式判定。

无论子 Agent 处于什么状态，消息都是发给它的用户输入：运行中就是插话，空闲时就是一轮后续对话，Session 已释放时就是**复活**。复活子 Agent 时，服务器会恢复子 Session（连同它自己的历史、模型和 Workspace）并重新接管，对话就这样继续下去。操作按钮的停止形态只中止子 Agent 当前这次运行。这一切都通过与 `input_subagent` 相同的核心通道完成；面板上的运行中标记跟随的是服务器端子 Agent 的实时状态，而不是对话记录。

```ts
// run_subagent
{
  prompt: string;          // required: the complete subtask (all context + the exact final output expected)
  agent_id?: string;       // the child Agent; defaults to the current Agent
  model_id?: string;       // the child Session's model, paired with provider; omit both to inherit the parent Session's model
  provider?: string;       // the provider group model_id belongs to; required whenever model_id is given
  thinking_level?: string; // "low" | "medium" | "high" | "xhigh" | "max"; omit to inherit the parent Session's level
  yield_time_ms?: number;  // foreground wait; default 300000
  run_in_background?: boolean; // true = return subagent_id immediately; completion arrives as a user message
  description: string;     // required while call_description is on
}

// input_subagent
{
  subagent_id: string;     // required: the background Subagent id returned by run_subagent
  prompt?: string;         // steering interjection while the child runs; a follow-up round while it is idle; empty = poll only
  abort?: boolean;         // stop the child's CURRENT run (session kept; the aborted round sends no completion report); with a prompt: interrupt and redirect
  yield_time_ms?: number;  // wait; defaults 300000 with a prompt, 10000 for empty polls
  description: string;     // required while call_description is on
}

```

- 深度上限为 1：子 Agent 不能再派生另一个子 Agent。
- 子 Session 跟随父 Session，而不是 Project 的默认值：模型（除非 `model_id` / `provider` 另有指定）和 Workspace 都取自父 Session。
- 思考等级同样跟随父 Session，除非 `thinking_level` 另有指定（成本低的机械性子任务用低等级，困难的分析用高等级）。子 Session 从创建起就继承父 Session 的等级；父 Session 没有显式设置时，继承的则是它当前上下文开启时的等级。父 Session 在对话中途设置的等级不会向下传递。
- 子 Session 继承父 Agent 的审批回调，因此审批模式跟随父 Session。
- 子 Session 拥有自己的 Trace，父 Session 通过一个 `subagent` 指针事件与它关联。子 Agent 的消息带 `origin` 标签流回父 Session 的消息流。参见 [Session 与 Trace](/sessions-and-traces)。

### 后台完成回报

用 `run_in_background: true` 启动的任务，以及用户在 Web App 中从调用卡片[转入后台](/chat#把工具调用转入后台)的运行中调用，完成时都会以一条**由 harness 注入的用户消息**报告。模型无需轮询。

用户转入后台的调用，会在自己的结果里说明这一点。这条提示告诉模型不要再过问这项工作（不要轮询、不要输入），转去做别的工作或结束本轮。用户把它转入后台，正是为了让模型别再跟进；完成通知会自行送达。

消息以一个 `[background_task_done]` 标记块开头（包含 kind、id、status 和一行细节），随后是执行的内容和输出，上限 4000 字符：命令取尚未送达输出的末尾；子 Agent 则取它最近一次完整回复的结尾。Web App 把这个块显示为可折叠的通知。消息的 `text` 载荷带有 `sender: "harness"`，在 Trace 中以此与真人输入区分（参见 [OmniMessage](/omni-message)）。

报告何时送达取决于 Session 的状态：

- **Task 正在运行：** 报告搭乘下一个轮次边界送达。已经在流式输出的最终回复不会错过它；Task 会再多走一轮来作出反应。
- **Session 空闲：** 托管服务器会启动一个新 Task 来承载报告。SDK 嵌入方可以通过 `Session.onBackgroundNotice` / `takeBackgroundNotices` 订阅，或者让报告前置到下一次运行的开头。

以下情况不发送报告：

- 通过 `input_command` 的 `kill` 终止的命令：那次调用自身的结果已经说明了结局；
- 经显式 `abort` 结束的子 Agent 轮次：发起 abort 的调用方会直接读到结局；
- 用户从子 Agent 面板发起的轮次：这是用户与子 Agent 自己的对话。回答文本会留在面向模型的缓冲区里，供下一次轮询使用。报告只覆盖**模型发起的轮次**：`run_in_background` 启动的运行，以及 `input_subagent` 的后续轮次。

**停止不等于失败。** 有意终止的命令报告 `status: stopped`，标记块里会直白地写明：没人要求就不要重启它。有意为之的停止包括：

- 用户在 Web App 进程列表里按下**停止**按钮；
- 外部发来的停止信号（`SIGTERM` / `SIGINT` / `SIGHUP`），例如在同一进程组的终端里按 Ctrl-C、执行 `pkill`，或 supervisor 关闭开发服务器；
- harness 自己强制执行的停止，例如容量驱逐或空闲回收。

对话确实需要知道：它启动的开发服务器已经停了。如果写成 `failed`，读起来就像一次崩溃，而对崩溃的开发服务器，合理的反应是重新启动，这恰恰推翻了刚刚有人要求的停止。`failed` 只留给无人要求的结果：spawn 错误、非零退出、硬杀，以及 OOM kill、segfault 这类故障信号。

后台子 Agent 的生命周期独立于启动它的调用：

- **中止：** 中止范围属于它自己。针对单次运行的 `abort` 只结束一轮；Session 本身只在父 Session 结束时才结束，即便曾因容量压力释放过，也仍可复活。
- **消息：** 通过发起它的 Session 实时流式传到前端，走的是与前台窗口相同的带 origin 标签的通道。
- **审批：** 由发起调用自己的审批回调处理，回调会一直挂载。因此 `allow-all` 方式启动的子 Agent 可以无人值守运行；即使失败，也会以 `status: failed` 报告收尾，而不是让子 Agent 无限期等待。

### 后台会话上限

| Session 类型 | 上限 | 驱逐策略 |
| --- | --- | --- |
| 命令会话 | 64 | 满员时优先驱逐已退出的会话；否则终止并驱逐最近最少使用的会话 |
| 子 Agent 会话 | 8 | 只驱逐已完成的会话，绝不驱逐运行中的会话；没有空间时直接拒绝创建 |

## 审批

每个完整的 `tool_call` 都恰好对应一次审批决策：

```ts
type ApprovalDecision = "allow" | "deny" | "forbidden"; // "forbidden" = the command policy's veto
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
```

| 入口 | 行为 |
| --- | --- |
| SDK | 每次调用 `session.run` 时传入 `approve`。若不注入，引擎默认拒绝所有调用，因此无人值守时不会有任何操作获得批准 |
| CLI | `--approve` 有四种模式：`allow-all`（默认）、`deny-all`、`read-only`、`always-ask`。`read-only` 自动批准 `permission: "r"` 的工具，其余交给人工处理。这个标志设置 CLI 所驱动的服务器端 Session 的审批模式；不设置时，运行在 Agent 命令里的 CLI 会继承调用方 Session 的模式 |
| Web / Server | 同样四种模式，按 Session 各自设置。每次决策都从数据库重新读取模式，因此改动立即生效。工具的 `r` / `rw` 取自运行上下文的工具集，因此权限改动在下一次轮换（压缩）时生效。人工决策通过 API 传入 |

已安装的 pre-tool-use 钩子先于审批回调生效。钩子返回 `deny` 会直接拒绝调用，返回 `allow` 会直接批准，两者都不询问；但[命令策略](/configuration#命令策略)依然会否决它所匹配的调用，哪怕钩子已经放行。参见 [Pre-tool-use 钩子](/agent-loop#pre-tool-use-hook)。

被拒绝的调用会收到一条合成的 `aborted` `tool_call_output`，供模型据此作出反应。文案会指明决策方：

| 决策方 | 输出 |
| --- | --- |
| 人工或审批模式（`deny`） | `Tool call denied by user.` |
| 命令策略（`forbidden`） | `Tool call denied by policy.` |
| pre-tool-use 钩子 | `Tool call denied by the <hook> hook[: <reason>].` |

因此，命中策略绝不会在文案上显得像人工取消。参见 [ApproveFn](/interfaces#approvefn)。每次决策都会以 `approval_decision` 事件写入 Trace，策略否决记录为 `forbidden`，因此 Trace 就是一份完整的审计记录。审批发生在 [Agent 运行循环](/agent-loop)的工具执行阶段。

**子 Agent 审批。** 父任务结束时，绝不会自动拒绝子 Agent 的审批。服务器会为它运行的每个 Session（包括 CLI 驱动的 Session）挂上一个与 Session 同生命周期的兜底审批出口。子 Agent 的审批请求只要既没有活跃的轮询窗口，也没有后台启动时挂上的出口，就会直接上报给用户，父 Session 空闲时也一样。父任务结束或停止时，只处理**主** Session 的待审批请求；带 `origin` 标记的子 Agent 审批会一直待定，卡片也一直留在屏幕上，直到用户作出决定。从不调用 `Session.setSubagentApprovalFallback` 的 SDK 嵌入方仍然只在轮询窗口内审批：子 Agent 的请求会一直等到 `run_subagent` 或 `input_subagent` 调用处于活跃状态。

## 自定义工具集

`system_config.yaml` 中的 `tools.builtin` 数组声明工具集，每一项都采用相同的 `ToolDefinitionConfig` 结构。它**整体替换默认工具集，而不是与默认值合并**。省略这一节，即保留完整的默认工具集；一旦写了这一节，默认列表就不复存在，保留的每个工具都必须给出完整定义，包括 `parameters` 的 JSON Schema，因为工具的 schema 完全来自配置。

`tools.mcpServers` 存放 MCP Server 的配置，下一节详细介绍。另见[配置参考](/configuration)。

```yaml
tools:
  # Writing builtin replaces the default toolset wholesale (this example deliberately
  # keeps a minimal single-tool set).
  builtin:
    - name: exec_command
      description: Run a shell command in the workspace.
      permission: rw
      # Optional per-tool toggle: false filters the `description` call argument
      # (declared in parameters.properties) out of the schema (missing = kept).
      call_description: false
      timeoutMs: 120000
      maxOutputLength: 16000
      # parameters: the complete JSON Schema is required (see the default definition
      # in packages/core/src/state/default-config.ts); elided here.
  mcpServers: []
```

## MCP Server

`tools.mcpServers` 的每一项都是 `{ name, config }`。`name` 会成为工具名的前缀：必须以字母或数字开头，且只能包含字母、数字、`_` 和 `-`；名称重复的条目直接跳过。`config` 描述传输方式，支持三种：

- `stdio`：本地进程（`command` / `args` / `env` / `cwd`）。进程环境变量由 SDK 的安全继承默认值和条目的 `env` 合并而成，`env` 优先。与命令子进程不同，MCP Server 进程**不会**拿到 Agent 的 Vault：Server 需要的任何变量都要列在条目的 `env` 里。`cwd` 默认为当前 Session 的 Workspace。
- `http`：Streamable HTTP，当前规范的远程传输方式（`url` / `headers`）。
- `sse`：旧式 HTTP+SSE 传输方式，为尚未迁移的 Server 保留（`url` / `headers`）。

`transport` 字段可以省略：有 `command` 的条目推断为 `stdio`，有 `url` 的条目推断为 `http`。`sse` 必须始终显式声明。

三种传输方式共享以下可选字段：

| 字段 | 含义 |
| --- | --- |
| `connectTimeoutMs` | 连接与工具发现的时间预算，默认 10000 |
| `timeoutMs` | 这个 Server 每个工具的执行超时；未设置时使用 Environment 默认值 |
| `maxOutputLength` | 这个 Server 每个工具的输出上限；未设置时使用 Environment 默认值 |
| `permission` | `auto` / `r` / `rw`，默认 `auto`；见[权限映射](#权限映射) |

这里的 `connectTimeoutMs`、`timeoutMs` 和 `maxOutputLength` 必须是正数，取值小于等于 0 的条目无效。`headers` 会附加到发往这个 Server 的每一个 HTTP 请求上，SSE 流也不例外，因此可以携带 `Authorization` 这类认证头。

```yaml
tools:
  mcpServers:
    - name: filesystem
      config:
        command: npx
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    - name: linear
      config:
        transport: http
        url: https://mcp.linear.app/mcp
        headers: { Authorization: "Bearer ..." }
        permission: r        # auto (default) | r | rw
```

### 连接与工具发现

- 连接是**惰性**的。创建 Session 立即返回；第一次 `run()` 会并行连接所有 Server，并一次性完成工具发现。
- 这段等待以一对 `mcp_connect_begin` / `mcp_connect_end` 事件流式发出：前端据此显示「连接中」状态，结束事件携带总体状态和每个 Server 的结果。完整的工具定义随后以 `tool_list_ready` 事件发出（见 [OmniMessage](/omni-message)）。在 Trace 中，这三个事件都落在这次运行的输入之后，属于新的一轮。
- 连接期间中断会**取消**这次尝试，下一次 `run()` 会重新连接。
- 发现的工具是模型上下文的一份快照：`tools/list_changed` 通知一律忽略。压缩开启下一个上下文时，配置条目未变的 Server 保留现有连接和工具；已移除或已变更的 Server 会断开连接，新增、变更或此前连接失败的 Server 会重新连接。连接事件对只在有 Server 需要连接时才出现，而 `tool_list_ready` 总是会发出（见[上下文压缩](/agent-loop)）。
- Server 连不上或条目无效时，只会在 stderr 上输出一条警告并跳过。**Session 绝不会因此阻塞。**
- 发现的工具以 `mcp__<server>__<tool>` 的形式加入扁平的工具命名空间。全名不符合 LLM 工具名规范（字母、数字、`_` 和 `-`，最多 128 个字符），或者 Server 重复列出的工具，会跳过并给出警告。其余工具与内置工具一样，走相同的[执行契约](#执行契约)（超时、截断、中断）和[审批](#审批)流程。

### 权限映射

- 默认的 `permission: auto` 下，Server 标注为 `readOnlyHint: true` 的工具视为 `r`，`read-only` 审批模式会自动批准这类工具；其余一律视为 `rw`：标注只是不可信的提示，所以默认从严。
- 把条目的 `permission` 设为 `r` 或 `rw`，会覆盖这个 Server **所有**工具的标注。许多 Server 从不设置 `readOnlyHint`，全部工具因此落在 `rw` 上，设置这个字段正是处理这类 Server 的办法。
- `permission` 固定这个 Server 每个工具上报的等级，而读取这个等级的审批模式有且只有一个。`read-only` 模式下，`r` 工具自动批准，`rw` 工具需要人工确认。`allow-all`、`deny-all` 和 `always-ask` 从不参考这个等级，所以在这三种模式下，把条目标成 `rw` 不会增加任何提示。
- 除此之外，这个键不起任何作用。它不会给 Server 加沙箱，也不限制其工具运行时的实际行为；它既不发送给 Server，也不与 Server 做比对，Server 保留传输层赋予它的全部能力。把实际能写入的 Server 标成 `r`，等于让 `read-only` 模式失去本应弹出的确认。

### 结果与关闭

- 文本块合并进输出文本，图片块以图片形式附带（data URL）。
- 音频和二进制资源变成占位行；文本资源贡献自身的文本；`resource_link` 变成 `[resource: <uri>]` 加上其描述；未知块类型变成 `[unsupported content type: <type>]`。
- 合并后的文本为空时，`structuredContent` 序列化为 JSON。
- Server 报告 `isError` 时，调用以 `stop_reason: "fatal"` 结束，内容为 Server 的错误文本；若 Server 未发送错误文本，则为 `[tool reported an error with no message]`。
- Session 结束时（`Environment.dispose`）会关闭所有 MCP 客户端，stdio 子进程也随之退出。
