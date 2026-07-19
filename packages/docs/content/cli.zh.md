---
title: CLI 参考
description: penguin 命令的子命令与选项完整参考。
---

CLI 由 npm 包 `@prismshadow/penguin-cli` 提供，命令为 `penguin`。不带子命令执行 `penguin` 时打印帮助；`-v, --version` 打印版本号。启动时自动加载工作目录下的 `.env`。

## 全局约定

- 模型引用：模型身份始终是 `(provider, model_id)` 二元组。`--model-id` 填上游模型 id，与 `--provider` 组成配对引用。`run` / `chat` 省略 `--provider` 时，仅当该 `--model-id` 在配置中全局唯一才会匹配，存在歧义则报错。
- 数据根目录：`--root <dir>` 覆盖数据根目录，优先级为 `--root` > 环境变量 `PENGUIN_HOME` > `~/.penguin/data`。

## penguin run

发送单条消息执行一个 Task，结束后退出；Task 被中止时以非零码退出，便于脚本 / CI 判断。

```bash
penguin run -m "总结当前目录的代码结构"
```

| 选项 | 说明 |
| --- | --- |
| `-m, --message <message>` | 必填，要发送的消息 |
| `--model-id <id>` | 指定模型，缺省使用 Project 默认模型 |
| `--provider <group>` | 模型所属 Provider 分组 |
| `--project-id <id>` | 指定 Project |
| `--agent-id <id>` | 指定 Agent |
| `--workspace <path>` | Workspace 目录，默认当前目录，必须已存在 |
| `--approve <mode>` | 审批模式，见下文 |

## penguin chat

交互式 REPL，每输入一行发起一个 Task。选项与 `run` 相同（除 `-m, --message` 外），另加：

| 选项 | 说明 |
| --- | --- |
| `--resume [sessionId]` | 恢复指定 Session；省略 id 时恢复该 Agent 最近的 Session |

使用 `--resume` 时，Workspace 与模型由原 Session 锁定，不可再用 `--workspace` / `--model-id` / `--provider` 覆盖。退出时会打印可直接复制的 `penguin chat --resume <sessionId>` 命令。

REPL 内命令：

| 输入 | 行为 |
| --- | --- |
| `/compact` | 主动压缩当前上下文 |
| `/exit`、`/quit` | 退出 |

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
penguin config model add --model-id deepseek-v4-pro --api-key sk-... --set-default
```

| 选项 | 说明 |
| --- | --- |
| `--model-id <id>` | 必填，上游模型 id |
| `--provider <group>` | Provider 分组，缺省时根据内置目录推断 |
| `--api-key <key>` | API Key，内联存入 Project 隐藏文件 `.project_config.toml` |
| `--base-url <url>` | 自定义接口地址 |
| `--context-window <n>` | 上下文窗口大小 |
| `--client-type <type>` | 客户端协议类型 |
| `--vision` / `--no-vision` | 标记是否支持视觉输入 |
| `--price-cache-read <n>` | 缓存读价格 |
| `--price-cache-write <n>` | 缓存写价格 |
| `--price-output <n>` | 输出价格 |
| `--set-default` | 同时设为默认模型 |

### model default / model vision / model list

```bash
penguin config model default --model-id <id> --provider <group>
penguin config model vision --model-id <id> --provider <group>
penguin config model list
```

- `model default` 设置 Project 默认模型；`model vision` 设置视觉代理模型。两者的 `--model-id` 与 `--provider` 均为必填，且引用必须已存在于模型列表。
- `model list` 列出已配置模型，默认模型以 `*` 标记。

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

相关文档：[配置参考](/configuration)、[模型与 Provider](/models)。
