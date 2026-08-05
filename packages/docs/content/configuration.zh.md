---
title: 配置参考
description: 环境变量、Project 配置、Agent 配置、Vault 与定时任务的完整字段参考。
---

PenguinHarness 的配置分三层：环境变量决定部署形态，Project 配置管理模型与凭证，Agent 配置定义单个 Agent 的行为。此外每个 Agent 还有 Vault（私有环境变量）与 Schedule（定时任务）两类状态文件。

## 环境变量

CLI 与服务端启动时会自动加载工作目录下的 `.env` 文件。

| 变量 | 说明 | 缺省值 |
| --- | --- | --- |
| `PENGUIN_HOME` | 数据根目录 | `~/.penguin/data` |
| `PORT` | Web 服务监听端口 | `7364` |
| `HOST` | Web 服务监听地址 | `127.0.0.1` |
| `PENGUIN_WEB_DB` | 服务端 SQLite 数据库路径 | `<root>/web.db` |
| `PENGUIN_WEB_DIST` | 前端静态资源目录 | npm 安装的服务端包回退到内置 web-dist |
| `PENGUIN_PREVIEW_ORIGIN` | 提供 Workspace HTML 预览的独立源，如 `https://preview.example.com` | 未设置，按请求推导回环对应名 |
| `PENGUIN_SEED_ADMIN_PASSWORD` | 固定内置管理员的种子初始密码（自动化测试 / e2e 使用） | 未设置，种子时随机生成 `penguin-<四位数字>` 并打印一次 |
| `PENGUIN_LANG` | CLI 语言（`en` / `zh`），用 `penguin config lang` 设置 | `en` |
| `PENGUIN_UPDATE_CHECK` | 设为 `off` 关闭 Web 应用的新版本检查（服务端唯一的对外网络请求） | 开启 |

这些变量配置的是 PenguinHarness 自身，因此 `PORT`、`HOST`、`PENGUIN_WEB_DIST` 以及内部使用的 `PENGUIN_CLI_ENTRY` **不会出现在 Agent 所执行命令的环境变量中**——否则 `exec_command` 启动的开发服务器会读到 `PORT`，去占用留给 PenguinHarness 的端口，而不是自己另选一个。宿主环境中的其余变量原样透传，但还有一处例外：`GIT_EDITOR`、`GIT_TERMINAL_PROMPT`、`TERM`、`NO_COLOR`、`PAGER`、`GIT_PAGER` 一律被固定值覆盖，以免命令因等待编辑器、凭证输入或分页器而挂起。Agent 的 [vault](#vault) 覆盖在宿主环境之上——在 vault 里设置 `PORT` 仍然可以送达命令——但覆盖不了这六个变量。

`PENGUIN_PREVIEW_ORIGIN` 必须与应用源在**主机名**上不同，只换端口不行：Cookie 不区分端口，换端口仍然共用会话 Cookie。本地使用不必配置——App 固定在规范主机 `localhost`，预览用 `127.0.0.1`，既不需要配置也不需要 DNS。经 LAN 地址或真实域名访问时才需要设置，否则那里的预览会回退到同源沙箱，`localStorage`、Cookie 与第三方 embed 都不可用。在真实域名上设置时，会话 Cookie 必须保持 host-only（不带 `Domain=`），否则同注册域下的兄弟子域会共享它。取值无法解析时启动即报错，不会静默回退。

### Provider 凭证环境变量

当模型条目未内联 `api_key` 时，AgentHub 网关按 Provider 回退读取对应环境变量；`*_BASE_URL` 变体同理覆盖 Base URL：

| Provider | API Key | Base URL |
| --- | --- | --- |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| openai、openrouter、fireworks、siliconflow、qwen-token-plan、qwen-pay-as-you-go、custom | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| google | `GEMINI_API_KEY` | `GEMINI_BASE_URL` |
| zhipu | `ZAI_API_KEY` | `ZAI_BASE_URL` |
| moonshot | `MOONSHOT_API_KEY` | `MOONSHOT_BASE_URL` |

openrouter、fireworks、siliconflow、qwen-token-plan、qwen-pay-as-you-go 与 custom 分组走 OpenAI 兼容协议，因此复用 `OPENAI_*` 变量。Provider 分组与内置模型目录见[模型与 Provider](/models)。

## Project 配置

`<root>/<project>/.project_config.toml` 是 Project 唯一的配置文件：隐藏文件，落盘权限 0600，凭证内联在模型条目上。模型身份始终是 `(provider, model_id)` 成对引用，禁止任何形式的字符串拼接；指向本文件的每一处引用都要带上两半，provider 绝不由裸 `model_id` 推断。

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
| `max_tokens` | 单模型最大输出 Token；设置后覆盖 Agent 的 `model.max_tokens`，缺省则继承 |
| `pricing` | 三档价格 `cache_read` / `cache_write` / `output`，单位 USD 每百万 Token（`unit = "usd_per_mtok"`） |
| `api_key` | 内联凭证；留空回退到 Provider 环境变量 |
| `base_url` | 自定义 Base URL；网关模型预置 |
| `created_at` | `api_key` 写入时间（ISO 8601，界面维护的展示字段） |

```toml
default_model = { provider = "deepseek", model_id = "deepseek-v4-flash" }

[[models]]
provider = "deepseek"
model_id = "deepseek-v4-flash"
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
| `max_turns` | `100` | 单个 Task 的最大 LLM 轮数（-1 不限制） |
| `model.max_tokens` | `32000` | 单次输出 Token 上限（-1 不设上限，用服务商默认） |
| `model.thinking_level` | `medium` | `none` / `low` / `medium` / `high` / `xhigh`；作为会话默认档位，可被逐轮 Task 参数覆盖 |
| `model.timeoutMs` | `120000` | 单次 Request 超时（毫秒） |
| `compaction.max_context_length` | `128000` | 触发压缩的上下文 Token 阈值 |
| `compaction.max_session_turns` | `-1` | Session 累计轮数阈值（`-1` 不限制） |
| `compaction.mode` | `summarize` | `summarize` / `discard` |
| `compaction.prompt` | 内置模板 | summarize 压缩使用的 Prompt |
| `memory.enabled` | `true` | Workspace 记忆是否进入上下文、是否为持久 Workspace 准备记忆目录 |
| `memory.prompt` | 内置模板 | `{{MEMORY}}` 区块：记忆使用说明，含 `{{MEMORY_DIR}}` / `{{MEMORY_AGENTS_MD}}` |
| `tools.builtin` | 缺省时为完整默认工具集 | 工具条目：`name` / `description` / `parameters` / `permission`（`r` 或 `rw`）/ `forModel` / `timeoutMs` / `maxOutputLength` / `call_description`（条目级开关：控制 `description` 调用参数，开启时为必填，缺省保留）；一旦写出即整体替换默认列表 |
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

既有 Agent 始终按其磁盘上的配置原样运行——更新后的代码默认值不会自动合并。要采用当前默认值（例如更新后的内置系统提示词），可使用设置页的**还原为默认配置**操作：与 Skill 更新同语义，会用当前默认值覆盖现有配置——自定义系统提示词、工具列表、模型/压缩参数与 MCP Server——仅保留 `name`、`description` 与 `version`。

### 系统提示词占位符

`system_prompt` 是唯一进行占位符替换的模板，可用占位符：

| 占位符 | 注入内容 |
| --- | --- |
| `{{AGENTS_MD}}` | `AGENTS.md` 的全文 |
| `{{VAULT_KEYS}}` | Vault 的键名列表（仅键名） |
| `{{SKILL_METADATA}}` | 已安装 Skill 的元数据 |
| `{{MEMORY}}` | 渲染后的 `memory.prompt` 区块；关闭记忆或使用临时 Workspace 时为空 |
| `{{PLATFORM}}` | 运行平台 |
| `{{OS_VERSION}}` | 操作系统版本 |
| `{{DATE}}` | 当前日期 |
| `{{PROJECT_DIR}}` | App Data Dir：PenguinHarness 应用数据根目录（即 Project 目录） |
| `{{AGENT_ID}}` | Agent id |
| `{{CWD}}` | Workspace 路径 |
| `{{PROVIDER}}` | 模型 provider 分组 |
| `{{MODEL_ID}}` | 上游模型 id |
| `{{SESSION_ID}}` | Session id |

`{{PROJECT_DIR}}` 在提示词中以 **App Data Dir** 名义暴露给模型：PenguinHarness 的应用数据根目录，存放全部 Agent 的数据文件（`agents/<agent_id>/…`）与 Project 级数据——特意不以 Project/任务目录的口径描述，避免模型将其误认为本次任务的工作目录（`CWD`）。

Windows 上注入的 `{{PROJECT_DIR}}` 与 `{{CWD}}` 统一使用正斜杠——与 core 产出的其他模型可见路径（附件行、Goal file 行、截断输出 recovery 路径）同一拼写。模型会把这些拼写原样带入 JSON 工具参数和 Shell 命令；正斜杠被 Node 的 fs API 与包内 (Git) Bash 工具 Shell 接受，也避免 JSON 反斜杠转义出错。

`agent_state/AGENTS.md` 是开发者可编辑的指令文件，经 `{{AGENTS_MD}}` 注入系统提示词，缺省为空——它也是优化器最常改动的文件（见[自我进化](/self-improvement)）。

## Workspace 记忆

`agent_state/memory/` 保存 Agent 跨 Session 的长期记忆：用户反馈、项目决策、协作约定与外部系统入口——这些无法从 Workspace 或代码历史可靠重新推导。它不是上下文压缩：压缩保存单个 Session 的短期工作状态。

记忆的作用域是 **Project + Agent + Workspace**。同一 Agent、同一 Workspace 的多个 Session 共享一份记忆；不同 Workspace 的主题文件相互隔离，但共用一份索引；不同 Agent 即使使用同一 Workspace 也各自维护。记忆位于 Agent State，因此随导出、导入与快照一同流转，Project 内有权访问该 Agent 的成员都能读到——所以只属于某个成员的隐私信息不应写入（也因此不提供 `user` 类型）。

```text
agent_state/memory/
├── AGENTS.md                     # 统一索引，按 workspace key 分组
└── my-app-a81f32c4/              # 单个 Workspace
    ├── .workspace                # 该 key 对应的 Workspace 路径
    ├── feedback_testing.md
    └── project_release.md
```

workspace key 为 `<安全 basename>-<真实路径 sha256 的 8 位十六进制>`。身份只由实际目录决定，与 Git 无关：指向同一目录的两个软链接得到同一 key；目录移动或重命名后视为新的 Workspace（旧记忆仍以旧 key 留在磁盘上）。PenguinHarness 自动创建的临时 Workspace（位于 `agents/<agent_id>/workspaces/` 下）不创建记忆目录，子 Agent 继承该临时 Workspace 时同样不创建。

主题文件按语义划分，不按 Task、Session 或日期划分，并带 frontmatter：

```markdown
---
name: Testing conventions
description: 项目的测试环境和验证规则
type: feedback
updated_at: 2026-07-30
---

- 集成测试必须连接真实数据库，不使用 mock repository。
```

`type` 取 `feedback`（用户明确给出、未来应持续遵守的反馈与偏好）、`project`（无法仅从代码推导的决策、约束与计划及其理由）或 `reference`（外部系统、文档与服务的稳定入口）。不应保存：可从代码、配置或 Git 历史直接获得的事实；短期任务进度与调试流水；凭据、Token 等敏感值；未经确认的推测；大段对话原文。

进入上下文的只有索引。创建 Session 时，Harness 确保当前 Workspace 的记忆目录存在、读取 `memory/AGENTS.md`，并把 Agent 的 `memory.prompt` 渲染进 `{{MEMORY}}`，其中 `{{MEMORY_DIR}}` 替换为该 Workspace 的目录、`{{MEMORY_AGENTS_MD}}` 替换为完整索引；主题正文由模型按需读取。Harness 只负责确定记忆位置并限制写入边界，判断什么值得保存、如何划分主题、如何维护索引都由模型用现有文件工具完成。

存量 Agent 不会自动迁移：其 `system_config.yaml` 既无 `memory` 段也无 `{{MEMORY}}` 占位符，因此不会注入任何内容。需要时可在设置页 Prompt 标签插入该占位符，或还原为默认配置。

查看与编辑 Agent 已保存的记忆，见 Web App 的[记忆中心](/web-app#记忆中心memory)。

## Vault

`agent_state/.vault.toml` 是 Agent 级的环境变量保险库：隐藏文件，落盘权限 0600。

- 键名须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`（shell 环境变量命名规则）；
- 值只注入工具子进程的环境变量，永远不进入模型上下文与 Trace；
- 系统提示词中经 `{{VAULT_KEYS}}` 只披露键名；
- 经 Web/API 保存会使该 Agent 已缓存的 Session 运行时失效：其任意 Session 的下一个任务会重新恢复（resume）并使用新值；进行中的任务保持其启动时的值（CLI 直接改文件对运行中的 server 则要等 Session 下次创建或恢复时生效）；
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
| `provider` / `model_id` | 否 | 新建 Session 模式的模型成对引用；要写就两个都写，只写 `model_id` 会被拒绝，两个都不写则使用 Project 默认模型 |

```toml
prompt = "检查昨日构建结果并汇总失败原因"
enabled = true
start_at = 2026-08-01T09:00:00Z
period = "12h"
```

## 设计原则

Agent 的行为完整地存放于磁盘上的可编辑文件——提示词、Skill、配置都是数据而非代码。正因如此，Agent 才能被 Agent 改进：优化器编辑的与你手工编辑的是同一批文件。参见[自我进化](/self-improvement)与 [CLI 参考](/cli)。
