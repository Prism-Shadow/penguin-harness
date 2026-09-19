---
title: CLI 参考
description: 所有 penguin 命令和子命令的选项、默认值、输出结构与示例。
---

本页收录所有 `penguin` 命令。开头先说明 CLI 如何连接服务器，以及所有命令共享的约定；随后逐条介绍每个命令，各配一段概述、用法、选项表和示例。

CLI 以 npm 包 `@prismshadow/penguin-cli` 发布，命令名为 `penguin`。直接运行 `penguin` 会打印帮助。`-v, --version` 打印当前构建的一行标识信息，`penguin version --json` 则打印完整信息。启动时，CLI 会从工作目录加载 `.env` 文件。

CLI 是服务器的瘦客户端。所有面向会话的命令（`run`、`chat`、`ls`、`input`、`logs`、`agent`、`project`、`cost`、`schedule`、`org`）都向 PenguinHarness 服务器发送 HTTP 请求，并渲染返回结果。Task 在服务器上运行，Session 存放在服务器的索引里；CLI 创建的一切 Web App 都能看到，反过来也一样。只有 `config` 仍直接编辑 Project 的文件，`server` / `web` 则负责启动服务本身。

## 服务器连接

与本机服务器通信的 CLI 无需登录。CLI 按以下顺序确定要连接的服务器，命中第一项即停止：

1. `--server <url>`：显式指定的目标。
2. `PENGUIN_API_URL`：同样指定目标，但取自环境变量。服务器驱动的会话会把它注入每个工具子进程，同时注入的还有 `PENGUIN_API_TOKEN`、`PENGUIN_PROJECT_ID`、`PENGUIN_AGENT_ID` 和 `PENGUIN_SESSION_ID`，这样 Agent 自己调用 `penguin` 时，请求就能到达运行它的那台服务器。
3. 数据根目录下存在活跃的 `server.lock`（数据根目录取 `PENGUIN_HOME`，否则为 `~/.penguin/data`）：CLI 接入正在运行的本地服务器。
4. 自动启动：CLI 在临时端口上拉起一个独立运行的本地服务器，等它就绪后接入。服务器输出写入 `<root>/logs/server-auto-<date>.log`。如果两个 CLI 同时抢着启动，落败一方的启动进程会退出，双方都接入先成功的那台。

CLI 使用本地 API token 认证。服务器每次启动都会把一个新 token 写入 `<root>/api-token`（仅所有者可读），CLI 以 `Authorization: Bearer` 的形式发送它。`PENGUIN_API_TOKEN` 优先于这个文件。CLI 只对回环地址目标读取这个文件，因此远程 `--server` 需要显式设置 `PENGUIN_API_TOKEN`。按设计，持有这个文件就等于持有管理员权限——能直接访问数据根目录的本地文件系统，本来就拥有同样的权限。`penguin server reset-admin-password` 依据的也是同一条规则。

## 全局约定

- 模型引用：模型的标识始终是 `(provider, model_id)` 这一对。`--model-id` 接收上游模型 id，`--provider` 接收模型所属的分组。CLI 从不推断、猜测或默认指定供应商。在 `run` 和 `chat` 上，这一对参数整体可选：两个都传即可选择模型，两个都不传则使用 Project 的默认模型；只传一个是错误。
- Project 与 Agent 默认值：`--project-id` 依次回退到 `PENGUIN_PROJECT_ID`，再回退到 `default_project`；`--agent-id` 依次回退到 `PENGUIN_AGENT_ID`，再回退到 `default_agent`。在服务器驱动的会话里，这些环境变量指向会话所属的 Project 和 Agent。
- Session 引用：凡是接受 session id 的命令（`input`、`logs`、`run --session`、`chat --resume`），完整 id 或任何唯一的片段都有效。`penguin ls` 打印的 8 位十六进制尾部就是为此准备的简写。片段有歧义时报错，并列出所有候选。
- 默认使用最近的 Session：session id 可选的命令（`input [session_id]`、`logs [session_id]`、`chat --resume`）在省略 id 时，指向 Agent 最近的一个 Session，由 `--agent-id` 指定是哪个 Agent。`input` 和 `logs` 会在 stderr 上用一行暗色的 `[latest]` 标注选中的 Session，目标始终明确，stdout 上的 `--json` 输出也保持可解析。如果这个 Agent 一个 Session 都没有，命令会打印一行提示指向 `penguin run` / `penguin chat`，然后以非零码退出。
- JSON 输出：`--json` 打印原始 JSON，取代渲染后的或表格形式的输出。
- 目标服务器：`--server <url>` 指定要连接的服务器。参见[服务器连接](#服务器连接)。
- 调用方上下文默认值：在 harness Agent 内部（`PENGUIN_SESSION_ID` 已设置）时，`run` 或 `chat` 创建的 Session 会从调用方 Session 的实时取值继承每一个未指定的字段：Workspace、模型对、审批模式和思考等级。`run_subagent` 对它派生的子 Agent 采用同样的继承，两个入口遵循同一条约定。对每个字段，显式传入的选项优先于调用方的值，调用方的值又优先于普通回退值。查找失败时打印一条暗色警告，并改用普通回退值。在 Agent 之外，行为不变：`--project-id` / `--agent-id` 仍按环境变量取默认值。
- 超时：`run`、`input` 和 `logs -f` 上的 `--timeout <duration>` 限制等待时长，语义为软让出——相当于把 `exec_command` 的让出窗口模型搬到 CLI 上。到时后命令干净地脱离并退出，退出码为 0。Task 在服务器上继续运行，之后可以用 `penguin input` 或 `penguin logs` 接上。可接受的值有 `30s`、`5m`、`2h`，或一个表示秒数的纯整数；其他值一律拒绝。`--timeout 0` 在消息送达后立即返回（`--json` 下为 `{sessionId, status: "running"}`），所以这个选项也覆盖「不等」的场景。不带此选项时，命令无限等待。对新建 Task 而言，惯常做法仍是 `run --background`：提交后不再等待，打印裸 session id 供脚本使用，Task 一创建就脱离。
- 参数错误：缺少参数、缺少必填选项、选项未知或命令拼错时，CLI 用界面语言打印一行错误、命令自身的用法，并提示查看 `--help`，然后以非零码退出。
- 数据根目录：`--root <dir>` 为直接读取数据根目录的命令指定根目录，涉及 `config`、`auth`、`version`、`server status` 和 `server stop`。相对路径相对工作目录解析。优先级：`--root`，然后是 `PENGUIN_HOME` 环境变量，最后是 `~/.penguin/data`。

## penguin run

在服务器上创建一个 Session（或复用已有的），发送一条消息，流式渲染 Task 直到结束，打印统计行后退出。Task 完成时退出码为 0，中途中止时为 1。目标模式运行只有在目标结果为 `complete` 时才以 0 退出。

```bash
penguin run -m <message> [options]
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `-m, --message <message>` | 要发送的消息。必填。 | — |
| `--project-id <id>` | 要使用的 Project。 | `PENGUIN_PROJECT_ID`，否则 `default_project` |
| `--agent-id <id>` | 要使用的 Agent。 | `PENGUIN_AGENT_ID`，否则 `default_agent` |
| `--workspace <path>` | Workspace 目录。相对路径相对 CLI 的工作目录解析。目录必须存在于服务器所在的机器上；默认的本地部署中，服务器就在本机。 | 工作目录 |
| `--model-id <id>` | 要使用的模型的上游 id。需要配合 `--provider`。 | Project 的默认模型 |
| `--provider <group>` | 模型所属的供应商分组。与 `--model-id` 搭配时必填。 | — |
| `--approve <mode>` | 审批模式；见[审批模式（--approve）](#审批模式--approve)。配合 `--session` 时，以 PATCH 请求更新 Session 固定的审批模式。 | `allow-all` |
| `--thinking <level>` | 在 Task 开始前固定 Session 的思考等级（`low` / `medium` / `high` / `xhigh` / `max`）。从 Session 的下一次 LLM 请求起生效。 | Session 已固定的等级，否则用 Agent 配置 |
| `--session <sessionId>` | 复用已有的 Session（完整 id 或唯一片段），而不是新建。不能与 `--workspace` 或模型对同时使用。 | — |
| `--source <source>` | 把新建的 Session 标记为由 Benchmark 评估创建。取值仅限 `benchmark`，Web App 会把这类 Session 归入会话列表的「评估任务」文件夹。不能与 `--session` 同时使用。 | — |
| `--background` | 以 POST 提交 Task 后立即退出，打印 session id（`--json` 下为 `{"sessionId"}`）。Task 在服务器上继续运行；可用 `penguin logs -f` 跟踪。 | — |
| `--timeout <duration>` | 软让出的等待预算；见[全局约定](#全局约定)。不能与 `--background` 同时使用。 | 无限等待 |
| `--goal [budget]` | 目标模式：消息就是目标，服务器循环执行，直到目标达到终态。可选值是 Token 预算，例如 `500k`。 | — |
| `--json` | 打印最终的 `{sessionId, status, text}` 对象，取代渲染后的流。`text` 拼接主 Session 的 助手文本消息。 | — |
| `--server <url>` | 目标服务器；见[服务器连接](#服务器连接)。 | — |

`--timeout` 到时后，`run` 打印目前已渲染的内容和一行暗色的仍在运行提示（附 session id），然后退出 0，不中止 Task。`--json` 下则打印 `{sessionId, status: "running", text}`。`--timeout 0` 在 POST 完成后立即返回，`--json` 下打印 `{sessionId, status: "running"}`，不含 `text`。对目标模式运行，最终 JSON 对象里的 `status` 就是目标结果。

在审批提示处按 Ctrl-C 会拒绝这一次工具调用；其他任何时候按 Ctrl-C 都会在服务器上中止 Task。

```bash
penguin run -m "Summarize the code structure of this directory"
penguin run -m "keep going" --session 402a2e24        # reuse a session by fragment
penguin run -m "long job" --background                # returns the session id immediately
```

## penguin chat

启动交互式 REPL，每行输入都会启动一个 Task。

```bash
penguin chat [options]
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--project-id <id>` / `--agent-id <id>` | 要使用的 Project 和 Agent，同 `run`。 | 见[全局约定](#全局约定) |
| `--workspace <path>` | Workspace 目录，同 `run`。 | 工作目录 |
| `--model-id <id>` / `--provider <group>` | 模型对，同 `run`。 | Project 的默认模型 |
| `--approve <mode>` | 审批模式；见[审批模式（--approve）](#审批模式--approve)。 | `allow-all` |
| `--thinking <level>` | 固定 Session 的思考等级，同 `run`。 | Session 已固定的等级，否则用 Agent 配置 |
| `--resume [sessionId]` | 恢复一个 Session（完整 id 或唯一片段）。不带 id 时，恢复 Agent 最近的 Session。 | — |
| `--verbose` | 显示完整工具输出，而不是折叠长输出；见[工具输出折叠](#工具输出折叠)。 | 长输出折叠 |
| `--server <url>` | 目标服务器；见[服务器连接](#服务器连接)。 | — |

使用 `--resume` 时，原 Session 已固定 Workspace 和模型，`--workspace`、`--model-id` 和 `--provider` 无法覆盖它们；要换模型，在恢复后的对话里使用 `/switch-model`。`--thinking` 仍然有效：它重新固定现有 Session，从下一次 LLM 请求起生效。在上下文中途更改等级会使供应商的上下文缓存失效，所以请先压缩。退出时，如果 Session 已有历史，REPL 会打印一条可直接复制运行的 `penguin chat --resume <sessionId>` 命令。

### REPL 内命令

| 输入 | 行为 |
| --- | --- |
| Task 运行期间输入的任意文本 | 运行中插话。这一行会排队，在两轮之间以 `[user_steering]` 用户消息的形式送达模型，同时一个 `»` 确认符会回显这段文本。你输入时渲染暂停，流式输出不会覆盖这一行。如果 Task 先结束，这一行会变成下一条普通 Prompt 发送出去。 |
| `/goal[:<budget>] <objective>` | 对给出的目标运行目标模式。可选的预算是 Token 预算，例如 `/goal:500k`。Ctrl-C 会中止整个目标。见[目标模式](/goal-mode)。 |
| `/compact` | 立即压缩当前上下文。 |
| `/clear` | 原地开启一个全新的空白 Session，仍用同一个 Workspace 和模型。旧 Session 保留在服务器上，之后可用 `--resume` 恢复。 |
| `/thinking` | 显示这个 Session 的思考等级：`--thinking` 或 `/thinking` 固定的等级，否则是 Agent 配置的等级。 |
| `/thinking <level>` | 固定 Session 的思考等级（`low` / `medium` / `high` / `xhigh` / `max`）。等级不会写回 Agent 配置。 |
| `/switch-model` | 显示这个 Session 当前的模型。 |
| `/switch-model <provider> <model_id>` | 在这个 Session 内切换模型。先用当前模型总结压缩上下文（Agent 的压缩方式为 `discard` 时也不例外），然后用新模型继续对话；压缩失败或被中断则保持当前模型。还没运行过的 Session 不压缩，直接切换。目标必须已在 Project 的模型配置中（`penguin config model list`）；两个参数以空白分隔，model_id 可以包含 `/`。 |
| `/verbose` | 在折叠和完整工具输出之间切换。 |
| `/exit`、`/quit` | 退出。 |

固定的思考等级属于软限制：从下一次请求起生效，即使处在上下文中途。回复会建议先运行 `/compact`，因为更改会使供应商的上下文缓存失效。更改之后派生的子 Agent Session 继承固定的等级。

### 工具输出折叠

长工具输出——比如 `exec_command` 的结果或 `read_file` 读出的整个文件——默认折叠，以免刷满屏幕。前 4 行实时流式显示。输出结束后，REPL 打印一个省略标记（`… (+N lines, /verbose for full output)`）和最后 4 行。不超过 9 行的输出会完整显示。

折叠只影响显示：模型、Trace 和 Web App 收到的始终是完整输出。输入 `/verbose` 或以 `--verbose` 启动，即可为后续输出关闭折叠。`--resume` 展示的历史同样按此折叠。`penguin run` 从不折叠输出，因为它的输出要供管道和嵌套 CLI 使用。

### Ctrl-C

Ctrl-C 的行为取决于 REPL 当时的状态：

| 状态 | 行为 |
| --- | --- |
| 等待工具审批 | 拒绝这一次工具调用。 |
| Task 运行中 | 中止当前 Task，回到输入。 |
| 输入缓冲区非空 | 清空当前输入。 |
| 空闲且缓冲区为空 | 显示退出确认（y/N）。 |

## penguin ls

列出 Project 的 Session，默认覆盖所有 Agent，用 `--agent-id` 可只看一个。各列依次为：短 id（即 8 位十六进制尾部，其他命令可以把它当作片段使用）、Agent、标题、运行中/空闲、最近活跃时间和 Workspace 路径的末段。已归档的 Session 只有加 `-a` 才显示。

```bash
penguin ls [options]
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--project-id <id>` / `--agent-id <id>` | 范围。不带 `--agent-id` 时列出 Project 的所有 Agent。 | 见[全局约定](#全局约定) |
| `-a, --all` | 包含已归档的 Session。 | — |
| `--days <n>` | 只列出最近 n 个自然日内有活动的 Session。今天算第 1 天，所以 `--days 2` 覆盖昨天和今天，与 `cost --days` 一致。可与 `-a` 和 `--json` 组合。 | — |
| `--json` / `--server <url>` | 见[全局约定](#全局约定)。 | — |

```bash
penguin ls
penguin ls --agent-id default_agent -a
penguin ls --json
```

## penguin input

向一个 Session 发送消息；不带 `-m` 时，则轮询它最后一次的回答。session id 可省略：省略时命令使用 Agent 最近的 Session（见[全局约定](#全局约定)），所以直接运行 `penguin input` 就能回答「我的 Agent 最后说了什么」。

```bash
penguin input [session_id] [options]
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `-m, --message <text>` | 消息文本。省略它则改为轮询最后一次 助手回复。 | — |
| `--timeout <duration>` | 软让出的等待预算。带 `-m` 时，到时后命令像 `run` 一样脱离，`--timeout 0` 在送达后立即返回。不带 `-m` 时，命令在到时点拍快照（`0` 表示立即拍），并注明 Session 仍在运行。 | 无限等待 |
| `--project-id <id>` | 片段搜索的范围。完整 session id 无需此选项。 | `PENGUIN_PROJECT_ID`，否则 `default_project` |
| `--agent-id <id>` | 省略 session id 时，取这个 Agent 最近的 Session。 | `PENGUIN_AGENT_ID`，否则 `default_agent` |
| `--json` / `--server <url>` | 见[全局约定](#全局约定)和下文的 JSON 结构。 | — |

带 `-m` 时，运行中的 Session 收到的文本会作为插话处理，在两轮之间送达；空闲的 Session 则启动一个新 Task。默认情况下，命令会等待并渲染，直到这一轮完成。

不带 `-m` 时，命令是一次轮询，语义与 `input_subagent` 的空 Prompt 一致。它打印 Session 最近一次完整的 助手文本——从历史末尾取得的最后一次回答的幂等快照。思考与工具输出一概跳过，也不会排队或插话。如果 Session 正在运行，命令会先静默等待，给了 `--timeout` 就最多等这么久（`--timeout 0` 表示立即拍快照）。到时如果 Session 仍在运行，命令打印最新文本并注明仍在运行，退出 0。

`--json` 下：

- 带 `-m` 时，命令打印 `{sessionId, status, text}`，`status` 取 `completed`、`aborted` 或 `running`。`--timeout 0` 的结构没有 `text`。
- 轮询形式打印 `{sessionId, status, text}`，`status` 取 `idle` 或 `running`，还没有回复时 `text` 为 `""`。

```bash
penguin input 402a2e24 -m "also check the tests"
penguin input 402a2e24 -m "queue this" --timeout 0    # deliver and return immediately
penguin input 402a2e24                    # poll: print the last assistant reply
penguin input                             # poll the agent's most recent session
penguin input 402a2e24 --timeout 5m       # poll, waiting out a running turn up to 5 minutes
```

## penguin logs

用与 REPL 相同的渲染器渲染一个 Session 的历史。session id 可省略：省略时命令使用 Agent 最近的 Session（见[全局约定](#全局约定)），所以直接运行 `penguin logs` 就能看到刚才发生的事。

```bash
penguin logs [session_id] [options]
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--tail <n>` | 只显示最后 n 条记录。 | 全部记录 |
| `-f, --follow` | 历史播完后继续跟踪实时流。只读：Ctrl-C 脱离，不改动 Session。 | — |
| `--timeout <duration>` | 跟踪这么长时间后停止（软让出，退出 0）。只在配合 `-f` 时有意义。 | — |
| `--project-id <id>` | 片段搜索的范围。 | `PENGUIN_PROJECT_ID`，否则 `default_project` |
| `--agent-id <id>` | 省略 session id 时，取这个 Agent 最近的 Session。 | `PENGUIN_AGENT_ID`，否则 `default_agent` |
| `--json` / `--server <url>` | `--json` 打印原始消息数组；配合 `-f` 时，消息一到就以每行一条 JSON 打印。 | — |

```bash
penguin logs                    # the agent's most recent session
penguin logs 402a2e24 --tail 20
penguin logs 402a2e24 -f
```

## penguin agent

`agent ls` 列出 Project 的 Agent，包括 id、名称、会话数和描述。`agent create` 创建 Agent。

```bash
penguin agent ls [--project-id <id>] [--json] [--server <url>]
penguin agent create --agent-id <id> [options]
```

`agent create` 的选项：

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--agent-id <id>` | Agent id，同时也是它的目录名。必填。 | — |
| `--name <name>` / `--description <text>` | 显示名称和描述。 | — |
| `--plugins <names>` | 要预装的插件库插件名，逗号分隔，每个插件连同各自的 Skill 和钩子包一起安装。名称未知时直接拒绝，此时还没有创建任何东西。 | — |
| `--project-id <id>` / `--json` / `--server <url>` | 见[全局约定](#全局约定)。 | — |

```bash
penguin agent ls
penguin agent create --agent-id helper --name "Helper" --plugins software-development,goal
```

## penguin project

`penguin project ls` 列出这个账号能访问的 Project——自己的和共享的——包括 id、显示名称和角色。支持 `--json` 和 `--server`。

```bash
penguin project ls
```

## penguin cost

展示来自服务器用量聚合的 Token 用量与成本。默认打印一张摘要卡片，包含今天、最近 7 天和总计，忽略任何范围选项。`--by` 则打印分组表格。

```bash
penguin cost [options]
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--days <n>` | 设置起止日期，覆盖最近 n 天。 | — |
| `--from <date>` / `--to <date>` | 显式范围，`yyyy-mm-dd` 格式，必须成对给出。 | — |
| `--by <dimension>` | 按 `date`、`agent`、`model` 或 `session` 分组。 | 摘要卡片 |
| `--project-id <id>` / `--agent-id <id>` | 范围。`--agent-id` 用于过滤，且没有默认 Agent：不主动缩小范围时，成本覆盖整个 Project。 | Project：见[全局约定](#全局约定) |
| `--json` / `--server <url>` | 见[全局约定](#全局约定)。 | — |

成本后面的 `+` 表示部分求和：这个分组里有模型没有配置价格。`-` 表示完全没有可计价的用量。

```bash
penguin cost
penguin cost --days 7 --by model
penguin cost --from 2026-08-01 --to 2026-08-25 --by agent
```

## penguin schedule

列出并管理 Project 的定时任务。

```bash
penguin schedule ls [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
penguin schedule add <name> --prompt <text> --start-at <ISO|now> [options]
penguin schedule update <name> [options]
penguin schedule rm <name> [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
```

`penguin schedule ls` 列出所有 Agent 的定时任务，用 `--agent-id` 可只看一个。各列为：Agent、名称、是否启用、开始时间、周期（一次性任务显示 `once`）、目标（绑定的 Session 短 id，或 `new session`）、上次触发时间，以及每个非 active 状态的标记（`expired`、`done`、`missed` 或 `invalid`）。无法解析的定时任务文件也会列出，并标记 `invalid`。

`add`、`update` 和 `rm` 走 API，由 API 写入定时任务的 TOML 文件。文件始终是唯一事实来源，CLI 是经过校验的写入方——模型配置和 vault 都遵循这一模式：更新经由系统接口，校验发生在接口层，手工编辑依然可行。API 错误原样打印，Agent 立即得到校验结果，不必像手工编辑那样等下一轮对账。

`add` 和 `update` 的选项：

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--prompt <text>` | 每次触发发送的文本。`add` 必填。 | — |
| `--start-at <ISO\|now>` | 首次触发时间，ISO 8601 格式，或用字面量 `now` 表示当前时刻。`add` 必填。 | — |
| `--period <duration>` | 固定间隔，至少 `5m`（例如 `30m`、`12h`、`1d`、`7d`）。 | 一次性 |
| `--end-at <ISO>` | 这个时刻之后不再触发。 | — |
| `--session-id <id>` | 把每次触发绑定到一个 Session。只能在它和新建 Session 选项之间二选一。 | — |
| `--workspace <path>` / `--model-id <id> --provider <group>` | 新建 Session 模式：每次触发都在这个 Workspace 和模型上创建一个 Session。模型对要么都给，要么都不给。 | 临时 Workspace；Project 的默认模型 |
| `--disabled`（`add`） | 创建时即处于禁用状态。 | 启用 |
| `--enable` / `--disable`（`update`） | 开启或关闭任务。 | — |
| `--project-id <id>` / `--agent-id <id>` / `--json` / `--server <url>` | 见[全局约定](#全局约定)。 | — |

- `add` 创建的任务默认启用，因为添加任务就是想让它跑起来；不想启用就用 `--disabled`。这是与原始文件的刻意差异：原始文件的 `enabled = false` 默认值保留不变，供手工编辑使用。
- `update` 读取已存储的任务，修改后写回，未指定的字段保持原值。在绑定 Session 和新建 Session 两种目标之间切换时，会清空另一种目标的字段。
- `rm` 不询问直接删除。服务器仍要求调用者是 Project 所有者。

```bash
penguin schedule add daily-report --prompt "summarize the day" --start-at 2026-09-01T09:00:00Z --period 1d
penguin schedule add once-now --prompt "check the deploy" --start-at now --session-id 402a2e24
penguin schedule update daily-report --period 12h --disable
penguin schedule rm daily-report
```

## penguin org

公司模式的命令族，是组织 API 之上的瘦客户端。组织在 Project 目录下的文件（员工树、工位台账、日历、工单和频道）始终是唯一事实来源。每个子命令要么读取这些文件的投影，要么通过编辑这些文件的路由写入；契约与 `schedule` 一致——CLI 是经过校验的写入方，API 错误原样打印，Agent 立即得到校验结果，不必像手工编辑那样等下一轮对账。按约定，生成的 id 带前缀：组织用 `co_`，频道用 `ch_`。服务器建议这些前缀但从不强制，这里传入的 id 会严格按输入原样创建。

```bash
penguin org ls [--project-id <id>] [--json]
penguin org create --org-id <id> --mission <s> [--name <s>] [--language <zh|en>] [--workspace <path>] [--ceo-budget <usd>] [--model-id <id> --provider <p>] [--project-id <id>]   # by convention `co_<slug>`
penguin org show [--org-id <id>] [--json]                       # overview: working language, employees and states, board counts, spend against budget, pending items
penguin org chart [--org-id <id>] [--json]                      # the employee tree
penguin org hire (--agent-id <id> | --new-agent <id> [--name <s>] [--description <s>] [--skills <a,b>]) --title <s> --reports-to <agent_id> [--workspace <path>] [--budget <usd>] [--duties <s>]
penguin org employee set <agent_id> [--title <s>] [--reports-to <agent_id>] [--workspace <path>] [--budget <usd>] [--duties <s>] [--model-id <id> --provider <p>]
penguin org leave <agent_id>                                    # out of the organization (not the CEO); the Agent itself stays
penguin org desk show [<agent_id>] [--json]                     # the desk session id and Workspace (opens the desk if there is none)
penguin org desk renew [<agent_id>]                             # a fresh desk session (resets the context)
penguin org calendar ls [--agent-id <id>] [--json]
penguin org calendar add <name> [--agent-id <id>] --prompt <s> --start-at <ISO|now> [--period <dur>] [--end-at <ISO>] [--title <s>] [--disabled]
penguin org calendar update <name> [--agent-id <id>] [same fields] [--enable|--disable]
penguin org calendar rm <name> [--agent-id <id>]
penguin org ticket ls [--status <col>] [--owner <principal>] [--blocked] [--json]
penguin org ticket show <ticket_id> [--json]
penguin org ticket create --title <s> (--goal <s> [--criteria <s>] | --body-file <path>) [--owner <principal>] [--slug <words>] [--parent <ticket_id>] [--notify <p,p>] [--priority P0|P1|P2] [--due <date>]
penguin org ticket move <ticket_id> --to <col> [--reason <s>]   # moving into rejected needs a reason
penguin org ticket assign <ticket_id> --owner <principal>
penguin org ticket block <ticket_id> --reason <s> [--by <principal|ticket_id>]   # the ticket stays in its column
penguin org ticket unblock <ticket_id>
penguin org ticket progress <ticket_id> -m <text>               # a progress entry, attributed to the calling session
penguin org ticket start <ticket_id> [-m <note>] [--workspace <path>] [--agent-id <id>] [--json]   # a ticket session working on the ticket in the background; prints its id
penguin org ticket attach <ticket_id> [--session <session_id>]   # an existing session as a contributor (default: the calling session)
penguin org channel ls [--json]                                 # every channel for a person, its own for an employee
penguin org channel create <channel_id> [--name <s>] [--purpose <s>]   # a new channel holds only its creator; `ch_<slug>` by convention
penguin org channel show <channel_id> [--json]                  # purpose, member count and the member list
penguin org channel invite <channel_id> <principal>...          # any member invites; one POST per principal
penguin org channel join <channel_id>                           # people only; an employee waits to be invited
penguin org channel leave <channel_id>                          # self-removal
penguin org channel remove <channel_id> <principal>             # people only
penguin org channel archive <channel_id> | unarchive <channel_id>      # people only; read-only while archived
penguin org channel tail [--channel <id>] [--date <d>] [-n <count>] [--json]
penguin org channel send -m <text> [--channel <id>] [--ref-ticket <id>] [--ref-session <id>]
penguin org handbook list [--json]
penguin org handbook show [path] [--json]
penguin org handbook write <path> (-m <text> | --file <file>)
penguin org handbook rm <path>
penguin org finance [--period <YYYY-MM>] [--json]
```

### 通用选项

每个子命令都接受 `--org-id <id>`、`--project-id`、`--json` 和 `--server`。

`--org-id` 默认取 `PENGUIN_ORG_ID`——公司模式加入[服务器连接](#服务器连接)所述环境的唯一一个变量。服务器把它注入工位会话和工单会话的每个工具子进程，员工自己调用 `penguin org` 时无需指名，请求就能到达自己所在的组织；人在 shell 里则显式传入这个选项。没有默认组织：选项和变量都不提供时，命令在联系任何服务器之前就会失败。`create` 是例外，因为它的 `--org-id` 就是要创建的 id，从不取自环境。

`--json` 把响应打印为一行 JSON。不加时，写命令打印一行确认信息。

### 会话内的调用方身份

在会话内部，同一套环境变量标识调用方：

- `calendar` 系列命令的 `--agent-id` 和 `desk` 的 `<agent_id>` 参数默认取 `PENGUIN_AGENT_ID`，员工借此安排自己的日程、换新自己的工位会话。不带选项的 `calendar ls` 列出所有员工的事件。
- `ticket start` 启动工单会话：给了 `--agent-id` 就以它运行；否则在设置了 `PENGUIN_AGENT_ID` 时以它运行；再否则以工单负责人的身份运行，由服务器确定。命令还会发送 `PENGUIN_SESSION_ID`，服务器借此执行自己的规则：只有工单负责人或人才能启动工单会话。员工请求别人的工单，或请求没有员工负责人的工单时，会得到 `403 not_ticket_owner`，原样打印。错误信息会提示改为指派工单（`penguin org ticket assign <id> --owner agent:<employee>`），让那位员工的工位在下一轮巡检时接手。负责人也可以用 `--agent-id` 把同事拉到自己负责的工单上。
- 工单写操作（`create`、`assign`、`move`、`block`、`unblock`、`progress`）和频道写操作（`create`、`invite`、`join`、`archive`、`unarchive`、`send`）在请求体里带上 `PENGUIN_SESSION_ID`，文件里记录的因此是会话对应的员工，而不是 token 的用户。`ticket attach` 在省略 `--session` 时挂接的就是这个会话；`--session` 与其他地方一样，接受完整 id 或唯一片段。
- 频道读操作（`ls`、`show`、`tail`）以及 `leave` 和 `remove` 背后的成员 DELETE 没有请求体，改为通过 `?sessionId=` 发送同一个会话。不传的话，服务器会把员工当作登录的那个人来应答，`channel ls` 列出的会是所有频道而不是员工自己的频道。

### ls、show 和 chart

- `ls` 列出 Project 的组织，包括各自的员工数、工单数和支出。
- `show` 打印一个组织的概览：名称、使命、状态和工作语言，员工按状态分布，看板各列的工单数，本期支出与 CEO 预算的对比。还会列出等你处理的事项：提及你的消息、待你审核的工单、因你而阻塞的工单。
- `chart` 打印汇报树，按层级缩进，包含每个员工的职位、实时状态、自身支出、累计支出和预算。

校验失败的组织或员工会带着 `invalid: <reason>` 出现在列表里，而不是直接略过。

### create

`--ceo-budget` 是 CEO 的月度预算，单位为美元，默认 100。预算沿累计线比较，即员工本人加上下面的所有人，所以 CEO 的预算覆盖整个公司。新组织因此有上限而非无限制，初始化运行的触发块会写明这个数字，CEO 据此规划招聘提案的规模。`0` 是真实的零预算。要再次解除上限，向 `PATCH .../employees/<org_id>_ceo` 发送 `budget: null`，Web App 的员工编辑器正是这么做的。

`--language zh|en` 设置组织的工作语言。不给时由使命决定：使命文本里只要出现一个汉字，语言就是 `zh`。组织写出的一切都遵循这个语言：手册、员工简报、CEO 的初始化运行和工位会话标题。

### hire

`hire` 必须在 `--agent-id` 和 `--new-agent` 中恰好选一个：前者雇用已有的 Agent，后者新建一个。对新建的 Agent，用 `--name`、`--description` 和 `--skills` 描述它；`--skills` 列出额外的插件库插件，叠加在 `agent-company,agent-development` 之上，后者是每个员工都需要的。

`--workspace` 是组织共享 Workspace 的子目录（`.` 表示整个共享 Workspace），或一个绝对路径。它从不相对 CLI 的工作目录解析。默认值是按员工命名的子目录，因为共享根目录存放共享的输入，不是任何人的工位。

- 相对子目录会先做规范化，`./hr`、`hr/` 和 `hr` 是同一个分区。服务器在记录雇用信息时创建它，所以 `--workspace hr` 就够了，不需要事先存在任何东西。
- 绝对路径指向用户自己的某个目录，且必须已经存在。
- 用 `..` 跳出共享 Workspace 的路径一律拒绝，返回 400 `invalid_workspace`。

工位会话或工单会话开启时同样会创建自己的目录。`--budget` 是月度预算，单位为美元，覆盖这名员工以及下面的所有人。

### employee set

`employee set` 只修改你给出的字段。`--workspace` 的用法与 `hire` 相同，但没有默认值：只有传了这个选项才改变分区。`--budget` 是月度预算，单位为美元，覆盖这名员工以及下面的所有人。模型对要么都给，要么都不给，与其他地方一致。

### calendar

`calendar` 使用与 `penguin schedule` 相同的写入方：`add` 创建启用的事件，除非传了 `--disabled`；`--start-at now` 表示当前时刻；`update` 读取已存储的事件，修改后写回；`rm` 不询问直接删除。事件触发到员工的工位会话里，且只在组织和员工都处于活跃状态时触发；否则状态列显示 `paused`。

`add` 和 `update` 的响应包含事件本身，外加这次写入触发的排班提醒：另一位员工的周期性事件恰好定在同一个开始分钟；同一位员工有了第二个同周期的周期性事件；或周期性事件从 `now` 开始。CLI 把每条提醒单独打一行，形如 `Rota notice: …`。提醒从不阻塞写入，这些行保留服务器的英文原文。

### ticket

- `ls` 拉取整个看板后在本地过滤。`--status` 接受一列：`proposed`、`in_progress`、`review`、`done` 或 `rejected`。`--json` 下，`ls` 以 `{ tickets, invalidFiles }` 打印过滤后的列表。
- `show` 先打印派生数据（所在列、运行状态、成本和汇总成本、贡献会话、子工单），然后是工单自身字段、正文各节，以及 `History:` 下的操作历史。
- `create` 接受 `--goal`（配合 `--criteria`），或从 `--body-file` 读取完整的 Markdown 正文。两种方式都会生成 frontmatter。
- `start` 打印裸 session id，与 `run --background` 一样，供 `penguin logs` 和 `penguin input` 接手。
- `--owner <principal>` 指定唯一的负责主体：员工（Agent id 或 `agent:<id>`）或 Project 成员（`user:<id>`）。默认取调用方。未指定 `--notify` 时，负责人会成为完整的 `notify` 列表，但前提是负责人是员工：人不会就自己名下的工单收到通知，想收到通知需要用 `--notify` 把自己加进去。
- 谁提交的工单不由选项指定：它就是工单历史里的 `created` 条目，取自命令运行时所处的环境。
- 工单 id 的格式是 `<yyyy-mm-dd>-<slug>`，slug 是小写英文单词，用连字符连接。`--slug <words>` 用来设置它。标题里英文太少、服务器又无法用 Project 的模型为它起名时，就需要这个选项（400 `slug_required`）。
- 表明已做了工作的写操作，还会把调用方所在的会话记为工单的贡献会话之一，它的成本因此计入工单。这类写操作包括 `progress`、编辑正文和 `move --to review`。移入其他任何列，以及 `block` 和 `unblock`，都不记录。
- `progress -m` 接受一句平实的描述，说明做了什么、在哪里；服务器记录谁写的、什么时候写的。
- `--goal`、`--criteria` 和 `progress -m` 要求所有输入、交付物和文件都用完整路径指名。

### channel

`--channel` 默认为 `default_channel`，即全员频道，每个员工和 Project 成员都在其中。`ls` 把它列在第一位，显示本地化标签而非存储的名称。

新频道里只有创建者。成员邀请后员工才能进入；人则可以 `join` 任何频道，并能阅读所有频道。`join` 和 `leave` 始终作用于调用方自身的主体（在工位会话或工单会话里是会话对应的员工，会话之外是当前登录的人），所以 `join` 绝不可能添加别人。`join`、`remove`、`archive` 和 `unarchive` 是给人用的操作：在会话里调用时，服务器会以 `403 not_a_member` 应答，与其他 API 错误一样原样打印。

`tail` 以 `time  sender  text` 的格式打印当天的最后 20 条消息；`-n` 改变条数，`--date` 选择别的日期。`--json` 下打印当天的响应，包含这些消息。`send` 发送一条消息，`@agent:<id>` 和 `@all` 提及会触发对应员工的工位。`system` 行在英文文本之外还携带结构化的 `notice`，`tail` 因此能用 CLI 自身的语言渲染它；当前构建不认识的通知类型则保留英文文本。

### handbook

- `list` 列出手册的文件，包括路径、大小和最近更新，索引排在最前。
- `show` 打印一个文档；不给路径时打印索引（`README.md`）。
- `write` 存储文档，`-m <text>` 与 `--file <file>` 必须恰好提供其中一个。
- `rm` 删除文档。索引不能删。

含 `..` 段的路径一律拒绝。

### finance

`finance` 打印本期支出：按员工（自身支出与沿汇报线的累计支出，与预算对比，带 `warned` 和 `paused` 标记）和按工单分别列出，最后是总额。如果有用量发生在未配置价格的模型上，stderr 会提示这些数字只是下限。

## 审批模式（--approve）

| 模式 | 行为 |
| --- | --- |
| `allow-all` | 自动批准每一次工具调用（默认） |
| `deny-all` | 自动拒绝每一次工具调用 |
| `read-only` | 自动批准只读工具，其余逐一询问 |
| `always-ask` | 每一次工具调用都询问 |

在审批提示处，`n` 或 `no` 拒绝这次调用。`y`、`yes` 或任何其他回答，包括直接回车，都会批准。

## penguin config

管理 Project 的模型配置、每个 Agent 的 vault 环境变量以及界面语言。除 `lang` 外，每个子命令都接受 `--project-id <id>`（默认值：默认 Project）和 `--root <dir>`。

### model add

添加或更新一条模型条目。

```bash
penguin config model add --provider deepseek --model-id deepseek-v4-pro --api-key sk-... --set-default
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--model-id <id>` | 上游模型 id。必填。 | — |
| `--provider <group>` | 条目所属的供应商分组。必填。 | — |
| `--api-key <key>` | API key，直接写在 Project 隐藏的 `.project_config.toml` 里。 | — |
| `--base-url <url>` | 自定义端点的 base URL。 | 见下文 |
| `--context-window <n>` | 上下文窗口大小，单位是 Token。 | — |
| `--max-tokens <n>` | 这个模型的最大输出 Token 数，必须是正整数。设置后会覆盖 Agent 的 `model.max_tokens`；小上下文模型应调低此值。 | Agent 的 `model.max_tokens` |
| `--client-type <type>` | AgentHub 客户端协议类型，例如 `openai-chat`。 | 见下文 |
| `--vision` / `--no-vision` | 标记是否支持图片输入。 | 保持当前值 |
| `--fast-mode` / `--no-fast-mode` | 开启或关闭快速模式（输出更快，价格更高）。 | 关闭；两个都不写则保持当前值 |
| `--price-cache-read <n>` | 缓存读取价格，单位为美元每百万 Token。 | — |
| `--price-cache-write <n>` | 缓存写入价格，单位为美元每百万 Token。 | — |
| `--price-output <n>` | 输出价格，单位为美元每百万 Token。 | — |
| `--set-default` | 同时把这条条目设为 Project 的默认模型。 | — |

- CLI 绝不会从模型 id 推断 `--provider`。网关会按上游模型 id 转售厂商模型，靠猜测分组可能把凭证写到另一家厂商的端点上。内置分组之外的端点一律用 `custom`。
- 新建条目时，`--client-type` 和 `--base-url` 默认取内置模型目录为对应 `(provider, model_id)` 组合设置的值。模型目录里没有这一条时由分组决定：指定了协议的分组就用它指定的协议；`custom`、用户自定义和网关分组用 `openai-chat`，网关分组的端点会自动填成 base URL；第一方厂商分组则两项都不设置。更新已有条目时，只有显式传入这两个选项才会改动。
- 如果模型的 AgentHub 客户端不接受这个参数，开启 `--fast-mode` 仍会写入条目，但会在 stderr 上打印警告。

### model default / model vision / model list / model remove

```bash
penguin config model default --model-id <id> --provider <group>
penguin config model vision --model-id <id> --provider <group>
penguin config model list
penguin config model remove --model-id <id> --provider <group>
```

- `model default` 设置 Project 的默认模型，`model vision` 设置视觉代理模型。两者都要求 `--model-id` 和 `--provider`，而且这对组合必须已经在模型列表里。
- `model list` 列出已配置的模型，并用 `*` 标记默认模型。
- `model remove` 删除一条模型条目，连同直接写在条目上的凭证一起删除。命令要求 `--model-id` 和 `--provider`，并精确匹配这对组合，所以另一个分组下相同上游 id 的条目不受影响。这对组合不在配置里时，命令以非零退出码退出。如果删除的条目是默认模型或视觉模型，相应设置会一并清空：指向已不存在的模型，会让下一次会话直接失败。

### vault

每个 Agent 独立的环境变量存储，写入 `agent_state/.vault.toml`。这些值只注入工具子进程的环境，从不进入模型上下文。

```bash
penguin config vault set --key GITHUB_TOKEN --value ghp_xxx
penguin config vault list
penguin config vault remove --key GITHUB_TOKEN
```

| 子命令 | 选项 |
| --- | --- |
| `vault set` | `--key <name>`（必填）、`--value <value>`（必填）、`[--agent-id <id>]` |
| `vault list` | `[--agent-id <id>]` |
| `vault remove` | `--key <name>`（必填）、`[--agent-id <id>]` |

`--agent-id` 默认为 `default_agent`。

### lang

```bash
penguin config lang en
```

设置 CLI 的界面语言（`en` 或 `zh`），方式是把 `PENGUIN_LANG` 写入你的 shell 启动文件。在交互式终端里，命令随后会提议打开一个新 shell 让设置生效；否则会打印让设置生效的方法。Windows 上命令会拒绝执行，因为没有 POSIX shell 启动文件可写。

## penguin server / penguin web

同一个服务进程的两个入口。`server` 以无界面方式运行服务。`web` 还会等服务就绪，打印 URL 并打开浏览器。

```bash
penguin server [--port <port>] [--host <host>]
penguin web [--port <port>] [--host <host>] [--no-open]
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--port <port>` | 监听端口。 | `7364` |
| `--host <host>` | 监听地址。 | `127.0.0.1` |
| `--no-open` | 仅限 `web`：不打开浏览器。 | — |

端口和主机按以下顺序确定：命令行选项，然后是 `PORT` / `HOST` 环境变量（包括来自 `.env` 的），最后是默认值。

如果这个数据根目录上已经有服务在运行，`penguin server` 会说明情况并以退出码 1 退出；`penguin web` 则打印正在运行实例的 URL 并打开它（除非指定 `--no-open`），不会启动第二个实例。

两个命令都把服务作为子进程运行，并以托管进程的身份守在它前面。终端里的 Ctrl+C 会传达给服务，命令以服务的退出码退出。当服务请求重启时——例如 `penguin update` 替换安装之后，Web App 的**重启并更新**就会发出这种请求——托管进程会在新版本上重新启动服务，并打印一行文字说明。通过 `tsx` 运行的开发版无法由普通 Node 重新拉起，因此服务改为在当前进程内运行，此时 Web App 会提示管理员手动重启。

```bash
penguin web
```

### penguin server status

以一行 JSON 打印这个数据根目录的服务器状态和本机自身的 id。它能回答「服务器是否在运行」，因为它读取的是数据根目录本身，而不是去询问一个运行中的进程。

```bash
penguin server status [--root <dir>]
# {"running":true,"port":7364,"pid":41233,"machineId":"LNrJdHAZJ91G58i0"}
```

只有当记录的 pid 还活着、端口也能建立连接时，`running` 才是 true，所以复用的 pid 不会冒充存活的服务器。没有服务器在运行时，`port` 和 `pid` 为 `null`。`machineId` 在本机至少启动过一次服务器之前为 `null`：id 在首次启动时生成，此后永不改变。数据根目录照常取自 `--root` 或 `PENGUIN_HOME`。

**机器**页面通过 ssh 运行这条命令，询问一台机器正在做什么，这也是输出采用 JSON 而不是文字说明的原因。

### penguin server reset-admin-password

忘记 Web 管理员密码时的离线补救手段。必须在服务器停止的状态下运行；数据根目录上还有服务器在运行时，命令会拒绝执行。

```bash
penguin server reset-admin-password
```

内置的 `admin` 账号回到未认领状态：密码换成一个没人见过的随机值，它的所有会话全部吊销。重新启动服务器，打开它打印的首次登录链接设置新密码即可，中间不需要记下任何东西。其他账号由管理员在**用户管理**页面重置，这条命令只处理 `admin`。数据根目录照常取自 `PENGUIN_HOME`。

### penguin server stop

停止这个数据根目录上的服务器，并以一行 JSON 报告结果。

```bash
penguin server stop [--root <dir>]
# {"ok":true,"pid":41233}
```

命令发送 `SIGTERM`，最多等待 15 秒，让服务器释放数据根目录。它绝不会发送 `SIGKILL`：服务器持有数据库，可能还有任务在收尾，超时就强杀不是调用方有权做的决定。数据根目录上本来就没有服务器在运行时，命令返回 `{"ok":true}`，因为「没有进程在服务这个目录」正是调用方想要的结果。

服务器停不下来时，命令打印 `{"ok":false,"pid":…,"detail":"…"}` 并以退出码 1 退出。出现这种情况的情形有：信号无法送达；`SIGTERM` 发出 15 秒后服务器仍占用着数据根目录；以及在 Windows 上——那里无法通过信号实现优雅停止，只能从服务器自己的控制台停止。

**机器**页面重启一台机器时，会通过 ssh 运行这条命令。之所以用命令而不是直接向服务器发请求，是因为需要停止的机器通常正是平台版本过期的那台，而平台路由要等机器跑上带这条路由的构建版本才会存在。

## penguin version

报告当前运行的是哪个构建。只看版本号回答不了这个问题：两次发布之间从源码检出构建出的每个版本也都自称 `0.2.3`，所以发布版和源码构建版要用不同的方式标识自己。

```bash
penguin version          # v0.2.3            (a release)
penguin version          # v0.2.3-14-g9e8f7d6-dirty   (built from a checkout)
penguin version --json   # the full build info
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--json` | 打印完整的版本报告，而不是一行：`{version, describe, channel, buildDate, commit, branch, dirty, runtime, harness}`。 | — |
| `--root <dir>` | 指定把哪个数据根目录的 HMR 存储报告为 `harness`。仅在指定 `--json` 时使用。 | `PENGUIN_HOME`，否则 `~/.penguin/data` |

不带选项时打印一行。对源码构建版来说，这一行就是 `git describe --tags --dirty` 的输出：`v0.2.3-14-g9e8f7d6-dirty` 表示在 `v0.2.3` 之后第十四个提交（`9e8f7d6`），且带有未提交的改动。`-v, --version` 打印同样的一行。

`describe` 指向可达的最近的 git 标签，不一定等于 `version` 前面加个 `v`。准备发布时，`version` 先在自己的提交里升号，标签随后才创建，所以处于这个窗口期的构建会报告 `v0.2.3-14-g9e8f7d6`，而 `version` 已经是 `0.2.4`。要看发布号，读 `version`；要看在历史中的位置，读 `describe`。

这份 JSON 和 `GET /api/version` 返回的是同一条记录，所以 bug 报告可以从 HTTP 边界的任意一侧收集它。其中：

- `channel` 取值为 `release` 或 `source`。
- `buildDate` 和 `commit` 由发布流程写入构建，源码构建版为 null。
- `branch` 和 `dirty` 描述源码构建版的 git 位置，发布版为 null——发布版用不上这两个字段，因为发布流程会在构建前把常量写入代码树。

### harness：这里热推送过什么

`harness` 描述数据根目录的 HMR 存储：热更新提交进来的 harness 代码，重启后会恢复运行。这个数据根目录从未推送过任何内容时为 null。

```json
"harness": {
  "source": { "repo": "…/penguin-harness", "revision": "v0.2.3-7-gabc1234-dirty" },
  "pushedAt": "2026-08-20T10:15:00.000Z",
  "bundles": { "platform": "store/platform/…", "cli": "store/cli/…", "web": "store/web/…" }
}
```

这是版本那一行唯一报告不了的信息。推送出去的 bundle 落在所有检出之外，只能用编译时依据的版本来标识自己。`source.revision` 由推送方记录，写法与 `describe` 相同，是唯一能指明背后修订版本的字段。`bundles` 保存已提交产物的内容寻址指针。无论推送方怎么声称，这些指针标识的都是实际推送的代码本身。

`harness` 描述的是存储，不是正在运行的进程。`penguin` 运行打包好的 CLI，`penguin-hmr` 运行存储里的 CLI，所以 `harness` 非 null 并不意味着打印它的命令就是推送来的代码。推送方客户端没有记录来源信息时，`source` 为 null——在来源信息机制出现之前推送的内容也都如此。

安装好的 `penguin` 从不运行 git：它读取构建时打入的常量。发布版的常量来自发布流程。其他构建的 git 位置由生成它的打包器内联进去，所以产物离开检出之后仍能标识自己：`<root>/hmr/store/` 下的热推送 bundle 能报告自己构建时所在的修订版本，即使机器上没有任何检出、也没安装 git。运行时询问 git 只是未打包的 `tsx` 运行方式的兜底做法，而且问的也是自己的检出，所以在无关的仓库里运行 `penguin version`，报告的是 harness 的修订版本，而不是那个仓库的。

## penguin auth

从终端登录一台正在运行的 PenguinHarness 服务器。登录方式有两种，选哪种取决于你所处的位置。

```bash
penguin auth login                      # password, against the server on this data root
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # no password: minted from this data root
```

每个 `auth` 子命令都接受 `--root <dir>` 来选择数据根目录；参见[全局约定](#全局约定)。

### penguin auth login

`login` 使用密码向正在运行的服务器请求会话，和浏览器的登录页完全一样。目标默认是这个数据根目录上运行的服务器，从它的锁文件读出，所以登录你自己的服务器不需要 URL。

交互式运行时，`login` 先问账号、再问密码，密码提示中会显示账号名，因此不会把一个账号的密码误输入给另一个账号。如果以非交互方式提供密码（`--password` 或 `PENGUIN_PASSWORD`），这两个问题都不会出现，因为脚本无法回答。

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--server <url>` | 要登录的服务器。 | 这个数据根目录上运行的服务器 |
| `--user-id <id>` | 账号。省略时会询问；直接回车表示 `admin`。 | `admin` |
| `--password <pw>` | 密码。也可以从 `PENGUIN_PASSWORD` 读取；否则会提示输入且不回显。 | — |
| `--print` | 同时把 session token 打印到 stdout，供管道使用。 | — |

> [!WARNING]
> 优先用 `PENGUIN_PASSWORD` 或交互提示，而不是 `--password`：机器上的任何人都能通过 `ps` 读到命令行。

### penguin auth token

`token` 完全不需要密码。它直接往数据根目录的 `web.db` 里写一条会话记录，授权依据是：你能读写这个数据根目录，而它本来就保存着 token 能触达的全部凭证。因此 `token` 是**数据根目录所有者**的工具：多用户部署时，数据根目录属于运行服务器的操作系统账号，其他人一律用 `auth login` 登录。数据根目录上从未运行过服务器时命令会失败，因为还没有 `web.db` 可写。在拿不出密码的场合使用它：

- 管理员密码由人手动设置过的机器。
- 不能保存密码的脚本。
- 通过 ssh 连接受管机器的控制器。

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--user-id <id>` | 账号。 | `admin` |
| `--ttl-seconds <n>` | 会话有效期（秒）：正整数，上限 30 天。 | `3600` |
| `--mark` | 在 token 之前打印一行固定标记，供从 shell 输出中解析 token 的调用方使用——这类 shell 的登录配置可能会打印横幅。 | — |

### penguin auth status / penguin auth logout

会话保存在 `<root>/cli-session.json`，文件权限为 0600。`login` 写入它；数据根目录上有服务器在运行时，`token` 也会写入。`status` 读取它。`logout` 吊销会话并删除文件：它会先通知服务器，因此会话在服务器端结束，而不只是本地把它忘掉。连不上服务器时，`logout` 会说明情况，然后照样删除本地文件。

## penguin update

使用当初安装时所用的机制，原地升级当前安装。命令根据正在运行的 CLI 的真实路径判断安装类型，绝不猜测。

```bash
penguin update --check     # report versions only
penguin update             # upgrade to the latest release, after confirming
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--check` | 只报告已安装版本和最新版本，不做任何改动。无论哪种情况都以退出码 0 结束。 | — |
| `--release <tag>` | 升级到指定发布版本而不是最新版（`v0.1.2` 或 `0.1.2`）。允许指定更旧的标签，并会按降级报告。 | 最新发布版 |
| `-y, --yes` | 跳过确认提示。 | — |

这个选项是 `--release` 而不是 `--version`，因为 `-v, --version` 是 CLI 自身的版本选项，会抢先生效。

| 安装类型 | 升级方式 |
| --- | --- |
| 压缩包（`install.sh`，默认 `~/.penguin`） | 重新运行官方安装器，保留原安装目录以及安装包是否自带 Node 运行时 |
| npm、pnpm、yarn 或 bun 全局安装 | 用对应的包管理器全局安装 `@prismshadow/penguin-cli@<target>`。无法识别包管理器时，打印命令而不是猜测 |
| 源码检出 | 拒绝：请用 `git pull` 加重新构建来更新 |
| 桌面应用内置的 CLI | 拒绝：应用更新时会随之替换，请从应用菜单检查更新 |
| 无法识别的布局 | 拒绝：请用官方安装器重新安装，或用当初的包管理器升级 |

不带 `-y` 时，命令会打印它将要做的事（升级机制、目标版本和安装目录），并要求确认。stdin 不是终端时，命令要求提供 `--yes`，而不是等一个没人能回答的提示。**数据根目录完全不受影响**：升级只替换 `bin`、`lib`、`web` 和 `node`。Windows 上两种升级路径都无法原地执行。安装器是 POSIX shell 脚本；全局安装也无法从这里驱动，因为 Node 离开 shell 就无法执行 `npm` 或 `pnpm` 的 `.cmd` shim，所以命令会把完整命令打印出来，由你自己运行。

发布版本的发现和下载遵循 `PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`，与稳定版安装入口使用相同的策略：

- `auto` 是默认值：读取 OSS 的 `latest.json`，优先使用那个不可变的发布版本，失败时退回匹配的 GitHub 标签。安装包本身则来自安装器测速后选定的源。
- `oss` 和 `github` 是严格模式：命令只使用指定的源。
- `--release <tag>` 跳过最新版本探测，但仍遵循所选的源策略。
- 显式设置的 HTTPS `PENGUIN_DOWNLOAD_BASE_URL` 拥有最高优先级，安装器和安装包下载都遵循它；`PENGUIN_DOWNLOAD_FALLBACK_BASE_URL` 可选，为安装包提供回退地址。

另请参阅：[配置参考](/configuration)、[模型与供应商](/models)。
