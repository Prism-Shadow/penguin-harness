---
title: CLI 参考
description: penguin 命令的子命令与选项完整参考。
---

CLI 由 npm 包 `@prismshadow/penguin-cli` 提供，命令为 `penguin`。不带子命令执行 `penguin` 时打印帮助；`-v, --version` 打印版本号。启动时自动加载工作目录下的 `.env`。

## 全局约定

- 模型引用：模型身份始终是 `(provider, model_id)` 二元组。`--model-id` 填上游模型 id，`--provider` 填其所属分组；provider 绝不推断、绝不猜测、也没有缺省值。`run` / `chat` 上这对参数整体可选——两个都给即指定模型，两个都不给则使用 Project 默认模型——但只给其中一个是错误。
- 数据根目录：`--root <dir>` 覆盖数据根目录，优先级为 `--root` > 环境变量 `PENGUIN_HOME` > `~/.penguin/data`。

## penguin run

发送单条消息执行一个 Task，结束后退出；Task 被中止时以非零码退出，便于脚本 / CI 判断。

```bash
penguin run -m "总结当前目录的代码结构"
```

| 选项 | 说明 |
| --- | --- |
| `-m, --message <message>` | 必填，要发送的消息 |
| `--model-id <id>` | 指定模型的上游 id，须与 `--provider` 同时给出；两者都不给时使用 Project 默认模型 |
| `--provider <group>` | 模型所属 Provider 分组，给出 `--model-id` 时必填 |
| `--project-id <id>` | 指定 Project |
| `--agent-id <id>` | 指定 Agent |
| `--workspace <path>` | Workspace 目录，默认当前目录，必须已存在 |
| `--approve <mode>` | 审批模式，见下文 |
| `--thinking <level>` | 本 Session 的思考等级：`low` / `medium` / `high` / `xhigh` / `max`。省略时按配置链取值（Agent 的 `model.thinking_level`，其次 Project 的 `default_chat.thinking_level`，最后 `medium`）。在 Session 创建时钉定，派生的子会话随之生效 |

## penguin chat

交互式 REPL，每输入一行发起一个 Task。选项与 `run` 相同（除 `-m, --message` 外），另加：

| 选项 | 说明 |
| --- | --- |
| `--resume [sessionId]` | 恢复指定 Session；省略 id 时恢复该 Agent 最近的 Session |
| `--verbose` | 显示完整工具输出；缺省折叠过长的工具输出（见下文） |

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

## penguin auth

在终端里登录正在运行的 PenguinHarness 服务。这是 CLI 里唯一以客户端身份与服务通信的部分——`config`、`run`、`chat` 都是直接操作数据根。

有两种登录方式，取决于你站在哪里。

```bash
penguin auth login                      # 用密码登录该数据根上运行的服务
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # 不需要密码：直接从数据根签发
```

`login` 需要密码，向正在运行的服务请求会话，和浏览器登录页做的事完全一样。目标默认是该数据根上正在运行的服务（从锁文件读端口），所以登录自己的服务不必写 URL。

交互运行时会先问账号，再问密码，并且密码提示里写明是哪个账号的，避免把一个账号的密码输到另一个账号上。如果用非交互方式给了密码（`--password` 或 `PENGUIN_PASSWORD`），两个问题都不会问——那是脚本，脚本没法回答。

| 选项 | 说明 |
| --- | --- |
| `--server <url>` | 要登录的服务；默认是该数据根上运行的那个 |
| `--user-id <id>` | 账号；不给时会询问，直接回车即用 `admin` |
| `--password <pw>` | 密码；也可用 `PENGUIN_PASSWORD`，都没给时会无回显地提示输入 |
| `--print` | 同时把会话令牌打印到 stdout，便于管道使用 |

优先用 `PENGUIN_PASSWORD` 或交互输入，而不是 `--password`：命令行参数可以被 `ps` 看到。

`token` 完全不需要密码。它直接从数据根签发会话，其授权依据就是你能读这个数据根——而它本来就装着这个令牌所能触及的全部凭据。适用于没有密码可给的场合：管理员密码被人改过的机器，或不该持有密码的脚本。控制端通过 ssh 管理机器时执行的也是它。

| 选项 | 说明 |
| --- | --- |
| `--user-id <id>` | 账号，默认 `admin` |
| `--ttl-seconds <n>` | 有效期秒数，默认 3600 |
| `--mark` | 在令牌前打印固定标记行——供需要从 shell 输出里解析它的调用方使用，因为登录 profile 可能打印横幅 |

会话写入 `<root>/cli-session.json`，权限 0600；`status` 读它，`logout` 吊销并删除它。`logout` 会先告诉服务端，让会话真正失效，而不只是本地忘记；连不上服务时会明说，本地文件照样删除。

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
