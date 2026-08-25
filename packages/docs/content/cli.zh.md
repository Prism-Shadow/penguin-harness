---
title: CLI 参考
description: penguin 命令的子命令与选项完整参考。
---

CLI 由 npm 包 `@prismshadow/penguin-cli` 提供，命令为 `penguin`。不带子命令执行 `penguin` 时打印帮助；`-v, --version` 打印当前构建的单行身份，`penguin version --json` 打印其完整信息。启动时自动加载工作目录下的 `.env`。

CLI 是服务端的瘦客户端：所有会话相关命令（`run`、`chat`、`ls`、`input`、`logs`、`agent`、`project`、`cost`、`schedule`）都向 PenguinHarness 服务端发 HTTP 请求并渲染回复——Task 在服务端执行，Session 记录在服务端索引里，Web App 能看到 CLI 创建的一切（反之亦然）。只有 `config` 仍直接编辑 Project 配置文件，`server` / `web` 则负责启动服务本身。

## 服务器连接

连接本机服务器的 CLI 无需登录。连接按以下顺序解析，先命中先用：

1. `--server <url>`——显式指定目标。
2. `PENGUIN_API_URL`——同上，来自环境变量。服务端驱动的会话会把它（连同 `PENGUIN_API_TOKEN`、`PENGUIN_PROJECT_ID`、`PENGUIN_AGENT_ID`、`PENGUIN_SESSION_ID`）注入每个工具子进程，因此 Agent 自己执行的 `penguin` 命令天然连回运行它的那台服务器。
3. 数据根目录（`PENGUIN_HOME`，否则 `~/.penguin/data`）下存活的 `server.lock`：附着到本机正在运行的服务器。
4. 自动拉起：以随机端口分离启动一个本机服务器（输出写入 `<root>/logs/server-auto-<date>.log`），等待就绪后附着。两个 CLI 竞争拉起时，输家的子进程自行退出，双方都附着到赢家。

鉴权使用本机 API token：服务端每次启动都把新 token 写入 `<root>/api-token`（仅属主可读，逐次启动轮换），CLI 以 `Authorization: Bearer` 发送。`PENGUIN_API_TOKEN` 优先于文件；文件只在目标为回环地址时读取——连接远端 `--server` 必须显式设置 `PENGUIN_API_TOKEN`。持有该文件即等于管理员权限，这是有意设计：对数据根目录的本机文件系统访问本就等于管理员权限（与 `penguin server reset-admin-password` 同一条规则）。

## 全局约定

- 模型引用：模型身份始终是 `(provider, model_id)` 二元组。`--model-id` 填上游模型 id，`--provider` 填其所属分组；provider 绝不推断、绝不猜测、也没有缺省值。`run` / `chat` 上这对参数整体可选——两个都给即指定模型，两个都不给则使用 Project 默认模型——但只给其中一个是错误。
- Project 与 Agent 缺省值：`--project-id` 依次回落到 `PENGUIN_PROJECT_ID`、`default_project`；`--agent-id` 依次回落到 `PENGUIN_AGENT_ID`、`default_agent`。在服务端驱动的会话内，这些环境变量即会话自身的坐标。
- Session 引用：凡接受 session id 的地方（`input`、`logs`、`run --session`、`chat --resume`），完整 id 或任何唯一片段皆可——`penguin ls` 打印的末尾 8 位十六进制就是为此准备的简写。片段有歧义时报错并列出候选。
- `--json` 输出原始 JSON 而非渲染 / 表格形式；`--server <url>` 指定目标服务器（见上）。
- 数据根目录（仅 `config`）：`--root <dir>` 覆盖数据根目录，优先级为 `--root` > 环境变量 `PENGUIN_HOME` > `~/.penguin/data`。

## penguin run

在服务端创建（或复用）一个 Session，发送单条消息，流式渲染直至 Task 结束，打印统计行后退出。完成时退出码为 0；goal 模式仅目标 `complete` 时退出 0。

```bash
penguin run -m "总结当前目录的代码结构"
penguin run -m "继续" --session 402a2e24        # 用片段复用既有会话
penguin run -m "长任务" --background            # 立即返回 session id
```

| 选项 | 说明 |
| --- | --- |
| `-m, --message <message>` | 必填，要发送的消息 |
| `--project-id <id>` | 指定 Project（缺省依次取 `PENGUIN_PROJECT_ID`、`default_project`） |
| `--agent-id <id>` | 指定 Agent（缺省依次取 `PENGUIN_AGENT_ID`、`default_agent`） |
| `--workspace <path>` | Workspace 目录；相对路径按 CLI 的当前目录解析，缺省即当前目录。目录必须存在于服务器所在机器——本机默认流程里就是这台机器 |
| `--model-id <id>` | 指定模型的上游 id，须与 `--provider` 同时给出；两者都不给时使用 Project 默认模型 |
| `--provider <group>` | 模型所属 Provider 分组，给出 `--model-id` 时必填 |
| `--approve <mode>` | 审批模式，见下文（缺省 `allow-all`）。与 `--session` 同用时 PATCH 该会话的粘性模式 |
| `--thinking <level>` | 本次 Task 的思考等级：`low` / `medium` / `high` / `xhigh` / `max`，随任务请求下发。省略时按会话钉定值（否则 Agent 配置）生效 |
| `--session <sessionId>` | 复用既有 Session（完整 id 或唯一片段），不再新建；不能与 `--workspace` 及模型对同用 |
| `--background` | 提交任务后立即退出并打印 session id（`--json` 下为 `{"sessionId"}`）；任务在服务端继续运行，可用 `penguin logs -f` 跟随 |
| `--goal [budget]` | 目标模式：消息即目标，服务端循环直至终态；可选值为 token 预算（如 `500k`） |
| `--json` | 输出最终的 `{sessionId, status, text}` 对象而非渲染流（`text` 为主会话各条助手文本消息拼接） |
| `--server <url>` | 目标服务器（见「服务器连接」） |

## penguin chat

交互式 REPL，每输入一行发起一个 Task。选项与 `run` 相同（除 `-m, --message` 外），另加：

| 选项 | 说明 |
| --- | --- |
| `--resume [sessionId]` | 恢复指定 Session（完整 id 或唯一片段）；省略 id 时恢复该 Agent 最近的 Session |
| `--verbose` | 显示完整工具输出；缺省折叠过长的工具输出（见下文） |
| `--server <url>` | 目标服务器（见「服务器连接」） |

使用 `--resume` 时，Workspace 与模型由原 Session 锁定，不可再用 `--workspace` / `--model-id` / `--provider` 覆盖。思考等级是逐轮参数，`--resume` 下仍接受 `--thinking`：它作为初始的 `/thinking` 覆盖生效，而不是创建时的缺省值。退出时会打印可直接复制的 `penguin chat --resume <sessionId>` 命令。

REPL 内命令：

| 输入 | 行为 |
| --- | --- |
| 运行中输入任意文字 | 运行中插话：排队后以 `[user_steering]` 用户消息随下一轮送达模型（`»` 确认行会回显文字）；输入期间渲染暂挂，流式输出不会打断正在输入的行。若 Task 恰好已结束，该行作为下一条普通消息发送 |
| `/compact` | 主动压缩当前上下文 |
| `/clear` | 原地开启全新空白 Session；原会话保留在磁盘上，仍可用 `--resume` 恢复 |
| `/thinking` | 显示下一轮将使用的思考等级，并区分它是本 Session 的缺省值还是生效中的逐轮覆盖值（后者同时给出被覆盖的缺省值） |
| `/thinking <level>` | 覆盖本次对话后续轮次的思考等级（`low` / `medium` / `high` / `xhigh` / `max`）；不会写回 Agent 配置。该覆盖只作用于本 Session 自己的轮次——派生的子会话仍按 Session 创建时的等级启动 |
| `/verbose` | 在折叠与完整工具输出之间切换 |
| `/exit`、`/quit` | 退出 |

过长的工具输出（`exec_command` 的结果、`read_file` 读回的整个文件）缺省折叠显示，避免刷屏：前 4 行照常流式打印，输出结束时打印省略标记（`……（另有 N 行，/verbose 显示完整输出）`）与最后 4 行；不超过 9 行的输出完整显示。这只是显示层截断——模型、Trace 与 Web App 收到的始终是完整输出。`/verbose`（或启动时加 `--verbose`）可关闭折叠、对后续输出生效；`--resume` 恢复的历史按同一规则折叠。`penguin run` 从不折叠：它的输出供管道与嵌套 CLI 消费。

Ctrl-C 的行为依状态而定：

| 状态 | 行为 |
| --- | --- |
| 等待工具审批 | 拒绝该次工具调用 |
| Task 运行中 | 中断当前 Task，返回输入 |
| 输入缓冲非空 | 清空当前输入 |
| 空闲且缓冲为空 | 显示退出确认（y/N） |

## penguin ls

列出 Project 的会话——覆盖全部 Agent，或用 `--agent-id` 限定一个。列依次为：短 id（其余命令可作片段使用的末尾 8 位十六进制）、Agent、标题、运行中 / 空闲、最近活动、Workspace 尾段。已归档会话仅在 `-a` 下出现。

```bash
penguin ls
penguin ls --agent-id default_agent -a
penguin ls --json
```

| 选项 | 说明 |
| --- | --- |
| `--project-id <id>` / `--agent-id <id>` | 作用域（缺省值见「全局约定」；未给 `--agent-id` 时列出 Project 的全部 Agent） |
| `-a, --all` | 包含已归档会话 |
| `--json` / `--server <url>` | 同各处约定 |

## penguin input

向既有会话发送消息。运行中的会话按插话（steering）送达（随下一轮交给模型）；空闲会话则发起新 Task。缺省等待并渲染直至本轮结束；`--no-wait` 在服务端受理后立即返回。

```bash
penguin input 402a2e24 -m "顺便检查一下测试"
penguin input 402a2e24 -m "排个队" --no-wait
```

| 选项 | 说明 |
| --- | --- |
| `-m, --message <text>` | 必填，消息文本 |
| `--no-wait` | 202 受理后立即返回，不渲染本轮 |
| `--project-id <id>` | 片段检索的作用域（完整 session id 不需要） |
| `--json` / `--server <url>` | 同各处约定；等待模式下 `--json` 输出 `{sessionId, status, text}`，`--no-wait` 下仅 `{sessionId}` |

## penguin logs

用与 REPL 相同的渲染器渲染会话历史。

```bash
penguin logs 402a2e24 --tail 20
penguin logs 402a2e24 -f
```

| 选项 | 说明 |
| --- | --- |
| `--tail <n>` | 只显示最后 n 条 |
| `-f, --follow` | 渲染历史后继续跟随实时输出流（只读；Ctrl-C 仅断开，不影响会话） |
| `--project-id <id>` | 片段检索的作用域 |
| `--json` / `--server <url>` | 同各处约定；`--json` 输出原始消息数组（`-f` 下按行追加到达的 JSON 消息） |

## penguin agent

```bash
penguin agent ls
penguin agent create --agent-id helper --name "Helper" --skills web-search,pdf
```

`agent ls` 列出 Project 的 Agent（id、名称、会话数、描述）。`agent create` 创建一个：

| 选项 | 说明 |
| --- | --- |
| `--agent-id <id>` | 必填，Agent id（即目录名） |
| `--name <s>` / `--description <s>` | 显示名与描述 |
| `--skills <a,b>` | 逗号分隔的技能库 Skill 名，预装进新 Agent；未知名称在创建任何东西之前即被拒绝 |
| `--project-id <id>` / `--json` / `--server <url>` | 同各处约定 |

## penguin project

`penguin project ls` 列出当前账号可用的 Project（自有与被授权），含 id、显示名与角色。`--json` / `--server` 同各处约定。

## penguin cost

来自服务端用量聚合的 Token 用量与成本。缺省打印汇总卡片——今日 / 近 7 天 / 累计（与任何范围参数无关，恒计算）；`--by` 改为打印分组表格。

```bash
penguin cost
penguin cost --days 7 --by model
penguin cost --from 2026-08-01 --to 2026-08-25 --by agent
```

| 选项 | 说明 |
| --- | --- |
| `--days <n>` | 最近 n 天（自动换算为 from/to） |
| `--from <d>` / `--to <d>` | 显式范围（`yyyy-mm-dd`，恒成对） |
| `--by <dim>` | 按 `date`、`agent`、`model` 或 `session` 分组 |
| `--project-id <id>` / `--agent-id <id>` | 作用域；`--agent-id` 为过滤条件（此处没有缺省 Agent——成本是 Project 视图，除非显式收窄） |
| `--json` / `--server <url>` | 同各处约定 |

成本后缀 `+` 表示部分和（该桶里有模型未配置价格）；`-` 表示完全没有计价用量。

## penguin schedule

`penguin schedule ls` 列出 Project 的定时任务——覆盖全部 Agent，或用 `--agent-id` 限定。列依次为：Agent、名称、启用与否、开始时刻、周期（一次性任务为「一次性」）、目标（绑定会话的短 id 或「新建会话」）、最近触发，以及非 active 状态的标记（`expired` / `done` / `missed` / `invalid`；无法解析的任务文件也会列出并标记 invalid）。`--json` / `--server` 同各处约定。

## 审批模式（--approve）

| 模式 | 行为 |
| --- | --- |
| `allow-all` | 自动批准所有工具调用（默认） |
| `deny-all` | 自动拒绝所有工具调用 |
| `read-only` | 自动批准只读工具，其余逐个询问 |
| `always-ask` | 每次工具调用都询问 |

交互询问时输入 `y` / `yes` 批准、`n` / `no` 拒绝；直接回车默认为批准。

## penguin config

管理 Project 的模型配置、Agent 级 vault 环境变量与界面语言。除 `lang` 外，以下子命令均支持 `--project-id <id>`（缺省为默认 Project）与 `--root <dir>`。

### model add

新增或更新模型条目：

```bash
penguin config model add --provider deepseek --model-id deepseek-v4-pro --api-key sk-... --set-default
```

| 选项 | 说明 |
| --- | --- |
| `--model-id <id>` | 必填，上游模型 id |
| `--provider <group>` | 必填，条目所属的 Provider 分组。它绝不由模型 id 推导：网关会以上游 id 转售厂商模型，猜错分组会把凭据写到另一家厂商的接口上。内置分组之外的接口一律用 `custom`。 |
| `--api-key <key>` | API Key，内联存入 Project 隐藏文件 `.project_config.toml` |
| `--base-url <url>` | 自定义接口地址 |
| `--context-window <n>` | 上下文窗口大小 |
| `--max-tokens <n>` | 该模型的最大输出长度（正整数）。设置后覆盖 Agent 的 `model.max_tokens`，缺省沿用；小上下文模型建议调低 |
| `--client-type <type>` | 客户端协议类型 |
| `--vision` / `--no-vision` | 标记是否支持视觉输入 |
| `--fast-mode` / `--no-fast-mode` | 开启 / 关闭快速模式（输出更快、按溢价计费；默认关闭）。在 AgentHub client 会拒绝该参数的模型上开启时，条目照常写入，但会在 stderr 给出警告。两者都不给则保留原值 |
| `--price-cache-read <n>` | 缓存读价格 |
| `--price-cache-write <n>` | 缓存写价格 |
| `--price-output <n>` | 输出价格 |
| `--set-default` | 同时设为默认模型 |

### model default / model vision / model list / model remove

```bash
penguin config model default --model-id <id> --provider <group>
penguin config model vision --model-id <id> --provider <group>
penguin config model list
penguin config model remove --model-id <id> --provider <group>
```

- `model default` 设置 Project 默认模型；`model vision` 设置视觉代理模型。两者的 `--model-id` 与 `--provider` 均为必填，且引用必须已存在于模型列表。
- `model list` 列出已配置模型，默认模型以 `*` 标记。
- `model remove` 删除一个模型条目，连同内联在其上的凭据一并删除。`--model-id` 与 `--provider` 均为必填，按成对引用精确匹配——同名上游 id 在其他分组下的条目不受影响；引用不在配置中时以非零码退出。若被删条目正是默认模型或视觉模型，对应设置一并清空：留下一个指向已不存在模型的指针，只会让下一次会话直接失败。

### vault

按 Agent 存储环境变量，写入 `agent_state/.vault.toml`；值只注入工具子进程的环境变量，绝不进入模型上下文。

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

### lang

```bash
penguin config lang zh
```

设置 CLI 界面语言（`en` 或 `zh`），将 `PENGUIN_LANG` 写入 shell 启动文件。

## penguin server / penguin web

两者是同一服务进程的两个入口：`server` 为 headless 模式；`web` 额外等待服务就绪、打印 URL 并打开浏览器。

```bash
penguin web
```

| 选项 | 说明 |
| --- | --- |
| `--port <port>` | 监听端口，默认 7364 |
| `--host <host>` | 监听地址，默认 127.0.0.1 |
| `--no-open` | 仅 `web`：不自动打开浏览器 |

端口 / 地址优先级：命令行选项 > 环境变量 `PORT` / `HOST`（含 `.env`）> 默认值。

### penguin server reset-admin-password

忘记 Web 管理员密码时的离线救援。须在服务停止后执行——数据根目录上有服务在运行时会拒绝：

```bash
penguin server reset-admin-password
```

内置 `admin` 会得到一个新的初始密码（形如 `penguin-1234`），以边框提示打印——此后每次启动服务端都会重印，直到密码被修改——并清空 admin 的全部登录会话。其他账号由管理员在用户管理页重置，本命令只作用于 `admin`。数据根目录照常由 `PENGUIN_HOME` 决定。

## penguin version

报告当前运行的是哪个构建。仅凭版本号回答不了这个问题——两次发布之间由源码 checkout 构建出来的每一个版本也都自称 `0.2.3`——因此发布版与源码构建给出的身份并不相同。

```bash
penguin version          # v0.2.3                     （发布版）
penguin version          # v0.2.3-14-g9e8f7d6-dirty   （源码构建）
penguin version --json   # 完整构建信息
```

| 选项 | 说明 |
| --- | --- |
| `--json` | 输出完整版本报告而非单行：`{version, describe, channel, buildDate, commit, branch, dirty, runtime, harness}` |
| `--root <dir>` | 以哪个数据根目录的 HMR store 作为 `harness` 上报。优先级：`--root` > `PENGUIN_HOME` > `~/.penguin/data` |

不带选项时输出单行；源码构建下该行即 `git describe --tags --dirty` 的结果——`v0.2.3-14-g9e8f7d6-dirty` 表示位于 `v0.2.3` 之后 14 个提交、当前提交为 `9e8f7d6`、且工作区有未提交改动。`-v, --version` 输出的是同一行。

`describe` 指向的是最近的可达 git tag，因此并不总是 `v` + `version`：发布准备会先用一个单独的提交抬升 `version`、之后才打 tag，所以这一窗口内的构建会报告 `v0.2.3-14-g9e8f7d6`，而 `version` 已经是 `0.2.4`。要版本号看 `version`，要在历史中的位置看 `describe`。

JSON 与 `GET /api/version` 返回的是同一份记录，因此在 HTTP 边界的任意一侧都能采集到同样的排障信息。其中 `channel` 取 `release` 或 `source`；`buildDate` 与 `commit` 由发布流程在构建时打入，源码构建为 null；`branch` 与 `dirty` 描述源码构建的 git 位置，发布版为 null——发布流程会先把常量写进工作区再构建，所以「是否干净」对发布产物本就不成立。

### harness：这台机器上热更新推了什么

`harness` 描述的是该数据根目录的 HMR store——某次热更新提交进去、并会在重启后被恢复的 harness 代码。该根目录从未被推送过时为 null。

```json
"harness": {
  "source": { "repo": "…/penguin-harness", "revision": "v0.2.3-7-gabc1234-dirty" },
  "pushedAt": "2026-08-20T10:15:00.000Z",
  "bundles": { "platform": "store/platform/…", "cli": "store/cli/…", "web": "store/web/…" }
}
```

这正是单行版本无法表达的部分：推送过去的 bundle 落在任何 checkout 之外，它只能以自己被编译时的版本号自称；`source.revision`（由推送方记录，拼写方式与 `describe` 一致）是唯一能指明其背后 revision 的信息。`bundles` 是已提交产物的内容寻址指针，无论推送方声称了什么，它标识的都是被推送代码本身。

它描述的是 store 而非当前进程：`penguin` 运行的是随包发布的 CLI，`penguin-hmr` 才运行 store 里的那份，因此 `harness` 非 null 并不意味着打印它的这条命令本身就是被推送的代码。若推送方未记录来源（包括在该机制存在之前推送的版本），`source` 为 null。

已安装的 penguin 从不调用 git，只读取构建时打入的常量：发布版由发布流程打入，其余构建则由打包器把 git 位置内联进产物，因此产物离开生成它的 checkout 之后依然能说明自己的身份——位于 `<root>/hmr/store/` 下被热推送的 bundle，在既无 checkout 也未安装 git 的机器上，仍会报告它被构建时的 revision。运行时询问 git 只是兜底，用于未经打包的 `tsx` 运行；即便如此它也只问自己所在的那个 checkout，所以在无关仓库里执行 `penguin version` 报告的仍是 harness 自身的版本，而非该仓库的。

## penguin update

原地升级当前安装，并沿用它当初的安装方式。安装方式由运行中 CLI 的真实路径判定，不做猜测。

```bash
penguin update --check     # 只报告版本
penguin update             # 确认后升级到最新版
```

| 选项 | 说明 |
| --- | --- |
| `--check` | 只报告已安装版本与最新版本，不做任何修改；两种情况下退出码均为 0 |
| `--release <tag>` | 指定目标版本而不是最新版（`v0.1.2` 或 `0.1.2`）；允许低于当前版本，会明确提示为降级 |
| `-y, --yes` | 跳过确认提示 |

目标版本参数叫 `--release` 而不是 `--version`，因为 `-v, --version` 是 CLI 自身的版本参数，会优先生效。

版本发现和 tarball 下载遵循 `PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`，与稳定安装入口使用相同策略。默认的 `auto` 模式读取 OSS `latest.json`，优先选择该不可变版本，并按同一 tag 回退到 GitHub；安装包本身则由安装器测速选出的来源提供。强制 `oss` 或 `github` 时不会切换来源。`--release <tag>` 会跳过最新版查询，但仍遵循所选下载源策略。显式设置的 HTTPS `PENGUIN_DOWNLOAD_BASE_URL` 对安装脚本和发布包下载具有最高优先级，并可通过 `PENGUIN_DOWNLOAD_FALLBACK_BASE_URL` 为发布包配置后备地址。

| 安装方式 | 升级方式 |
| --- | --- |
| tarball（`install.sh`，默认 `~/.penguin`） | 重新执行官方安装脚本，并保持原安装目录以及是否内置 Node 运行时 |
| npm/pnpm/yarn/bun 全局安装 | 用该包管理器全局安装 `@prismshadow/penguin-cli@<目标版本>`；无法确定包管理器时，只打印命令而不猜测 |
| 源码检出 | 拒绝执行——请用 `git pull` 更新并重新构建 |

不带 `-y` 时，命令会先打印它将要做什么——方式、目标版本与安装目录——再请求确认；当 stdin 不是终端时，它要求显式加 `--yes`，而不是卡在无人能回答的提示上。**数据目录不会被改动**：升级只替换 `bin`、`lib`、`web` 与 `node`。两条路径在 Windows 上都不做原地升级：安装脚本是 POSIX shell 脚本，而全局安装也无法由此驱动——Node 不会在没有 shell 的情况下执行 `npm`/`pnpm` 的 `.cmd` 包装脚本——因此命令会直接打印出应当由你自己执行的命令。

相关文档：[配置参考](/configuration)、[模型与 Provider](/models)。
