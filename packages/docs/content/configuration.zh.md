---
title: 配置参考
description: 环境变量、Project 配置、Agent 配置、Vault 与定时任务的完整字段参考。
---

PenguinHarness 的配置分三层：环境变量决定部署形态，Project 配置管理模型与凭证，Agent 配置定义单个 Agent 的行为。此外每个 Agent 还有 Vault（私有环境变量）与 Schedule（定时任务）两类状态文件。

## 环境变量

CLI 与服务端启动时会自动加载工作目录下的 `.env` 文件。

| 变量 | 说明 | 缺省值 |
| --- | --- | --- |
| `PENGUIN_HOME` | 数据根目录 | `~/PenguinHarness` |
| `PORT` | Web 服务监听端口 | `7364` |
| `HOST` | Web 服务监听地址 | `127.0.0.1` |
| `PENGUIN_WEB_DB` | 服务端 SQLite 数据库路径 | `<root>/web.db` |
| `PENGUIN_WEB_DIST` | 前端静态资源目录 | npm 安装的服务端包回退到内置 web-dist |
| `PENGUIN_LANG` | CLI 语言（`en` / `zh`），用 `penguin config lang` 设置 | `en` |

### Provider 凭证环境变量

当模型条目未内联 `api_key` 时，AgentHub 网关按 Provider 回退读取对应环境变量；`*_BASE_URL` 变体同理覆盖 Base URL：

| Provider | API Key | Base URL |
| --- | --- | --- |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| openai、openrouter、siliconflow、custom | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| google | `GEMINI_API_KEY` | `GEMINI_BASE_URL` |
| zhipu | `ZAI_API_KEY` | `ZAI_BASE_URL` |
| moonshot | `MOONSHOT_API_KEY` | `MOONSHOT_BASE_URL` |

openrouter、siliconflow 与 custom 分组走 OpenAI 兼容协议，因此复用 `OPENAI_*` 变量。Provider 分组与内置模型目录见[模型与 Provider](/models)。

## Project 配置

`<root>/<project>/.project_config.toml` 是 Project 唯一的配置文件：隐藏文件，落盘权限 0600，凭证内联在模型条目上。模型身份始终是 `(provider, model_id)` 成对引用，禁止任何形式的字符串拼接。

| 字段 | 说明 |
| --- | --- |
| `name` | Project 展示名（缺省显示 id） |
| `default_model` | 缺省模型的成对引用 `{ provider, model_id }`，必须指向 `models` 中的条目 |
| `vision_model` | 代读图片的视觉模型（供纯文本模型的 `describe_image` 使用），成对引用 |
| `[[models]]` | 可用模型条目列表 |

模型条目（`[[models]]`）字段：

| 字段 | 说明 |
| --- | --- |
| `provider` | Provider 分组；与 `model_id` 共同构成条目唯一键 |
| `model_id` | 上游请求 id，原样发送给 AgentHub |
| `context_window` | 上下文窗口大小 |
| `client_type` | AgentHub 客户端协议；缺省由 `model_id` 推断，OpenAI 兼容的第三方模型应设为 `openai` |
| `display_name` | 展示名；仅在与内置目录不同时持久化 |
| `vision` | 是否支持图片输入；缺省视为支持 |
| `pricing` | 三档价格 `cache_read` / `cache_write` / `output`，单位 USD 每百万 Token（`unit = "usd_per_mtok"`） |
| `api_key` | 内联凭证；留空回退到 Provider 环境变量 |
| `base_url` | 自定义 Base URL；网关模型预置 |
| `created_at` | `api_key` 写入时间（ISO 8601，界面维护的展示字段） |

```toml
default_model = { provider = "deepseek", model_id = "deepseek-v4-pro" }

[[models]]
provider = "deepseek"
model_id = "deepseek-v4-pro"
context_window = 1000000
vision = false
api_key = "sk-..."

[models.pricing]
unit = "usd_per_mtok"
cache_read = 0.003571
cache_write = 0.428571
output = 0.857143
```

`pricing.unit` 目前固定为 `usd_per_mtok`（USD 每百万 Token）；三档对应 `token_usage` 的三个计数桶。

该文件通过 CLI `penguin config model …` 或 Web 的 Models 页面修改——服务运行期间不要手工编辑，模型本身则永远无权读写它。

## Agent 配置

`agent_state/system_config.yaml` 定义单个 Agent 的行为（YAML；经 Web UI 编辑时保留注释）：

| 字段 | 缺省值 | 说明 |
| --- | --- | --- |
| `name` | — | Agent 展示名（缺省回退到 id） |
| `description` | — | Agent 描述 |
| `version` | `1` | Agent State 版本号（自然数），每次成功优化自增 |
| `system_prompt` | 内置模板 | 必填；唯一进行占位符替换的模板 |
| `max_turns` | `100` | 单个 Task 的最大 LLM 轮数 |
| `model.max_tokens` | `32000` | 单次输出 Token 上限 |
| `model.thinking_level` | `medium` | `none` / `low` / `medium` / `high` / `xhigh` |
| `model.timeoutMs` | `120000` | 单次 Request 超时（毫秒） |
| `compaction.max_context_length` | `128000` | 触发压缩的上下文 Token 阈值 |
| `compaction.max_session_turns` | `-1` | Session 累计轮数阈值（`-1` 不限制） |
| `compaction.mode` | `summarize` | `summarize` / `discard` |
| `compaction.prompt` | 内置模板 | summarize 压缩使用的 Prompt |
| `tools.builtin` | 缺省时为完整默认工具集 | 工具条目：`name` / `description` / `parameters` / `permission`（`r` 或 `rw`）/ `forModel` / `timeoutMs` / `maxOutputLength`；一旦写出即整体替换默认列表 |
| `tools.mcpServers` | `[]` | MCP Server 配置（`name` + `config`），预留给 MCP 适配层 |

工具权限与审批语义见[工具与审批](/tools)。

局部调整示例（在初始化生成的文件基础上修改）。注意本文件**不与默认值做 deep merge**：写出的字段整体生效，省略的字段才在使用处回退表中缺省值；`system_prompt` 是必填字段（缺失会拒绝加载），编辑其他字段时应保留初始化写入的完整模板：

```yaml
name: default_agent
description: General-purpose agent
version: 3

# 必填:保留初始化生成的完整默认模板(含 {{AGENTS_MD}} 等占位符,此处从略)。
system_prompt: |
  …

max_turns: 100

model:
  max_tokens: 32000
  thinking_level: medium
  timeoutMs: 120000

compaction:
  max_context_length: 128000
  max_session_turns: -1
  mode: summarize

# tools 整段省略 = 使用完整默认工具集。一旦写出 tools.builtin,将**整体替换**
# 默认列表:必须为每个要保留的工具携带完整定义(含 parameters JSON Schema),
# 参见「工具与审批」页。
```

### 系统提示词占位符

`system_prompt` 是唯一进行占位符替换的模板，可用占位符：

| 占位符 | 注入内容 |
| --- | --- |
| `{{AGENTS_MD}}` | `AGENTS.md` 的全文 |
| `{{VAULT_KEYS}}` | Vault 的键名列表（仅键名） |
| `{{SKILL_METADATA}}` | 已安装 Skill 的元数据 |
| `{{PLATFORM}}` | 运行平台 |
| `{{OS_VERSION}}` | 操作系统版本 |
| `{{DATE}}` | 当前日期 |
| `{{CWD}}` | Workspace 路径 |
| `{{AGENT_ID}}` | Agent id |
| `{{PROJECT_DIR}}` | Project 目录 |
| `{{SESSION_ID}}` | Session id |

`agent_state/AGENTS.md` 是开发者可编辑的指令文件，经 `{{AGENTS_MD}}` 注入系统提示词，缺省为空——它也是优化器最常改动的文件（见[自我进化](/self-improvement)）。

## Vault

`agent_state/.vault.toml` 是 Agent 级的环境变量保险库：隐藏文件，落盘权限 0600。

- 键名须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`（shell 环境变量命名规则）；
- 值只注入工具子进程的环境变量，永远不进入模型上下文与 Trace；
- 系统提示词中经 `{{VAULT_KEYS}}` 只披露键名；
- 通过 CLI `penguin config vault set/list/remove` 或 Web 的 Vault 标签页管理。

## 定时任务

`agent_state/schedule/<name>.toml` 每个文件描述一个定时任务（文件名即任务标识），按节律向 Agent 发送预设 Prompt。定时任务仅在 Web 服务（server 运行时）运行期间执行，在 Web 的 Agent 设置 → Schedule 标签页管理。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 触发时发送的 Prompt |
| `enabled` | 否 | 是否启用，缺省 `false` |
| `start_at` | 是 | 首次触发时刻（ISO 8601） |
| `period` | 否 | 周期，形如 `30m` / `12h` / `7d`，下限 5 分钟；缺省为一次性任务 |
| `end_at` | 否 | 结束时刻，须晚于 `start_at` |
| `session_id` | 否 | 绑定既有 Session；与下列三项互斥 |
| `workspace` | 否 | 新建 Session 模式的 Workspace |
| `provider` / `model_id` | 否 | 新建 Session 模式的模型成对引用 |

```toml
prompt = "检查昨日构建结果并汇总失败原因"
enabled = true
start_at = 2026-08-01T09:00:00Z
period = "12h"
```

## 设计原则

Agent 的行为完整地存放于磁盘上的可编辑文件——提示词、Skill、配置都是数据而非代码。正因如此，Agent 才能被 Agent 改进：优化器编辑的与你手工编辑的是同一批文件。参见[自我进化](/self-improvement)与 [CLI 参考](/cli)。
