---
title: 工具与审批
description: 极简内置工具集的设计与执行契约、Environment 统一收尾规则，以及逐调用审批与 Trace 审计。
---

## 设计取向

PenguinHarness 刻意维持一个极小的内置工具集：文件的精确读取与编辑交给专门的文件工具（`read_file` / `edit_file` / `write_file`）——带行号的输出与精确字符串替换比拼 `sed` 命令更可靠；Shell（`exec_command`）仍是通用兜底接口，负责运行程序、搜索、装依赖等其余一切。保留下来的每个工具都对得起它占用的 schema Token。

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
  note?: string; // 追加在输出预算之外的终止标记(如退出码)
  images?: string[]; // data URL 图像,附加在文本输出之后
}
```

工具本身只需 yield 增量的 `partial_tool_call_output`，收尾由 Environment 集中处理：

- 流式分帧(start / stop)与 `tool_call_id` 贯穿；
- 超时归并；输出超过 `maxOutputLength`(默认 16000 字符)时按头尾双窗截断：预算对半开，头窗照常流式转发，尾窗在收尾时随 `[output truncated: kept first H and last T of C chars]` 标记补出——总量 C 供模型判断是否值得读 recovery 文件；超出头窗但未超预算的输出则在收尾时原样补出、不加标记；
- stop_reason 按优先级归并：用户中断 > 超时 > 工具抛错 > 工具自报；
- 输出永不为空：没有任何输出时补 `[no output]`;
- `note`(如退出码)与图像附加在输出预算之外，长输出被截断时终止标记不会丢失。

工具与 Environment 从不向引擎抛异常：错误一律折叠为 `tool_call_output` 消息，交给模型阅读并调整下一步。消息结构见 [OmniMessage 协议](/omni-message)。

### 过长输出恢复

Agent Session 中的工具文本超过 `maxOutputLength` 时，模型与 Web/CLI 仍收到相同的头尾窗口、带计数的截断标记与终止标记，「用户所见 = 模型所见」的流式契约也保持不变。Environment 还会在该可见输出上限之外追加一条简短的归档状态/路径 note，并保存归该 Session 所有的 recovery 文件：单次归档预算内保存完整文本，超出预算则保存有界头尾。这里的「完整」特指 **Environment 实际收到的文本**：命令或子 Agent Session 等生产者可能已在自身的有界未读缓冲区中用 `[..., N chars of earlier output dropped ...]` 标记替换溢出内容，下游归档无法恢复在此之前已经丢失的原文。

普通多行归档可用现有 `read_file`（`offset` / `limit`）查看；若要读取字节级尾部或超长单行，Agent 必须自行构造定向的 `rg` / `tail` 等 Shell 命令，不新增专用读取工具。note 中的路径是普通绝对路径，恒为括号内最后一个元素。Windows 上统一写成正斜杠：`exec_command` 经 (Git) Bash 执行、Node 的 fs API 也接受正斜杠，同一拼写在 JSON 工具参数与 Shell 命令中通用；POSIX 路径原样透传，且 Session 路径都是普通绝对路径（不会带 `\\?\` 前缀），分隔符替换无损。含空格的路径在 Shell 命令中照常引用即可。同一拼写规则覆盖 core 产出给模型的全部路径——系统提示词的 App Data Dir / CWD 行、`[attached image/file: …]` 行与 Goal file 行（SDK 中的 `modelVisiblePath`）。

Recovery 文件位于该 Session 的 `scratchpad/<session-id>/truncated-tool-output/`，仅在确实发生截断时创建；平台支持时使用仅当前用户可读写的私有权限。单次调用最多保存 8 MiB（生产字节上限少 1 byte，以保持低于 `read_file` 的 8 MiB 扫描上限）；更大的输出在文件中保留有界头尾并写明中间被截。该限制仅针对单次调用：一个 Session 没有归档总字节数或文件数配额，并发捕获也各自最多保留一份单调用预算。文件跨 Task、运行时释放和 Session 恢复保持可读，直到用户明确删除 Session 时由现有路径连同整个 scratchpad 一起移除；不新增单独的归档清理生命周期。

Recovery 文件保存 Environment 收到的未经脱敏的工具文本。误读凭据或其他敏感数据会使本地静态留存量从可见窗口扩大到归档预算。Trace 不重复保存这些正文，但会记录模型与 Web/CLI 看到的同一个绝对 Session 路径，因此会暴露宿主的数据根目录布局。归档写入失败不改变原工具的 `stop_reason`；双方可见的 note 与 stderr 警告只携带简短错误码（stderr 另含工具名），不携带路径或原始错误消息。

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
| `call_description` | 条目级开关：控制 `parameters` 中声明的 `description` 调用参数（开启时为必填）；缺省保留，`false` 时装配阶段将其连同 `required` 项从 schema 滤除 |

## 内置工具

共 9 个内置工具(装配入口 `packages/core/src/environment/tools/registry.ts`):

| 工具 | 权限 | 超时(ms) | 用途 |
| --- | --- | --- | --- |
| `exec_command` | rw | 120000 | 在 Workspace 内以 `bash -lc` 运行命令，流式返回 stdout/stderr |
| `input_command` | rw | 130000 | 按 `process_id` 驱动命令会话：写 stdin、发 Ctrl-C、轮询输出，或终止（`kill: true`） |
| `read_file` | r | 30000 | 按 `cat -n` 风格带行号读取文本文件，以 offset/limit 分页 |
| `edit_file` | rw | 30000 | 对既有文件做精确字符串替换，回显校验片段 |
| `write_file` | rw | 30000 | 新建或整体覆写文件，按需创建父目录 |
| `run_subagent` | rw | 600000 | 把自包含子任务委派给同 Workspace 的子 Agent |
| `input_subagent` | rw | 600000 | 轮询后台 Subagent、运行中插话、停止其当前轮，或在其空闲时追加后续 Prompt |
| `read_image` | r | 60000 | 读取图片并作为图像内容返回(vision 模型) |
| `describe_image` | r | 90000 | 由 `vision_model` 代读图片并返回文字回答(text-only 模型) |

注意：既有 Agent 已落盘的 `tools.builtin` 列表按原样冻结（设置页只能编辑行、不能增行）：较早创建的 Agent 不会自动获得后来新增的工具（如文件工具）与新增参数（`run_in_background`、`kill`、`abort`），已移除工具（`kill_command`、`kill_subagent`）的存量条目则不再装配——模型按旧名调用得到标准的未知工具报错；采纳新条目需手工编辑该 Agent 的 `system_config.yaml`（可从 `packages/core/src/state/default-config.ts` 的默认定义复制），或走「更新内核」。

### 调用描述

命令 / Subagent 类工具（`exec_command`、`input_command`、`run_subagent`、`input_subagent`）带 `description` 参数：由模型写一句"本次调用在做什么"，CLI 与 Web 在调用运行期间展示给用户。该参数作为普通的 `description` 属性直接写在各条目的 `parameters` 中（工具 schema 完全存于可编辑配置），并且是**必填**的——提供该参数的工具每次调用都会带上它，前端据 schema 即可确定这次调用的展示形态，无需在参数流式过程中猜测；同时要求模型最先输出它。整个参数由条目级 `call_description` 字段控制——缺省保留，写 `call_description: false` 时装配阶段将该属性连同其 `required` 项一起从 schema 中滤除（仅内存内，不改写 YAML）。文件工具不带此参数——其 `file_path` 参数本身已说明用途。

### 命令会话

`exec_command` 先在前台等待；命令超过 `yield_time_ms` 仍未结束时转入后台，返回已有输出和一个 `process_id`，之后用 `input_command` 驱动。传 `run_in_background: true` 则完全跳过前台窗口：调用立即返回 `process_id`，进程退出时其结果以自动 user message 送达（见[后台完成回报](#后台完成回报)）。两种方式启动的会话都可用 `input_command` 的 `kill: true` 终止——进程是真实的 OS 对象、确会销毁，终止因此是访问工具的一个参数而非独立工具：

```text
exec_command(cmd)
  ├─ 前台窗口(yield_time_ms,默认 60000)内结束 ──► 完整输出 + 退出码
  ├─ 未结束 ──► 转入后台,返回已有输出 + process_id
  │                  │
  │  input_command(process_id[, chars]) ──► 写 stdin / 发 Ctrl-C / 轮询
  │                  └─ 循环驱动,直至命令退出
  └─ run_in_background: true ──► 立即返回 process_id
                     └─ 退出时:完成回报以 user message 送达
     input_command(process_id, kill: true) ──► 对进程组 SIGTERM（宽限后 SIGKILL）
```

各工具的参数（明确键名）：

```ts
// exec_command
{
  cmd: string;             // 必填:要执行的 shell 命令
  workdir?: string;        // 工作目录;缺省为 Workspace 根,相对路径按其解析
  yield_time_ms?: number;  // 前台等待时长;默认 60000,最小 250,上限受工具超时约束
  run_in_background?: boolean; // true = 立即返回 process_id;完成回报以 user message 送达
  description: string;     // 开关开启时必填:一句话说明,最先输出,调用运行期间展示给用户
}

// input_command
{
  process_id: string;      // 必填:exec_command 返回的命令会话 id
  chars?: string;          // 写入 stdin 的字符;单独发送 "\u0003" 传递 Ctrl-C;缺省仅轮询
  yield_time_ms?: number;  // 等待时长;有写入默认 250,空轮询默认 120000(一次轮询等完多数构建;想快速查看可传更小值)
  description: string;     // 开关开启时必填
}

```

POSIX 上 Ctrl-C 向会话进程组发送 `SIGINT`，中断前台命令。Windows 无法向管道子进程投递控制台信号，Ctrl-C 因此退化为整棵命令会话进程树的强杀（`taskkill /t /f`）——前台命令及其启动的所有子进程一并终止，而不是仅中断前台命令。

### 文件工具

`read_file` / `edit_file` / `write_file` 与 Shell 工具一样以用户完整权限运行：相对路径按 Workspace 解析，也接受绝对路径。软链接路径会被解析到它指向的文件——读取、编辑、写入都落在该文件上，链接本身仍然是链接。三者均为非流式（一次性输出最终结果），从不抛异常——失败以解释性文本收尾，`stop_reason` 为 `failed`。

```ts
// read_file — cat -n 风格输出(行号、制表符、内容);超长单行会被截断,
// 含 NUL 字节的二进制内容被拒绝并提示改用 Shell / 图像工具。
{
  file_path: string;       // 必填:绝对路径,或相对 Workspace 的路径
  offset?: number;         // 起始行号(1 起);默认 1
  limit?: number;          // 最多返回的行数;默认 2000——未读完时尾部注记提示续读
}

// edit_file — 文件必须已存在;old_string 必须恰好出现一次(或设 replace_all);
// 成功时回显 "Replaced N occurrence(s)" 及改动区域的 git 风格 unified diff
// (每个替换点一个 hunk,相邻替换点合并;replace_all 大量命中时截断为少量 hunk
// 并附 "…and N more replacements" 注记)。
{
  file_path: string;       // 必填
  old_string: string;      // 必填:要替换的原文,须与文件内容(含空白/缩进)完全一致
  new_string: string;      // 必填:替换文本,须与 old_string 不同
  replace_all?: boolean;   // 替换全部出现处;默认 false
}

// write_file — 按需创建父目录;报告 "Created" 或 "Overwrote" 及行数/字节数。
// 覆写时还会附上与旧内容的小型 unified diff;改动过大时改为一行 +X/−Y 摘要。
{
  file_path: string;       // 必填
  content: string;         // 必填:完整文件内容;空字符串创建空文件
}
```

### Subagent

`run_subagent` 把一段能一次说清的子任务交给子 Agent 执行，同样是两段式：前台窗口(默认 300000ms)过后转入后台并返回 `subagent_id`，由 `input_subagent` 驱动；子 Agent 的待审批项会在轮询等待期间浮出。`input_subagent` 覆盖四种手势：`prompt` 为空仅轮询；子会话**运行中**发 `prompt` 即中途插话（与用户对主会话的运行中 steering 同一机制——在子会话下一步以 `[user_steering]` 消息送达，写入子 Trace、sender 记为 `parent_agent`）；空闲时发 `prompt` 即在同一会话上续跑一轮；`abort: true` 只停止子会话**当前这一轮**——会话保留、可继续插话或续跑，与 `prompt` 同给即打断并改道。`input_subagent` 每次访问的模型面输出是子会话**最近一条完整回复**——「它最后说了什么」的幂等快照，而非增量排空。传 `run_in_background: true` 则启动即返回 `subagent_id`，模型发起的每轮完成都以自动 user message 送达（面板发起的轮与被显式 abort 的轮不回报；见[后台完成回报](#后台完成回报)）。**Subagent 没有 kill**：与主 Agent 一样，子会话永不销毁——释放空闲会话只是腾出并发额度，已释放的 `subagent_id` 在再次收到消息时**自动复活**（模型访问与面板走同一条 resume 路径）。

Web App 的智能体面板用**与主对话相同的 composer**（子会话变体）驱动选中的子会话：正文、技能与 slash 技能命令、per-turn 思考等级（作用于这条消息开启的一轮）、上下文圆环（子会话自身用量）、锁定模型徽标，以及审批模式选择——它读写的是父会话的模式，子会话审批本就按其判定。发消息就是对子会话的一次用户输入，无论其状态如何：运行中即插话，空闲即续跑一轮，会话已被释放则**复活**——服务端按 resume 口径恢复该子 Session（沿用其历史、模型与 Workspace）并重新纳管，对话直接继续。操作按钮的停止面只中止子会话当前这一轮。这一切与 `input_subagent` 收敛到 core 的同一通道；面板的运行标识以服务端实况为准，不再从对话文本推断。

```ts
// run_subagent
{
  prompt: string;          // 必填:完整的子任务(含全部上下文与期望的最终产出)
  agent_id?: string;       // 子 Agent;缺省复用当前 Agent
  model_id?: string;       // 子 Session 模型,须与 provider 成对给出;两者都缺省时继承父 Session 的模型
  provider?: string;       // model_id 所属的 provider 组;给出 model_id 时必填
  thinking_level?: string; // "low" | "medium" | "high" | "xhigh" | "max";缺省继承父 Session 的思考等级
  yield_time_ms?: number;  // 前台等待时长;默认 300000
  run_in_background?: boolean; // true = 立即返回 subagent_id;完成回报以 user message 送达
  description: string;     // 开关开启时必填
}

// input_subagent
{
  subagent_id: string;     // 必填:run_subagent 返回的后台 Subagent id
  prompt?: string;         // 运行中即插话(steering);空闲时即续跑一轮;缺省仅轮询
  abort?: boolean;         // 停止子会话当前这一轮(会话保留,被中止的轮不发完成回报);与 prompt 同给即打断并改道
  yield_time_ms?: number;  // 等待时长;有追加默认 300000,空轮询默认 10000
  description: string;     // 开关开启时必填
}

```

- 深度上限为 1:Subagent 不能再派生 Subagent。
- 子 Session 跟随父 Session:模型(除非以 `model_id`/`provider` 显式指定)、thinking level(除非以 `thinking_level` 显式指定——机械性子任务可调低，深度分析可调高)与 Workspace 均继承父级，而非 Project 默认值。
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

### 后台完成回报

以 `run_in_background: true` 启动的任务在结束时，以**Harness 注入的 user message** 回报完成——模型无需轮询。消息以 `[background_task_done]` 标记块开头（kind、id、status、一行 detail），其后是任务内容与尚未送达输出的尾部（上限 4000 字符；Web App 将标记块折叠为一行提示）。其 `text` payload 带 `sender: "harness"`，在 Trace 中与真人输入相区分（见 [OmniMessage](/omni-message)）。

送达时机：Task 进行中时，回报搭乘下一个 turn 边界——即使最终回复已在流式输出，Task 也会为回应它再延续一个 turn。Session 空闲时，托管 Server 自动以该回报发起新 Task（SDK 嵌入方可订阅 `Session.onBackgroundNotice` / `takeBackgroundNotices`，否则回报并入下一次 run 的输入）。经 `input_command` 的 `kill` 终止的命令不发回报——该调用自身的结果已说明结局；被显式 `abort` 结束的子会话轮同样不发（打断者当场读到结局）。回报只覆盖**模型自己发起的轮**——`run_in_background` 的启动轮与 `input_subagent` 的续跑轮；用户从智能体面板发起的轮是用户与子会话自己的对话，不发回报（该轮答案文本留在模型面缓冲，下次轮询照常取得）。

后台 Subagent 的生命周期与发起它的调用解耦：中止范围只属于它自己（逐轮 `abort` 只结束一轮；会话只随父 Session 终结，容量释放的也可复活），其消息经发起 Session 实时流向前端（与前台窗口转发同一条 origin 通道），工具审批经发起调用自身的审批回调作为常驻 sink 解决——`allow-all` 下即发即忘可全程无人值守，失败也以 `status: failed` 的回报收尾，而不是子会话永久卡住。

### 后台会话上限

| 会话类型 | 上限 | 淘汰策略 |
| --- | --- | --- |
| 命令会话 | 64 | 满时优先淘汰已退出者，否则对空闲会话按 LRU 淘汰 |
| Subagent 会话 | 8 | 只淘汰已完成者；运行中的从不淘汰，无空位则拒绝派生 |

## 审批

每个完整的 `tool_call` 触发且只触发一次审批决策：

```ts
type ApprovalDecision = "allow" | "deny" | "forbidden"; // "forbidden" = 命令策略的拦截
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
```

| 使用面 | 行为 |
| --- | --- |
| SDK | 每次 `session.run` 传入 `approve` 回调；未注入时引擎默认全部拒绝(保守策略，避免无人值守下误放行) |
| CLI | `--approve` 四种模式：allow-all(默认)/ deny-all / read-only / always-ask;read-only 自动放行 `permission: "r"` 的工具，其余转人工 |
| Web / Server | 同样四种模式，按 Session 设置；每次决策前从数据库重读，改模式立即生效；人工决策经 API 送达 |

deny 会合成一条 `aborted` 的 `tool_call_output` 供模型据此调整策略——`Tool call denied by user.`，被[命令策略](/configuration#沙箱安全策略)拒绝时为 `Tool call denied by policy.`，策略命中因此不会被读成「有人取消了」。见 [ApproveFn](/interfaces#approvefn)。每次决策都以 `approval_decision` 事件写入 Trace（策略拦截即记 `forbidden`），构成完整的审计记录。审批发生在 [Agent 运行循环](/agent-loop) 的工具执行阶段。

子会话的审批不会因父任务结束而被自动拒绝。Web 服务端为每个会话运行时挂一个**会话生命周期的兜底审批出口**：没有活跃轮询窗口、也没有后台启动常驻出口的子会话审批请求直接上报用户（父会话空闲时亦然）；父任务结束或被停止时只收敛**主会话**自身的未决审批——带 origin 的子会话审批保持待决、审批卡持续显示，直到用户决定。未挂兜底出口的宿主（CLI）保持旧口径：子会话请求排队，等 `run_subagent` / `input_subagent` 调用活跃时透传。

## 自定义与 MCP

`system_config.yaml` 的 `tools.builtin` 数组以 `ToolDefinitionConfig` 同构条目声明工具集。注意语义是**整体替换而非合并**：整段省略时使用完整默认工具集；一旦写出，默认列表即被替换，要保留的每个工具都必须携带完整定义（含 `parameters` JSON Schema——工具的参数 schema 完全来自配置）。`tools.mcpServers` 承载 MCP Server 配置，见下节。另见 [配置参考](/configuration)。

```yaml
tools:
  # 写出 builtin 即整体替换默认工具集(此例刻意只保留一个最小工具集)。
  builtin:
    - name: exec_command
      description: Run a shell command in the workspace.
      permission: rw
      # 可选的条目级开关:false 时从 schema 滤除 parameters.properties 里声明的
      # description 调用参数(缺省保留)。
      call_description: false
      timeoutMs: 120000
      maxOutputLength: 16000
      # parameters: 必须携带完整 JSON Schema(默认定义见
      # packages/core/src/state/default-config.ts),此处从略。
  mcpServers: []
```

### MCP Server

`tools.mcpServers` 的每个条目是 `{ name, config }`：`name` 限字母/数字/`_`/`-`（作为工具名前缀），`config` 描述 transport，支持三种：

- `stdio`——本地进程（`command` / `args` / `env` / `cwd`）。进程环境为 SDK 安全继承环境叠加条目 `env`（后者覆盖前者）；Agent vault **不**注入 MCP Server 进程（与命令子进程不同）——Server 需要的变量须在条目 `env` 中显式列出。`cwd` 缺省为本次 Session 的 Workspace。
- `http`——Streamable HTTP，当前规范的远程 transport（`url` / `headers`）。
- `sse`——旧版 HTTP+SSE，仅为未迁移的服务保留（`url` / `headers`）。

`transport` 字段可省略：有 `command` 推断为 `stdio`、有 `url` 推断为 `http`；`sse` 必须显式。三种 transport 共享可选的 `connectTimeoutMs`（连接 + 工具发现预算，默认 10000）、`timeoutMs` / `maxOutputLength`（作用于该 Server 全部工具的执行约束，缺省用 Environment 默认值）与 `permission`（`auto` / `r` / `rw`，缺省 `auto`，见下方权限条目）。`headers` 附加到该 Server 的每个 HTTP 请求（含 SSE 流），可承载 `Authorization` 等认证头。

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
        permission: r        # auto（缺省）| r | rw
```

行为口径：

- 连接是**懒加载**的：Session 创建即时返回，首个 `run()` 开始时才并行连接全部 Server 并做一次工具发现——连接期间流式发出一对 `mcp_connect_begin` / `mcp_connect_end` 事件（前端显示连接状态；end 带总体 status 与逐 Server 结果），完成后以 `tool_list_ready` 事件下发完整工具定义（见 [OmniMessage](/omni-message)）；这三条消息在 Trace 中写在本轮输入之后，归属新轮次。运行中打断即**取消**本次连接，下次 `run()` 重新连接。发现结果是 Session 生命周期内的快照，`tools/list_changed` 通知被忽略。连接失败或条目非法只产生 stderr 警告并跳过该 Server，**不阻塞会话**。
- 发现的工具以 `mcp__<server>__<tool>` 进入统一工具命名空间，与内置工具走同一条[执行契约](#执行契约)（超时、截断、打断）与[审批](#审批)流程。
- 权限映射：缺省的 `permission: auto` 下，Server 注解 `readOnlyHint: true` 的工具为 `r`（read-only 审批模式自动放行），其余一律 `rw`——注解是未受信 hint，缺省取限制方向。把条目的 `permission` 设为 `r` 或 `rw`，则该 Server 的**全部**工具一律按此取值，覆盖注解——大量 Server 从不设置 `readOnlyHint`、因而整体落到 `rw`，这个字段就是为它们准备的。
- `permission` 的边界：它固定该 Server 每个工具对外报出的等级，而读这个等级的审批模式只有一个。`read-only` 下 `r` 工具自动放行、`rw` 工具需人工确认；`allow-all` / `deny-all` / `always-ask` 根本不查询它，标成 `rw` 的条目在这些模式下也不会多出一次审批。除此之外该字段什么都不做：不为 Server 提供沙箱，不限制其工具运行时的行为，不会发给 Server、也不向 Server 核验，Server 依旧拥有其 transport 赋予的全部能力。把一个实际能写的 Server 标为 `r`，撤掉的就是 `read-only` 本会索要的那次确认。
- 结果映射：text 块拼接为输出文本；image 块作为图片（data URL）随输出附带；audio 与二进制 resource 折叠为占位行；仅有 `structuredContent` 时将其序列化为 JSON；Server 报 `isError` 时落实为 `stop_reason: "failed"`，内容即 Server 给出的错误说明。
- Session 结束（`Environment.dispose`）关闭全部 MCP 客户端，stdio 子进程一并退出。
