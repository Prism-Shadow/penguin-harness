---
title: 配置参考
description: PenguinHarness 的每一项设置及其默认值与限制，从环境变量到 Project、Agent、记忆、密钥保险柜和定时任务文件。
---

PenguinHarness 的配置分三层：环境变量决定部署形态，Project 配置管理模型和凭证，Agent 配置定义单个 Agent 的行为。每个 Agent 还有自己的[记忆](#记忆)、[Vault](#vault) 和[定时任务](#定时任务)状态文件。

## 环境变量

CLI 和服务器启动时会从工作目录加载 `.env` 文件。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PENGUIN_HOME` | 数据根目录 | `~/.penguin/data` |
| `PORT` | Web 服务监听端口 | `7364` |
| `HOST` | Web 服务监听地址 | `127.0.0.1` |
| `PENGUIN_WEB_DB` | 服务器 SQLite 数据库路径 | `<root>/web.db` |
| `PENGUIN_WEB_DIST` | 前端静态资源目录 | 服务器包自带的 `web-dist`（源码检出中为 `packages/web/dist`） |
| `PENGUIN_PREVIEW_ORIGIN` | 提供 Workspace HTML 预览的源，例如 `https://preview.example.com` | 未设置：每次请求推导对应的回环地址 |
| `PENGUIN_GO_ORIGIN` | 服务端发起 Penguin Go Key 授权时调用的可信源 | `https://token.penguin.ooo` |
| `MODELSCOPE_BRIDGE_URL` | 服务端发起 ModelScope Key 授权时调用的授权中转层地址 | `https://go.penguin.ooo/modelscope` |
| `PENGUIN_TRUST_PROXY` | 设为 `1` 时信任 `x-forwarded-proto` 请求头 | 未设置：忽略请求头 |
| `PENGUIN_SEED_ADMIN_PASSWORD` | 预置内置管理员的固定初始密码（自动化测试 / e2e） | 未设置：生成随机密码 |
| `PENGUIN_LANG` | CLI 语言（`en` / `zh`），用 `penguin config lang` 设置 | `en` |
| `PENGUIN_UPDATE_CHECK` | 设为 `off` 时关闭 Web App 的新版本检查 | 启用 |
| `PENGUIN_NO_LOGIN_SHELL_ENV` | 设为任意非空值后，桌面应用在 macOS/Linux 上从图形界面启动时不再导入登录 shell 的环境变量 | 未设置：照常导入 |
| `PENGUIN_SHELL` | 运行 Agent 命令的 shell（可执行文件名或路径） | 未设置：自动选择，见[工具与审批](/tools#命令会话) |
| `PENGUIN_CLI_ENTRY` | 本安装提供给所运行 Agent 的 CLI 入口脚本（见 [PATH 启动脚本](#path-启动脚本)） | 由 `penguin server` / `penguin web` 和桌面应用设置 |

说明：

- `PENGUIN_TRUST_PROXY`：只在反向代理终结 TLS、并由代理自己设置或清除这个请求头时启用。启用后，会话 Cookie 会带上 `Secure` 标记，热更新的网络检查也能识别出 HTTPS。
- `PENGUIN_SEED_ADMIN_PASSWORD`：不设置时，预置管理员时会生成一个随机密码，哈希后立即丢弃，没有人见过；账号通过首次登录链接认领。
- `PENGUIN_GO_ORIGIN`：它是服务端配置，不接受浏览器指定的端点。取值必须是不带路径的 HTTPS 源；只有 `localhost`、`127.0.0.1` 和 `[::1]` 这类集成环境可以用明文 HTTP。带路径、凭据、查询参数或 fragment 的取值会在启动时被拒绝。见[授权获取新 API key](/models#授权获取新-api-key)。
- `MODELSCOPE_BRIDGE_URL`：与 `PENGUIN_GO_ORIGIN` 一样是服务端配置，不接受浏览器指定的端点。它必须是不带凭据、查询参数或 fragment 的 HTTPS 地址。不同之处是**它允许带路径前缀**，因为生产环境的中转层就挂在 `https://go.penguin.ooo/modelscope` 下。见[授权获取新 API key](/models#授权获取新-api-key)。
- `PENGUIN_UPDATE_CHECK`：设为 `off` 只关闭自动的版本检查，不影响其他对外请求：模型请求、已启用的远程控制连接、Key 授权和代理测试照常联网。
- `PENGUIN_NO_LOGIN_SHELL_ENV`：不设置时，导入只填补启动过程没有设置的变量。见[桌面应用快速开始](/quickstart-desktop)。
- `PENGUIN_CLI_ENTRY`：服务器从源码检出启动时，会回退到检出目录中的 `packages/cli/dist/penguin.js`。

### Agent 所执行命令的环境

Agent 用 `exec_command` 运行的命令继承宿主环境，但有以下改动：

- **移除：** `PORT`、`HOST`、`FORCE_COLOR`、`CLICOLOR_FORCE` 以及所有 `PENGUIN_*` 变量。这些变量配置的是 PenguinHarness 本身，不是命令。如果不移除，`exec_command` 启动的开发服务器会读到 `PORT`，试图绑定本应留给 PenguinHarness 的端口，而不是自己另选。
- **代理：** 在服务器运行的 Session 中，由[设置](/settings#代理选项)里的 **Agent 环境使用代理** 开关决定代理变量。关闭时移除 `HTTP_PROXY`、`HTTPS_PROXY` 和 `ALL_PROXY`；开启时注入已配置的代理地址，没有配置地址时透传宿主的变量。
- **密钥保险柜：** 之后再叠加 Agent 的[密钥保险柜](#vault)，所以在保险柜里设置的 `PORT` 或 `PENGUIN_*` 变量确实能传给命令。
- **控制变量：** 由服务器驱动的 Session 随后注入 `PENGUIN_API_URL`、`PENGUIN_API_TOKEN`、`PENGUIN_PROJECT_ID`、`PENGUIN_AGENT_ID` 和 `PENGUIN_SESSION_ID`（公司模式下还有 `PENGUIN_ORG_ID`），Agent 自己发起的 `penguin` 调用因此能到达运行它的服务器。这些变量会覆盖密钥保险柜里的同名条目。见 [CLI 参考](/cli)。
- **强制：** `GIT_EDITOR`、`GIT_TERMINAL_PROMPT`、`TERM`、`NO_COLOR`、`PAGER` 和 `GIT_PAGER` 始终取固定值，命令不会因为等待编辑器、凭证提示或分页器而卡住。任何来源都无法覆盖它们，密钥保险柜也不例外。

### PATH 启动脚本

Agent 运行的每条命令，PATH 的第一位都是本安装自带的 `penguin`。服务器启动时会在 `<root>/bin/penguin` 写入一个启动脚本：脚本用服务器自己的 Node 运行 `PENGUIN_CLI_ENTRY` 指向的 CLI 入口，并把这个目录放到每条命令 PATH 的最前面。这样，命令里调用的 `penguin` 就是 Agent 正在运行的这套 harness，无论机器上全局装的是什么版本。

这个目录既前置到环境变量里，也前置到 shell 内部，因为命令通过登录 shell 运行，而登录 shell 的 profile 常常随后重写 PATH。这也让它排在[密钥保险柜](#vault)里设置的 `PATH` 之前，而保险柜里的 `PATH` 原本会整体替换继承来的值。

启动脚本在每次启动时都会重写，因此安装位置移动后，下次启动会自动跟上。没有可指向的入口时就不写启动脚本，`penguin` 的解析结果与没有启动脚本时相同。

### Workspace 预览源

`PENGUIN_PREVIEW_ORIGIN` 与应用本身的源必须在**主机名**上不同，不能只是端口不同：Cookie 不区分端口，换个端口仍然共享同一个会话 Cookie。

- **本地使用：** 保持不设置。应用会规范化到 `localhost`，预览由 `127.0.0.1` 提供，不需要配置，也不需要 DNS。
- **局域网地址或正式域名：** 必须设置。否则预览会回退到同源沙箱，`localStorage`、Cookie 和第三方嵌入都无法工作。使用正式域名时，会话 Cookie 要保持 host-only（不设 `Domain=`），否则同级子域名会共享这个 Cookie。

值无法解析时，服务器会在启动时直接停止，而不是静默回退。

### 供应商凭证变量

模型条目没有内联 `api_key` 时，AgentHub 会回退到供应商的环境变量。`*_BASE_URL` 的值只在条目没有内联 `base_url` 时才会使用。

| 供应商 | API key | Base URL |
| --- | --- | --- |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| openai、openrouter、fireworks、siliconflow、tokendance、qwen-pay-as-you-go、qwen-token-plan、modelscope、vllm、custom | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| penguin-go | `PENGUIN_GO_API_KEY` | `PENGUIN_GO_BASE_URL` |
| minimax | `MINIMAX_API_KEY` | `MINIMAX_BASE_URL` |
| google | `GEMINI_API_KEY` | `GEMINI_BASE_URL` |
| zhipu | `ZAI_API_KEY` | `ZAI_BASE_URL` |
| moonshot | `MOONSHOT_API_KEY` | `MOONSHOT_BASE_URL` |

openrouter、fireworks、siliconflow、tokendance、qwen-pay-as-you-go、qwen-token-plan、vllm 和 custom 这几组供应商使用 OpenAI 兼容协议，因此共用 `OPENAI_*` 变量。ModelScope 也共用 `OPENAI_*`，因为它的分组凭据是 api-inference token，即使某条预置固定了模型专属协议也是如此。Penguin Go 中转分组单独使用一对自己的变量，应用因此不会为它推荐任何厂商凭证。MiniMax M3 的直连 Responses 客户端使用 `MINIMAX_*`，内置的 MiniMax 预设也已经固定为官方端点。供应商分组和内置模型目录见[模型与供应商](/models)。

## Project 配置

`<root>/<project>/.project_config.toml` 是 Project 唯一的配置文件：隐藏文件，以 0600 权限写入，凭证内联在模型条目上。模型的标识始终是 `(provider, model_id)` 这一对，绝不把字符串拼接成单个 id；指向这个文件的每处引用都同时带上两部分，也绝不会只凭 `model_id` 推断供应商。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | 字符串 | — | Project 显示名；未设置时显示 id |
| `default_model` | 成对引用 | — | 指向默认模型的 `{ provider, model_id }` 成对引用；必须指向 `models` 里的条目 |
| `vision_model` | 成对引用 | — | 为纯文本模型读取图像的视觉模型（`read_file` 会把图像交给它）；成对引用 |
| `[default_chat]` | 表 | — | 新对话的预填默认值；见[新对话默认值](#新对话默认值) |
| `[command_policy]` | 表 | 出厂规则集 | shell 命令的拒绝规则，先于审批模式生效；见[命令策略](#命令策略) |
| `[plugins]` | 表 | — | Project 要求的服务端插件；见[插件](#插件) |
| `[[models]]` | 表数组 | — | 可用的模型条目 |

### 模型条目

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `provider` | 字符串 | — | 供应商分组；与 `model_id` 一起构成条目的唯一键 |
| `model_id` | 字符串 | — | 上游请求 id，原样发给 AgentHub |
| `context_window` | 数字 | — | 上下文窗口大小 |
| `client_type` | 字符串 | 从 `model_id` 推断 | AgentHub 客户端协议 |
| `display_name` | 字符串 | 内置模型目录中的名称 | 显示名；与模型目录不同时才会持久化 |
| `vision` | 布尔 | `true` | 模型是否接受图像输入 |
| `max_tokens` | 数字 | Agent 的 `model.max_tokens` | 单个模型的最大输出 Token；设置后覆盖 Agent 的 `model.max_tokens` |
| `fast_mode` | 布尔 | 关闭 | 单个模型的快速模式（供应商收取溢价的快速服务档位） |
| `pricing` | 表 | — | 三档价格 `cache_read` / `cache_write` / `output`，以美元每百万 Token 计价（`unit = "usd_per_mtok"`）。这里记的始终是牌价 |
| `api_key` | 字符串 | 供应商的环境变量 | 内联凭证 |
| `base_url` | 字符串 | 部分模型目录条目有预设 | 自定义 base URL |
| `created_at` | 字符串 | — | `api_key` 的写入时间（ISO 8601）；由界面层维护的展示字段 |

字段说明：

- `client_type`：自定义端点使用通用协议客户端：`openai-responses`、`ant-messages` 或 `openai-chat`。Web 对话框能根据 base URL 识别用的是哪一种。0.4.2 之前的写法 `openai` 是 `openai-chat` 的废弃别名，读取时会规范化。
- `fast_mode`：只持久化 `true`。只有 AgentHub 客户端能支持快速模式的模型才会提供这个选项，其他模型会拒绝携带它的请求。见[模型](/models#快速模式)。
- `pricing`：这里记的是牌价。正在进行的促销不写入这个文件：服务端把它保存在 `web.db` 里，计算成本时再从牌价中扣除。见[价格与促销](/models#价格与促销)。
- `base_url`：内置模型目录为网关以及固定客户端的直连条目预设了这个字段，即 MiniMax M3 和 DeepSeek 的 `deepseek-flash`。
- `api_key`：为空时，AgentHub 回退到供应商的环境变量。

```toml
default_model = { provider = "deepseek", model_id = "deepseek-flash" }

[[models]]
provider = "deepseek"
model_id = "deepseek-flash"
context_window = 1000000
vision = true
client_type = "deepseek-v4"
base_url = "https://api.deepseek.com"
api_key = "sk-..."

[models.pricing]
unit = "usd_per_mtok"
cache_read = 0.005714
cache_write = 0.285714
output = 1.142857
```

`pricing.unit` 目前始终是 `usd_per_mtok`（美元每百万 Token）。三档价格对应 `token_usage` 的三个计数器。

通过 CLI（`penguin config model …`）或 Web App 的「模型库」页面编辑这个文件。

> [!WARNING]
> 服务运行期间不要手动编辑 `.project_config.toml`。模型无权读写这个文件。

### 新对话默认值

`[default_chat]` 块为 Web App 的新对话预填默认值，在 **Project 设置** 的 **默认值** 标签页管理。每个键都可选且相互独立；加载时发现无效的值会直接丢弃，不影响其他键。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `agent_id` | 字符串 | — | 新对话预选的 Agent；必须是已存在的 Agent |
| `workspace` | 字符串 | 临时 Workspace | 预填的 Workspace 目录 |
| `approval_mode` | 字符串 | `allow-all` | 预填的审批模式：`allow-all`、`deny-all`、`read-only` 或 `always-ask` |
| `thinking_level` | 字符串 | — | 回退思考等级（`low` / `medium` / `high` / `xhigh` / `max`），供配置里没有设置 `model.thinking_level` 的 Agent 使用 |

默认模型不在这个块里：它仍然是顶层的 `default_model`。

### 插件

`[plugins]` 表列出 Project 要求的[服务端插件](/skills#服务端插件)，在**插件市场**页面管理。每个键是一个包名，值是形如 Cargo `[dependencies]` 的要求：

```toml
[plugins]
"@prismshadow/penguin-plugin-sandbox-bwrap" = "*"
"@scope/name" = "1.2.3"
"@scope/other" = { version = "1.2" }
```

- `"*"` 表示部署发布的任意版本。版本字符串和 `{ version = "…" }` 形式会作为要求保留下来；目前加载只看包名。
- 服务器运行所有 Project 表的并集，因此任何一个 Project 要求的插件，都会为所有 Project 加载。
- 读取文件时，其他形式的条目会被丢弃，文件的其余部分照常加载。`plugins` 键不是表时，视为不要求任何插件。
- 空表照样写成空表，表示这个 Project 不要求任何插件。

## 命令策略

`[command_policy]` 块是 Project 为 shell 命令设下的护栏：一组在审批边界直接生效的拒绝规则。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | 布尔 | 启用 | 总开关；只以 `enabled = false` 的形式存储 |
| `[[command_policy.rules]]` | 表数组 | 出厂规则集 | 拒绝规则，按顺序匹配。存储为空列表表示没有规则；不存储列表则表示使用出厂规则集 |

每条规则包含以下键：

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | 字符串 | — | 在设置界面中标识这条规则 |
| `pattern` | 字符串 | — | JavaScript 正则表达式源码，与空白符归一化后的命令匹配 |
| `description` | 字符串 | — | 可选的描述 |
| `enabled` | 布尔 | 启用 | 单条规则的开关 |

```toml
[command_policy]
enabled = true

[[command_policy.rules]]
name = "rm-recursive-force"
pattern = "…" # seeded from the factory set
description = "rm with recursive + force flags in one command (rm -rf and friends)"

[[command_policy.rules]]
name = "no-force-push"
pattern = "git push [^;|&]*--force"
enabled = false
```

打开 Web App 的 **Project 设置**，在 **安全策略** 标签页管理这套策略。只有 Project 所有者能编辑；成员看到的是当前生效的策略。

### 生效方式

- **检查范围：** 两个会触达 shell 的工具：`exec_command` 的 `cmd`（启动的命令）和 `input_command` 的 `chars`（往运行中的命令键入的内容）。
- **生效时机：** `Session.run` 会用策略包住注入的审批回调，所以只要命中规则，在任何审批模式下（`allow-all` 也不例外）都会在询问宿主之前直接拒绝。
- **模型看到什么：** 一行固定的 `Tool call denied by policy.`，与人为取消不同，模型会据此改变做法。
- **钩子：** 策略的优先级高于 [pre-tool-use 钩子](/agent-loop#pre-tool-use-hook)的 `allow`。策略否决的调用，无论已安装的钩子给出什么答复，都保持禁止。
- **存放位置：** 策略存放在 Project 配置里，而不是 Agent State 里，所以 Agent 通过自身设置修改配置时碰不到它。
- **修改何时生效：** 策略属于严格层级的运行时参数，只在模型上下文开启时读取一次。改动要等运行中的 Session 下一次轮换（压缩）才生效，新对话则立即生效。

### 出厂规则

规则就是**普通数据，没有特殊层级**。出厂规则集会像模型预设一样预置到每个新建 Project 里：创建时复制一份，之后绝不重写。此后每条规则都能编辑、停用或删除，你也可以添加自己的规则。在预置机制上线之前创建的 Project（存储中没有 `rules` 列表）会按出厂规则集运作，直到第一次保存编辑、把列表写进去为止。设置页面上的 **恢复默认** 会把出厂规则集重新载入编辑器，保存后写回。

出厂规则集刻意保持精简，只覆盖那些原样执行就会造成破坏、且无法撤销的命令：

- 同时带递归和强制标志的 `rm`
- `mkfs`
- 直接向块设备写入的 `dd`
- 经典的 fork 炸弹
- 重定向到块设备的 shell 命令（`/dev/null` 这类仍然允许）

另有四条规则用 Windows 写法覆盖同样的场景，因为 `exec_command` 在 Windows 上可能解析为 pwsh 或 cmd：

- 递归强制删除（`Remove-Item -Recurse -Force`、`rd /s /q`）
- 卷格式化（`format C:`、`Format-Volume`）
- 裸盘覆写（`\\.\PhysicalDriveN`、`Clear-Disk`）
- cmd 版的 fork 炸弹

### 匹配规则

在规则运行之前，匹配逻辑会先归一化几种常见写法，避免直白的输入碰巧漏网。下面这些写法全部都能命中：

- 开头带路径（`/bin/rm`）
- 前面套了一层包装命令（`sudo`、`env`、`command`、`nice`、`xargs`）
- 命令词加了引号或反斜杠转义（`"rm"`、`r''m`、`\rm`）
- 原样传入的 `sh -c 'rm -rf /'`

归一化只删除引号。展开、替换、解码，一律不做。

### 策略不覆盖的范围

命令策略是一道**防误操作的护栏，不是安全边界**。这句话描述的是模式匹配能做到什么，不是对本实现的自谦。Shell 是一门编程语言，规则加得再多，也无法在程序运行前靠阅读它的文本来更准确地判断它会做什么。策略覆盖人和模型实际会敲出来的写法，到此为止：

- **运行时计算出来的命令不在覆盖范围内，以后也不会有。** 例如：用 `$IFS` 代替空格、变量或别名（`X=rm; $X -rf /`）、命令替换、`eval`、通过管道把 base64 送进 shell、`python -c`、经由管道调用的解释器。每一种都得配一条需要永久维护的模式，换来的只是「已覆盖」的假象。真想让命令跑起来的人，总有办法让它跑起来。
- **MCP 工具是另一个层面。** 策略只读 `exec_command` 和 `input_command`。MCP Server 自身的 `permission` 等级才是那个层面上的设置，但它只设定 Server 的工具向审批模式上报的等级，既不给 Server 加沙箱，也不限制工具运行时的行为（见[工具与审批](/tools)）。把 shell 文本匹配器扩展到任意 MCP 参数，只会给一个真正需要硬控制的层面再叠一道更弱的控制。
- **不在清单上的命令不覆盖。** `shred`、`wipefs`、`find -delete`、`git clean -xfd`、`chmod -R 000 /` 都匹配不到任何出厂规则。为你的 Project 在意的命令自行添加规则。
- **它不是文件系统权限。** 能写任意路径的工具仍然可以改写配置文件本身，改动在下一次轮换时生效。

这套策略确实换来的是：一条破坏性的单行命令，无论通过哪个触达 shell 的工具、写成 POSIX 还是 Windows 的形式、处于哪种审批模式，都不会因误操作而执行。这是一道减速带，而在不可逆的命令前面，减速带值得设置。至于真正的边界，也就是让进程无论执行什么都碰不到文件系统的其他部分，靠的是隔离机制（bubblewrap、dsh）。那是独立的另一层，这套策略补充它，而不是取代它。

## Agent 配置

`agent_state/system_config.yaml` 定义一个 Agent 的行为。文件是 YAML 格式，在 Web App 中编辑时，注释会保留。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `name` | — | Agent 显示名称；未设置时回退到 id |
| `description` | — | Agent 描述 |
| `version` | `1` | Agent State 版本（自然数），每次成功优化后递增 |
| `kernel_version` | 当前内核版本 | 配置基于哪一代内置默认值（日期字符串） |
| `system_prompt` | 内置模板 | 必填；唯一支持占位符替换的模板 |
| `max_turns` | `-1` | 每个 Task 的最大 LLM 轮数 |
| `model.max_tokens` | `32000` | 每次 Request 的输出 Token 上限 |
| `model.thinking_level` | `medium` | 每个模型上下文开启时使用的思考等级，除非 Session 钉住了等级 |
| `model.timeoutMs` | `300000` | 每次 Request 的**空闲**时间预算，单位毫秒 |
| `compaction.max_context_length` | `256000` | 触发压缩的上下文 Token 阈值 |
| `compaction.max_session_turns` | `-1` | Session 累计轮数阈值 |
| `compaction.mode` | `summarize` | `summarize` / `discard` |
| `compaction.prompt` | 内置模板 | summarize 模式压缩使用的提示词 |
| `memory.enabled` | `true` | 记忆是否进入上下文，以及是否准备记忆目录 |
| `memory.prompt` | 内置模板 | `{{MEMORY}}` 块中始终注入的那一半；包含 `{{USER_MEMORY_INDEX}}` |
| `memory.workspace_prompt` | 内置模板 | 仅在持久 Workspace 中追加；包含 `{{WORKSPACE_MEMORY_INDEX}}` 和 `{{WORKSPACE_MEMORY_DIR}}` |
| `vault.enabled` | `true` | 密钥保险柜小节是否进入上下文 |
| `vault.prompt` | 内置模板 | `{{VAULT}}` 块；包含 `{{VAULT_KEYS}}` |
| `skills.enabled` | `true` | 技能小节是否进入上下文 |
| `skills.prompt` | 内置模板 | `{{SKILLS}}` 块；包含 `{{SKILL_METADATA}}` |
| `schedules.enabled` | `true` | 定时任务小节是否进入上下文 |
| `schedules.prompt` | 内置模板 | `{{SCHEDULES}}` 块，讲解基于文件的任务管理；包含 `{{SCHEDULE_LIST}}` |
| `hooks.enabled` | `true` | 新 Session 是否在循环的钩子点运行已安装的钩子包 |
| `tools.builtin` | 省略时为完整默认工具集 | 工具条目；一旦写入，就整体替换默认列表 |
| `tools.mcpServers` | `[]` | MCP Server 配置（`name` + `config`） |

### 字段说明

- `kernel_version`：在创建时、还原为默认配置时以及内核更新时打上标记。它与 `version` 无关，也不会因你的编辑而改变。值缺失说明配置早于这套机制，视为过时。
- `max_turns`：`-1` 表示不限制；正整数则为单个 Task 的轮数上限。
- `model.max_tokens`：`-1` 表示不设上限（使用供应商默认值）。每次请求都会把实际生效值限制在「模型 `context_window` − 估算输入」以内，因此不会向窗口小的模型要求放不下的输出量。
- `model.thinking_level`：可选 `none` / `low` / `medium` / `high` / `xhigh` / `max`。思考等级在一个模型上下文内固定，修改要等下一次压缩才生效。没有此字段时，采用 Project `[default_chat]` 中的 `thinking_level`；若仍未设置，则为 `medium`。
- `model.timeoutMs`：等待下一个上游事件的最长时长，每收到一个事件就重新计时。它限制的不是请求总时长，而是两段等待：从建立连接到收到第一个事件，以及事件之间的空档。有的模型在思考阶段不向网络输出任何内容，整个思考期都落在第一段空档里，默认值已为这种情况留出余量。
- `compaction.max_context_length`：实际阈值取此值与「模型 `context_window` − 2048」中较小的一个。因此窗口小的模型会在自己的窗口内触发压缩；窗口超过 258048 的模型则按此数值触发。没有 `context_window` 的模型条目按 128000 窗口处理。
- `compaction.max_session_turns`：`-1` 表示不限制。
- `*.prompt`：各小节的提示词都能在对应的设置标签页编辑：两段记忆提示词在 **记忆**，`vault.prompt` 在 **密钥保险柜**，`skills.prompt` 在 **技能**，`schedules.prompt` 在 **定时任务**。
- `vault.enabled`：关闭时，值仍会注入子进程环境，只是模型看不到键名列表。
- `skills.enabled`：关闭时，已安装的 Skill 仍可通过 `[use_skills]` 显式调用。
- `schedules.enabled`：关闭时，服务端仍会触发任务，只是模型不再了解任务系统。
- `hooks.enabled`：唯一没有提示词的小节，因为钩子包是脚本，不是上下文文本。关闭时，钩子包仍保持安装，只是不再有任何环节调用它们。
- `tools.builtin`：每个条目包含 `name` / `description` / `parameters` / `permission`（`r` 或 `rw`）/ `forModel` / `timeoutMs` / `maxOutputLength` / `call_description`。`call_description` 是按工具控制调用参数 `description` 的开关；开启时调用必须带上这个参数；字段缺失则视为保留。
- `tools.mcpServers`：传输方式为 `stdio`、`http` 或 `sse`，发现的工具以 `mcp__<server>__<tool>` 的形式加入工具集。`config.permission`（`auto` / `r` / `rw`，默认 `auto`）为对应 Server 的所有工具固定审批等级，不再采信它们的 `readOnlyHint`。见 [MCP Server](/tools#mcp-server)。

四个 `compaction.*` 字段是本文件中唯一即时生效的部分，运行中的对话无需等待。引擎会在每个压缩检查点重新读取这一节（每次请求上报 Token 用量之后，以及手动执行 `/compact` 时），因此保存的修改对已在运行的 Session 同样生效。其余内容都在模型上下文开启时读取，修改要到下一次压缩才生效。在 Web App 里，你还可以在上下文面板中拖动条上的虚线切刀来[修改阈值](/chat#修改压缩阈值)。

工具权限与审批语义见[工具与审批](/tools)。

本文件**不与默认值做深度合并**。写出的键整体生效；只有省略的键，才会在用到时回退到上述默认值。`system_prompt` 必填，缺少此字段的文件无法加载，因此编辑其他字段时请保留完整生成的模板。下面是一个部分覆盖的示例，由 init 步骤生成的文件修改而来：

```yaml
name: default_agent
description: General-purpose agent
version: 3

# Required: keep the full generated default template ({{AGENTS_MD}} and friends; elided here).
system_prompt: |
  …

# -1 (the default) = unlimited; set a positive integer to cap the turns of a single Task.
max_turns: -1

model:
  max_tokens: 32000
  thinking_level: medium
  timeoutMs: 300000

compaction:
  max_context_length: 256000
  max_session_turns: -1
  mode: summarize

# Omitting the whole tools section = the full default toolset. Writing tools.builtin
# REPLACES the default list wholesale: carry the complete definition (including the
# parameters JSON Schema) for every tool you keep — see Tools & Approval.
```

### 内核更新

已有 Agent 始终按磁盘上的配置原样运行，新版代码的默认值绝不会自动合并进来。当内置默认值发生实质性变化时，配置的 `kernel_version` 会落后于当前内核，设置页面和智能体列表会显示更新提示。设置总览上有两个操作可以采纳当前默认值。

**更新内核**是一次无损合并，按设置标签页逐一进行（**系统提示词**、**运行参数**、**工具**、**技能**、**记忆**、**密钥保险柜**、**定时任务**）：

- 配置里完全没有的标签页，或者哈希仍与某一*已记录*代的内置默认值一致的标签页，会按当前默认值重写。之后版本新增的工具，也是通过这条途径进入已有 Agent 的。
- 只要你以任何方式改动过，标签页就会**完整**保持不变，并列入结果。哪怕只改了一个内置工具，整个**工具**标签页也会保留：你新增的工具和删除的工具都原样留存，这个标签页也不再跟随新默认值，直到你执行还原为默认配置。
- `name`、`description`、`version`、`hooks` 和 `tools.mcpServers` 不属于任何标签页，更新永远不会碰它们。
- 最后，配置会打上当前 `kernel_version` 的标记。
- 匹配是**保守**的：只有哈希与某一已记录代一致的标签页才算旧默认值。代太老、不在记录之内的标签页，会当作自定义内容保留。

**还原为默认配置**的工作方式类似 Skill 更新：用当前默认值覆盖配置，只保留 `name`、`description` 和 `version`。其余全部替换，包括自定义系统提示词、工具列表、模型与压缩设置，以及 MCP Server。当内核更新的保守匹配留下旧字段时，用它做一次彻底刷新。

面向开发者的说明：

- `kernel_version` 由人工推进，且只在内置默认值发生实质性变化时更新，取当天日期。同一天的多次改动可能复用同一天的版本。
- CI 中的固定哈希测试（`core/test/kernel-version.test.ts`）会重新计算每个标签页的哈希，并与 `kernel-history.ts` 里的 `KERNEL_DEFAULT_TAB_HASHES` 比对。发现偏差时测试失败，并列出每个变动的标签页及所需的修改：递增 `KERNEL_VERSION`，把这个标签页原先的哈希追加到 `KERNEL_SUPERSEDED_TAB_HASHES`，再写入重新计算出的哈希。
- 已淘汰的哈希永久冻结：判断一个标签页是否仍是旧默认值，靠的就是它们。

### 系统提示词占位符

`system_prompt` 是唯一支持占位符替换的模板。可用占位符如下：

| 占位符 | 注入内容 |
| --- | --- |
| `{{AGENTS_MD}}` | `AGENTS.md` 全文 |
| `{{VAULT}}` | 渲染后的 `vault.prompt` 块（密钥保险柜小节）；`vault.enabled` 关闭时为空 |
| `{{SKILLS}}` | 渲染后的 `skills.prompt` 块（技能小节）；`skills.enabled` 关闭时为空 |
| `{{MEMORY}}` | 渲染后的 `memory.prompt` 块，持久 Workspace 中还会加上 `memory.workspace_prompt`；记忆关闭时为空 |
| `{{SCHEDULES}}` | 渲染后的 `schedules.prompt` 块（定时任务小节）；`schedules.enabled` 关闭时为空 |
| `{{VAULT_KEYS}}` | 在 `vault.prompt` 内：密钥保险柜的密钥名称列表（只有名称，每个密钥一行 `- KEY`） |
| `{{SKILL_METADATA}}` | 在 `skills.prompt` 内：已安装 Skill 的元数据行 |
| `{{SCHEDULE_LIST}}` | 在 `schedules.prompt` 内：当前的任务名称列表（每个任务一行 `- name`；没有任务时显示空列表说明） |
| `{{USER_MEMORY_INDEX}}` | 在记忆提示词内：用户作用域的 `MEMORY.md` 索引（最多 200 行，总计不超过 25,000 字符） |
| `{{WORKSPACE_MEMORY_INDEX}}` | 仅在 `memory.workspace_prompt` 内：Workspace 作用域的 `MEMORY.md` 索引（最多 200 行，总计不超过 25,000 字符） |
| `{{WORKSPACE_MEMORY_DIR}}` | 仅在 `memory.workspace_prompt` 内：当前 Workspace 记忆目录的绝对路径 |
| `{{PLATFORM}}` | 运行平台 |
| `{{OS_VERSION}}` | 操作系统版本 |
| `{{DATE}}` | 当前日期 |
| `{{PROJECT_DIR}}` | App Data Dir：PenguinHarness 的应用数据根目录（即 Project 目录） |
| `{{AGENT_ID}}` | Agent id |
| `{{CWD}}` | Workspace 路径 |
| `{{PROVIDER}}` | 模型供应商分组 |
| `{{MODEL_ID}}` | 上游模型 id |
| `{{SESSION_ID}}` | Session id |

**小节占位符。** 密钥保险柜、技能、记忆、定时任务四个小节共用一套模式：一个占位符、一个开关、一段可编辑的提示词。模板里只保留 `{{VAULT}}` / `{{SKILLS}}` / `{{MEMORY}}` / `{{SCHEDULES}}` 占位符，小节文本放在对应的 `*.prompt` 键里（在设置标签页编辑），关闭 `*.enabled` 则整块为空。模板缺少其中某个占位符时，对应小节不会注入；相应的设置标签页会提供显式插入占位符或迁移旧版模板的操作。四个小节占位符在组装时最后展开，一趟完成。展开后的文本不会再次扫描，因此记忆索引或小节提示词里看起来像占位符的文本会按字面保留。

**App Data Dir。** `{{PROJECT_DIR}}` 会以 **App Data Dir** 的名义展示给模型：这是 PenguinHarness 的应用数据根目录，存放所有 Agent 的数据文件（`agents/<agent_id>/…`）和 Project 级数据。刻意不把它描述成 Project 或 Task 目录，避免模型误以为它是任务的工作目录（`CWD`）。

**Windows 路径。** 在 Windows 上，`{{PROJECT_DIR}}` 和 `{{CWD}}` 一律以正斜杠注入；core 为模型拼出的其他路径也是如此（附件行、目标模式的 goal 文件行、截断输出的恢复路径）。模型会把这种写法照搬进 JSON 工具参数和 shell 命令。Node 的 fs API 和包内工具所用的 Git Bash 都接受正斜杠，还能避开 JSON 反斜杠转义错误。

**AGENTS.md。** `agent_state/AGENTS.md` 是开发者可编辑的指令文件，通过 `{{AGENTS_MD}}` 注入，默认为空。它也是优化器编辑最多的文件；参见[自我进化](/self-improvement)。与 Agent State 的其余内容（包括 `system_config.yaml`）一样，它在每次模型上下文开启时读取：创建 Session 时读一次，压缩开启下一个上下文时再读一次。因此，修改会在运行中 Session 的下一次压缩时生效，而不只对新建 Session 生效，且绝不会影响正在运行的上下文。`compaction` 一节是例外；见[上下文压缩](/agent-loop)。

**旧版模板。** `system_config.yaml` 在创建 Agent 时写入，此后不会自动升级。在小节占位符出现之前创建的 Agent，模板里硬编码了 `# Vault` / `# Skills` 小节文本，并内联了 `{{VAULT_KEYS}}` / `{{SKILL_METADATA}}`。这类模板仍然可用：内联占位符照常替换，并遵守小节开关（开关关闭时替换为空字符串）。对应的设置标签页会提示旧版模板并提供一键迁移：把旧的默认小节文本原封不动地就地替换为新占位符，组装出的提示词保持不变。如果小节文本有过自定义，原样迁移便匹配不上，此时模板按缺少占位符处理，可在 `# Environment` 之前一键插入。

## 记忆

`agent_state/memory/` 保存 Agent 在多次 Session 之间记住的内容：用户反馈、项目决策、工作惯例、外部系统的入口，也就是无法从 Workspace 或它的代码历史中重新推导的内容。记忆不是上下文压缩，压缩保留的是单个 Session 的短期状态。

记忆分两个作用域。两者都只属于一个 Agent，绝不与其他 Agent 共享：

- **用户作用域**（`memory/user/`）：Agent 无论在哪里工作都成立的内容，比如用户是谁、长期偏好，以及不绑定某个代码库的参考资料。每个 Session 都会读取它，包括运行在临时 Workspace 里的 Session，因为这种 Session 没有别的地方可写。
- **Workspace 作用域**（`memory/<workspace_memory_key>/`）：关于某个 Workspace 的事实。同一 Agent 在同一 Workspace 中的 Session 共享这些内容；不同 Workspace 的主题文件彼此独立。

```text
agent_state/memory/
├── user/                         # user scope (no marker: it stands for no path)
│   ├── MEMORY.md                 # this scope's index
│   └── prefers-pnpm.md
└── my-app-a81f32c4/              # one Workspace
    ├── .workspace                # the Workspace path this key stands for
    ├── MEMORY.md
    └── testing-conventions.md
```

每个作用域都有自己的 `MEMORY.md` 索引，而且不同 Agent 绝不共享记忆，即使在同一个 Workspace 里也是如此。记忆存放在 Agent State 中，因此会随导出、导入和快照一起迁移。

> [!WARNING]
> 能访问这个 Agent 的所有 Project 成员都能读到它的记忆。不要把凭证和敏感的个人数据存进去。

要读取或删除记忆，或者让 Agent 来修改，使用 [Agent 设置](/agents)的 **记忆** 标签页。

### Workspace 记忆键

Workspace 记忆键的格式是 `<safe-basename>-<8 hex of the real path's sha256>`。

- `user` 是保留的目录名，这样做是安全的：生成的键都形如 `<base>-<8 hex>`，一定包含连字符。
- 标识就是目录本身，与 Git 无关。指向同一目录的两个符号链接解析出同一个键；移动或重命名目录会让它变成一个新 Workspace，旧记忆仍以旧键留在磁盘上。
- 临时 Workspace 由 PenguinHarness 分配在 `agents/<agent_id>/workspaces/` 下，完全没有 Workspace 作用域，子 Agent 继承时也不例外。临时 Workspace 按 Session 分配，之后不会再有 Session 在那里运行并读回内容。这种 Session 仍然会拿到用户作用域，它学到的东西本来也该存在那里。

### 主题文件

每个主题文件保存一个事实或主题，而不是每个 Task、Session 或日期一个文件，并带有 frontmatter：

```markdown
---
name: testing-conventions
description: the project's test environment and verification rules
updated_at: 2026-08-07
---

- Integration tests connect to a real database; no mock repositories.
```

frontmatter 就只有这三个字段。记忆属于哪个作用域由所在目录决定，因此没有 `type` 字段；早期文件里遗留的 `type:` 行会当作未知字段忽略。

默认的记忆提示词告诉模型保存哪些内容：

- 用户是谁、希望 Agent 怎么工作，以及背后的原因
- 从代码推导不出的目标、决策和约束
- 指向外部系统、文档和资源的指引

它还列出了会产生这类事实的时刻：同一个请求第二次出现、一条超出当前任务仍然成立的纠正、不止一次提到的习惯或做法，或者一个不记住就得再问的可复用工作细节。重复只会让事实更明显；长期偏好只要清楚地说过一次就够了。分不清某件事值不值得保存时，Agent 会在对话里直接询问。

提示词明确排除以下内容：

- 代码、配置或 Git 历史里已经写明的事实
- 未经验证的猜测
- 对话记录摘录（即使用户要求保存，Agent 也只保存其中非显然的部分）

用户想保存的其他内容都可以存。对于纠正和决策，模型会加上 **Why:** 和 **How to apply:** 两行。事后证明有误的记忆会连同索引行一起删除。日期一律写绝对日期（`YYYY-MM-DD`），因为相对日期对后续 Session 毫无意义。

### 注入方式

只有索引会进入上下文，通过模板中的 `{{MEMORY}}` 占位符注入。每个 `MEMORY.md` 每行列出本作用域的一条记忆，格式为 `- [Title](file.md) — hook`，链接相对于作用域目录。模型更新文件时同步更新索引，删除也不例外，两者始终保持一致。

`{{MEMORY}}` 展开为：

- `memory.prompt`：记忆的用途和保存方法，然后是一个 `## User memory` 小节，内含索引（`{{USER_MEMORY_INDEX}}`）。
- `memory.workspace_prompt`：仅当 Session 运行在持久 Workspace 中时存在，是一个包含 `{{WORKSPACE_MEMORY_INDEX}}` 的 `## Workspace memory` 小节。

这两段提示词都是 Agent 级配置，可在 **记忆** 标签页编辑，和模板其他小节一样按 Markdown 标题组织。`User Memory Dir` 一行是字面模板 `<app_data_dir>/agents/<agent_id>/agent_state/memory/user`，模型根据 Environment 小节自行解析。`Workspace Memory Dir` 一行则通过 `{{WORKSPACE_MEMORY_DIR}}` 直接渲染为解析后的路径，因为它的最后一段是 Workspace 记忆键，这是模型自己拼不出来的路径哈希。

限制：

- 索引为空时，会注入一条明确的「还没有保存任何内容」提示。
- 每个作用域的注入上限是 200 行（按惯例一条记忆一行），另外还有一个 25,000 字符的总量兜底上限，应对索引里出现几条超长行的情况。超过上限时，会附上一条截断说明，让模型自己去打开完整的 `MEMORY.md`。磁盘上的文件始终原样不动。
- 默认记忆提示词写明了行数上限，并要求索引行控制在约 150 字符以内，让模型在触及上限之前就把索引保持得很短。字符数兜底只存在于代码中。
- 模型按需读取主题正文。

这两段是各自独立的配置键，因为占位符替换不支持条件判断。临时 Workspace 绝不能收到 Workspace 小节（即它的目录行和选择作用域的规则），所以那一段在那里根本不会追加。Harness 只决定记忆存放在哪里，并把写入限制在这个范围内。判断什么值得保存、拆分主题、维护索引，这些都是模型的工作，用普通文件工具完成。

模板里没有 `{{MEMORY}}` 就不会注入任何记忆；在记忆功能发布之前创建的 Agent 就是例子。**记忆** 标签页会说明这一情况，并提供一个明确的一键操作：把占位符插入到 `# Environment` 之前，也就是默认模板中它所在的位置。任何内容都不会自动拼接进去。组装好的完整提示词记录在 `session_meta` 中。

## Vault

`agent_state/.vault.toml` 是 Agent 级的环境变量密钥保险柜：一个隐藏文件，以 0600 权限写入。

- 键名必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`（即 shell 环境变量的命名规则）。值的长度上限为 8,192 个字符。
- 值只注入工具子进程的环境。这些值绝不会进入模型上下文，也不会出现在 Trace 里。
- 系统提示词里只显示键名。模板中的 `{{VAULT}}` 占位符展开为 `vault.prompt`，其中带有 `{{VAULT_KEYS}}` 键名列表，可在 **密钥保险柜** 标签页编辑。`vault.enabled` 关闭时这一块为空：值仍会注入子进程，只是模型看不到键名。旧版模板里内联的 `{{VAULT_KEYS}}` 在同一个开关控制下仍会照常替换，标签页还提供一键迁移（参见[系统提示词占位符](#系统提示词占位符)）。
- 保存后的更改立即对新 Session 生效；正在运行的 Session 则在下一次压缩时生效，与其他 Agent State 的更改一样。无论在 Web App 里保存、通过 API 保存还是用 CLI 保存，行为都相同。
- 用 `penguin config vault set/list/remove` 管理，或在 **密钥保险柜** 标签页操作。

## 定时任务

每个文件 `agent_state/schedule/<name>.toml` 描述一个定时任务，按设定的周期向 Agent 发送预设 Prompt。文件名就是任务的标识。定时任务只在 Web 服务（服务器运行时）运行期间执行。可以在 Agent 设置的 **定时任务** 标签页或对话页面管理，见[定时任务](/schedules)。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `prompt` | 字符串 | 必填 | 每次触发时发送的 Prompt |
| `enabled` | 布尔 | `false` | 任务是否触发 |
| `start_at` | 日期时间（ISO 8601） | 必填 | 首次触发时间 |
| `period` | 字符串 | 省略表示一次性任务 | 执行周期，如 `30m` / `12h` / `7d`；最小 5 分钟 |
| `end_at` | 日期时间（ISO 8601） | — | 结束时间；必须晚于 `start_at` |
| `session_id` | 字符串 | — | 把任务绑定到一个已有 Session；与下面三个字段互斥 |
| `workspace` | 字符串 | — | 新建 Session 模式使用的 Workspace |
| `provider` / `model_id` | 字符串对 | Project 的默认模型 | 新建 Session 模式的成对模型引用 |

`provider` 和 `model_id` 要么都写，要么都不写。只写 `model_id` 的文件无效；两者都不写时使用 Project 的默认模型。

```toml
prompt = "Check yesterday's builds and summarize the failures"
enabled = true
start_at = 2026-08-01T09:00:00Z
period = "12h"
```

模板中的 `{{SCHEDULES}}` 占位符展开为 `schedules.prompt`。它教模型用自己的文件工具管理这些 TOML 文件：目录位置、字段规则、约 30 秒内自动生效，以及防止重复的规则。末尾通过 `{{SCHEDULE_LIST}}` 附上当前的任务名列表。这段提示词可在 **定时任务** 标签页编辑。`schedules.enabled` 关闭时这一块为空：服务器仍按计划触发任务，只是不再教模型这套任务系统。在这个机制出现之前创建的 Agent，模板里没有这个占位符，标签页提供一键插入。

## 设计原则

Agent 的行为完全由磁盘上可编辑的文件决定：Prompt、Skill 和配置都是数据，而不是代码。正因如此，Agent 才能改进 Agent：优化器编辑的正是你手动编辑的那些文件。参见[自我进化](/self-improvement)和 [CLI 参考](/cli)。
