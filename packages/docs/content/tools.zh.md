---
title: 工具与审批
description: 极简内置工具集的设计与执行契约、Environment 统一收尾规则，以及逐调用审批与 Trace 审计。
---

## 设计取向

PenguinHarness 刻意维持一个极小的内置工具集：文件的精确读取与编辑交给专门的文件工具（`read_file` / `edit_file` / `write_file`）——带行号的输出与精确字符串替换比拼 `sed` 命令更可靠；Shell（`run_command`）仍是通用兜底接口，负责运行程序、搜索、装依赖等其余一切。保留下来的每个工具都对得起它占用的 schema Token。

## 执行契约

所有内置工具实现同一个 `BuiltinTool` 接口(`packages/core/src/environment/tools/types.ts`):

```ts
interface BuiltinTool {
  name: string;
  definition: ToolDefinitionConfig;
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): AsyncGenerator<OmniMessage, ToolResult | void>;
}

interface ToolExecutionContext {
  workspaceDir: string;
  toolCallId: string;
  signal?: AbortSignal;
  approve?: ApproveFn; // 供需要派生子 Session 的工具转发(审批继承)
}

interface ToolResult {
  stopReason?: StopReason; // 工具自报终态(优先级最低,见下)
  note?: string; // 追加在截断范围之外的终止标记(如退出码)
  images?: string[]; // data URL 图像,附加在文本输出之后
}
```

工具本身只需 yield 增量的 `partial_tool_call_output`，收尾由 Environment 集中处理：

- 流式分帧(start / stop)与 `tool_call_id` 贯穿；
- 超时归并；输出超过 `maxOutputLength`(默认 16000 字符)时截断，保留开头；
- stop_reason 按优先级归并：用户中断 > 超时 > 工具抛错 > 工具自报；
- 输出永不为空：没有任何输出时补 `[no output]`;
- `note`(如退出码)与图像附加在截断范围之外，长输出被截断时终止标记不会丢失。

工具与 Environment 从不向引擎抛异常：错误一律折叠为 `tool_call_output` 消息，交给模型阅读并调整下一步。消息结构见 [OmniMessage 协议](/omni-message)。

## 配置字段

每个工具由一条 `ToolDefinitionConfig` 描述：

| 字段 | 说明 |
| --- | --- |
| `name` | 工具名，对应模型产出的 `tool_call.name` |
| `description` | 提供给模型的工具说明 |
| `parameters` | 参数 JSON Schema |
| `permission` | `"r"` 只读 / `"rw"` 读写 |
| `forModel` | `"vision"` / `"text-only"`：按 Session 模型类别装配；缺省对所有模型可用 |
| `timeoutMs` | 单次调用超时(ms)，默认 120000;`<=0` 关闭 |
| `maxOutputLength` | 输出长度上限(字符);`<=0` 关闭 |

## 内置工具

共 9 个内置工具(装配入口 `packages/core/src/environment/tools/registry.ts`):

| 工具 | 权限 | 超时(ms) | 用途 |
| --- | --- | --- | --- |
| `run_command` | rw | 120000 | 在 Workspace 内以 `bash -lc` 运行命令，流式返回 stdout/stderr |
| `input_command` | rw | 130000 | 按 `process_id` 驱动运行中的命令：写 stdin、发 Ctrl-C、轮询输出 |
| `read_file` | r | 30000 | 按 `cat -n` 风格带行号读取文本文件，以 offset/limit 分页 |
| `edit_file` | rw | 30000 | 对既有文件做精确字符串替换，回显校验片段 |
| `write_file` | rw | 30000 | 新建或整体覆写文件，按需创建父目录 |
| `run_subagent` | rw | 600000 | 把自包含子任务委派给同 Workspace 的子 Agent |
| `input_subagent` | rw | 600000 | 轮询后台 Subagent，或在其空闲时追加后续 Prompt |
| `read_image` | r | 60000 | 读取图片并作为图像内容返回(vision 模型) |
| `describe_image` | r | 90000 | 由 `vision_model` 代读图片并返回文字回答(text-only 模型) |

`run_command` 旧名为 `exec_command`；磁盘上仍写着 `exec_command` 的 `system_config.yaml` 继续有效——注册表把两个名字映射到同一个 Shell 工具，装配出的工具以配置条目的名字为运行时名字。

### 调用描述

命令 / Subagent 类工具（`run_command`、`input_command`、`run_subagent`、`input_subagent`）接受可选的 `description` 参数：由模型写一句"本次调用在做什么"，CLI 与 Web 在调用运行期间展示给用户。该参数在装配时注入工具 schema，由 `system_config.yaml` 的 `tools.call_descriptions` 控制（缺省视为开启；写 `false` 关闭）。文件工具不带此参数——其 `file_path` 参数本身已说明用途。

### 命令会话

`run_command` 先在前台等待；命令超过 `yield_time_ms` 仍未结束时转入后台，返回已有输出和一个 `process_id`，之后用 `input_command` 驱动：

```text
run_command(cmd)
  ├─ 前台窗口(yield_time_ms,默认 60000)内结束 ──► 完整输出 + 退出码
  └─ 未结束 ──► 转入后台,返回已有输出 + process_id
                     │
    input_command(process_id[, chars]) ──► 写 stdin / 发 Ctrl-C / 轮询
                     └─ 循环驱动,直至命令退出
```

两个工具的参数（明确键名）：

```ts
// run_command
{
  cmd: string;             // 必填:要执行的 shell 命令
  workdir?: string;        // 工作目录;缺省为 Workspace 根,相对路径按其解析
  yield_time_ms?: number;  // 前台等待时长;默认 60000,最小 250,上限受工具超时约束
  description?: string;    // 可选(随 tools.call_descriptions):一句话说明,调用运行期间展示给用户
}

// input_command
{
  process_id: string;      // 必填:run_command 返回的命令会话 id
  chars?: string;          // 写入 stdin 的字符;单独发送 "\u0003" 传递 Ctrl-C;缺省仅轮询
  yield_time_ms?: number;  // 等待时长;有写入默认 250,空轮询默认 5000
  description?: string;    // 可选(随 tools.call_descriptions)
}
```

### 文件工具

`read_file` / `edit_file` / `write_file` 与 Shell 工具一样以用户完整权限运行：相对路径按 Workspace 解析，也接受绝对路径。三者均为非流式（一次性输出最终结果），从不抛异常——失败以解释性文本收尾，`stop_reason` 为 `failed`。

```ts
// read_file — cat -n 风格输出(行号、制表符、内容);超长单行会被截断,
// 含 NUL 字节的二进制内容被拒绝并提示改用 Shell / 图像工具。
{
  file_path: string;       // 必填:绝对路径,或相对 Workspace 的路径
  offset?: number;         // 起始行号(1 起);默认 1
  limit?: number;          // 最多返回的行数;默认 2000——未读完时尾部注记提示续读
}

// edit_file — 文件必须已存在;old_string 必须恰好出现一次(或设 replace_all);
// 成功时回显 "Replaced N occurrence(s)" 及改动处的带行号片段。
{
  file_path: string;       // 必填
  old_string: string;      // 必填:要替换的原文,须与文件内容(含空白/缩进)完全一致
  new_string: string;      // 必填:替换文本,须与 old_string 不同
  replace_all?: boolean;   // 替换全部出现处;默认 false
}

// write_file — 按需创建父目录;报告 "Created" 或 "Overwrote" 及行数/字节数。
{
  file_path: string;       // 必填
  content: string;         // 必填:完整文件内容;空字符串创建空文件
}
```

### Subagent

`run_subagent` 把一段能一次说清的子任务交给子 Agent 执行，同样是两段式：前台窗口(默认 300000ms)过后转入后台并返回 `subagent_id`，由 `input_subagent` 轮询或追加 Prompt；子 Agent 的待审批项会在轮询等待期间浮出。

```ts
// run_subagent
{
  prompt: string;          // 必填:完整的子任务(含全部上下文与期望的最终产出)
  agent_id?: string;       // 子 Agent;缺省复用当前 Agent
  model_id?: string;       // 子 Session 模型;缺省继承父 Session 的模型
  yield_time_ms?: number;  // 前台等待时长;默认 300000
  description?: string;    // 可选(随 tools.call_descriptions)
}

// input_subagent
{
  subagent_id: string;     // 必填:run_subagent 返回的后台 Subagent id
  prompt?: string;         // 追加任务,仅在子 Session 空闲时接受;缺省仅轮询
  yield_time_ms?: number;  // 等待时长;有追加默认 300000,空轮询默认 10000
  description?: string;    // 可选(随 tools.call_descriptions)
}
```

- 深度上限为 1:Subagent 不能再派生 Subagent。
- 子 Session 跟随父 Session:模型(除非以 `model_id`/`provider` 显式指定)、thinking level 与 Workspace 均继承父级，而非 Project 默认值。
- 子 Session 继承父 Agent 的审批回调，审批模式随父生效。
- 子 Session 拥有独立 Trace，父 Trace 以 `subagent` 指针事件链接；子消息带 `origin` 标记回流到父级消息流。见 [Session 与 Trace](/sessions-and-traces)。

### 图像工具

`read_image` 与 `describe_image` 互斥，按 Session 模型的 vision 标记二选一装配。两者都接受 http(s) URL 或 Workspace 路径，支持 png/jpeg/gif/webp，不超过 5MB。text-only 模型走 `describe_image`：图片连同提问转交 Project 配置的 `vision_model`，其文字回答即工具输出。见 [模型与 Provider](/models)。

```ts
// read_image(vision 模型)
{
  source: string;          // 必填:http(s) URL,或 Workspace 内的文件路径
}

// describe_image(text-only 模型)
{
  source: string;          // 必填:同上
  prompt?: string;         // 要对图片提出的问题;缺省为详细描述
}
```

### 后台会话上限

| 会话类型 | 上限 | 淘汰策略 |
| --- | --- | --- |
| 命令会话 | 64 | 满时优先淘汰已退出者，否则对空闲会话按 LRU 淘汰 |
| Subagent 会话 | 8 | 只淘汰已完成者；运行中的从不淘汰，无空位则拒绝派生 |

## 审批

每个完整的 `tool_call` 触发且只触发一次审批决策：

```ts
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<"allow" | "deny">;
```

| 使用面 | 行为 |
| --- | --- |
| SDK | 每次 `session.run` 传入 `approve` 回调；未注入时引擎默认全部拒绝(保守策略，避免无人值守下误放行) |
| CLI | `--approve` 四种模式：allow-all(默认)/ deny-all / read-only / always-ask;read-only 自动放行 `permission: "r"` 的工具，其余转人工 |
| Web / Server | 同样四种模式，按 Session 设置；每次决策前从数据库重读，改模式立即生效；人工决策经 API 送达 |

deny 会合成一条 aborted 的 `tool_call_output`(内容为 `Tool call denied by user.`)，模型据此调整策略。每次决策都以 `approval_decision` 事件写入 Trace，构成完整的审计记录。审批发生在 [Agent 运行循环](/agent-loop) 的工具执行阶段。

## 自定义与 MCP

`system_config.yaml` 的 `tools.builtin` 数组以 `ToolDefinitionConfig` 同构条目声明工具集。注意语义是**整体替换而非合并**：整段省略时使用完整默认工具集；一旦写出，默认列表即被替换，要保留的每个工具都必须携带完整定义（含 `parameters` JSON Schema——工具的参数 schema 完全来自配置）。`tools.mcpServers` 承载 MCP Server 配置(name + config)——具体 MCP 工具的枚举由后续适配层接管，当前仅保留配置位。见 [配置参考](/configuration)。

```yaml
tools:
  # 写出 builtin 即整体替换默认工具集(此例刻意只保留一个最小工具集)。
  builtin:
    - name: run_command
      description: Run a shell command in the workspace.
      permission: rw
      timeoutMs: 120000
      maxOutputLength: 16000
      # parameters: 必须携带完整 JSON Schema(默认定义见
      # packages/core/src/state/default-config.ts),此处从略。
  mcpServers: []
  # 可选:写 false 时,命令/Subagent 类工具不再携带 description 调用参数(缺省视为开启)。
  call_descriptions: true
```
