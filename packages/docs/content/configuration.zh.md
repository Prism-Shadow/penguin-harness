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
| `PENGUIN_NO_LOGIN_SHELL_ENV` | 任意非空值可禁止桌面版在 macOS/Linux 图形界面启动时导入登录 shell 环境变量（见[桌面版速上手](/quickstart-desktop)） | 未设置，导入开启，且只补启动环境中缺失的变量 |

这些变量配置的是 PenguinHarness 自身，因此 `PORT`、`HOST`、`PENGUIN_WEB_DIST` 以及内部使用的 `PENGUIN_CLI_ENTRY` **不会出现在 Agent 所执行命令的环境变量中**——否则 `exec_command` 启动的开发服务器会读到 `PORT`，去占用留给 PenguinHarness 的端口，而不是自己另选一个。宿主环境中的其余变量原样透传，但还有一处例外：`GIT_EDITOR`、`GIT_TERMINAL_PROMPT`、`TERM`、`NO_COLOR`、`PAGER`、`GIT_PAGER` 一律被固定值覆盖，以免命令因等待编辑器、凭证输入或分页器而挂起。Agent 的 [vault](#vault) 覆盖在宿主环境之上——在 vault 里设置 `PORT` 仍然可以送达命令——但覆盖不了这六个变量。

`PENGUIN_PREVIEW_ORIGIN` 必须与应用源在**主机名**上不同，只换端口不行：Cookie 不区分端口，换端口仍然共用会话 Cookie。本地使用不必配置——App 固定在规范主机 `localhost`，预览用 `127.0.0.1`，既不需要配置也不需要 DNS。经 LAN 地址或真实域名访问时才需要设置，否则那里的预览会回退到同源沙箱，`localStorage`、Cookie 与第三方 embed 都不可用。在真实域名上设置时，会话 Cookie 必须保持 host-only（不带 `Domain=`），否则同注册域下的兄弟子域会共享它。取值无法解析时启动即报错，不会静默回退。

### Provider 凭证环境变量

当模型条目未内联 `api_key` 时，AgentHub 按 Provider 回退读取对应环境变量；仅当条目未内联 `base_url` 时才使用 `*_BASE_URL`：

| Provider | API Key | Base URL |
| --- | --- | --- |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| openai、openrouter、fireworks、siliconflow、qwen-token-plan、qwen-pay-as-you-go、custom | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| minimax | `MINIMAX_API_KEY` | `MINIMAX_BASE_URL` |
| google | `GEMINI_API_KEY` | `GEMINI_BASE_URL` |
| zhipu | `ZAI_API_KEY` | `ZAI_BASE_URL` |
| moonshot | `MOONSHOT_API_KEY` | `MOONSHOT_BASE_URL` |

openrouter、fireworks、siliconflow、qwen-token-plan、qwen-pay-as-you-go 与 custom 分组走 OpenAI 兼容协议，因此复用 `OPENAI_*` 变量。直连 MiniMax M3 Responses 客户端使用 `MINIMAX_*`；内置 MiniMax 预设已固定官方端点。Provider 分组与内置模型目录见[模型与 Provider](/models)。

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
| `client_type` | AgentHub 客户端协议；缺省由 `model_id` 推断。自定义端点使用通用协议客户端 `openai-responses` / `ant-messages` / `openai-chat`(Web 对话框可按 base URL 检测其中哪一种；0.4.2 之前的旧写法 `openai` 为 `openai-chat` 的已废弃别名，读取时归一化) |
| `display_name` | 展示名；仅在与内置目录不同时持久化 |
| `vision` | 是否支持图片输入；缺省视为支持 |
| `max_tokens` | 单模型最大输出 Token；设置后覆盖 Agent 的 `model.max_tokens`，缺省则继承 |
| `fast_mode` | 单模型快速模式（厂商的溢价快速推理档位）；默认关闭，只持久化 `true`。只对 AgentHub client 支持该档位的模型开放，其余模型会拒绝携带该参数的请求——见[模型与 Provider](/models#快速模式) |
| `pricing` | 三档价格 `cache_read` / `cache_write` / `output`，单位 USD 每百万 Token（`unit = "usd_per_mtok"`） |
| `api_key` | 内联凭证；留空回退到 Provider 环境变量 |
| `base_url` | 自定义 Base URL；内置目录会为网关与直连 MiniMax 模型预置 |
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
| `kernel_version` | 当前内核版本 | 配置内核版本（日期字符串）：记录该配置基于哪一代内置默认，创建、还原默认与更新内核时盖章；与 `version` 无关，用户编辑不改变它，缺失视为早于内核版本机制（即过期） |
| `system_prompt` | 内置模板 | 必填；唯一进行占位符替换的模板 |
| `max_turns` | `-1` | 单个 Task 的最大 LLM 轮数（`-1` 不限制，正整数为上限） |
| `model.max_tokens` | `32000` | 单次输出 Token 天花板（-1 不设上限，用服务商默认）；每次请求会把实际值收敛到模型 `context_window` 减估算输入以内，小窗口模型不会被索要放不下的输出 |
| `model.thinking_level` | `medium` | `none` / `low` / `medium` / `high` / `xhigh` / `max`；作为会话默认档位，可被逐轮 Task 参数覆盖 |
| `model.timeoutMs` | `120000` | 单次 Request 超时（毫秒） |
| `compaction.max_context_length` | `256000` | 触发压缩的上下文 Token 阈值；生效阈值取它与模型 `context_window` − 2048 中的较小者，故小窗口模型在自己的窗口内压缩，窗口大于 258048 时则在该数值处触发（条目未配置 `context_window` 时按 128000 的假定窗口计） |
| `compaction.max_session_turns` | `-1` | Session 累计轮数阈值（`-1` 不限制） |
| `compaction.mode` | `summarize` | `summarize` / `discard` |
| `compaction.prompt` | 内置模板 | summarize 压缩使用的 Prompt |
| `memory.enabled` | `true` | 记忆是否进入上下文、是否为持久 Workspace 准备记忆目录 |
| `memory.prompt` | 内置模板 | `{{MEMORY}}` 区块中恒注入的一半，可在记忆标签页编辑——含 `{{USER_MEMORY_INDEX}}` |
| `memory.workspace_prompt` | 内置模板 | 仅持久 Workspace 追加，可在记忆标签页编辑——含 `{{WORKSPACE_MEMORY_INDEX}}` 与 `{{WORKSPACE_MEMORY_DIR}}` |
| `vault.enabled` | `true` | 保险柜小节是否进入上下文（关闭后值仍注入子进程环境，只是模型看不到键名清单） |
| `vault.prompt` | 内置模板 | `{{VAULT}}` 区块内容，可在 Vault 标签页编辑——含 `{{VAULT_KEYS}}` |
| `skills.enabled` | `true` | 技能小节是否进入上下文（关闭后已装技能仍可被 `[use_skills]` 显式调用） |
| `skills.prompt` | 内置模板 | `{{SKILLS}}` 区块内容，可在技能标签页编辑——含 `{{SKILL_METADATA}}` |
| `schedules.enabled` | `true` | 定时任务小节是否进入上下文（关闭后 server 照常触发任务，只是模型不了解任务体系） |
| `schedules.prompt` | 内置模板 | `{{SCHEDULES}}` 区块内容，可在定时任务标签页编辑——教模型用文件工具管理任务，含 `{{SCHEDULE_LIST}}` |
| `tools.builtin` | 缺省时为完整默认工具集 | 工具条目：`name` / `description` / `parameters` / `permission`（`r` 或 `rw`）/ `forModel` / `timeoutMs` / `maxOutputLength` / `call_description`（条目级开关：控制 `description` 调用参数，开启时为必填，缺省保留）；一旦写出即整体替换默认列表 |
| `tools.mcpServers` | `[]` | MCP Server 配置（`name` + `config`）：transport 取 `stdio` / `http` / `sse`，工具以 `mcp__<server>__<tool>` 并入工具集；`config.permission`（`auto` / `r` / `rw`，缺省 `auto`）固定该 Server 全部工具的审批等级，不再采信其 `readOnlyHint`；详见[工具与审批](/tools)的 MCP Server 一节 |

工具权限与审批语义见[工具与审批](/tools)。

局部调整示例（在初始化生成的文件基础上修改）。注意本文件**不与默认值做 deep merge**：写出的字段整体生效，省略的字段才在使用处回退表中缺省值；`system_prompt` 是必填字段（缺失会拒绝加载），编辑其他字段时应保留初始化写入的完整模板：

```yaml
name: default_agent
description: General-purpose agent
version: 3

# 必填:保留初始化生成的完整默认模板(含 {{AGENTS_MD}} 等占位符,此处从略)。
system_prompt: |
  …

# -1(缺省)不限制轮数;设为正整数则限制单个 Task 的轮数。
max_turns: -1

model:
  max_tokens: 32000
  thinking_level: medium
  timeoutMs: 120000

compaction:
  max_context_length: 256000
  max_session_turns: -1
  mode: summarize

# tools 整段省略 = 使用完整默认工具集。一旦写出 tools.builtin,将**整体替换**
# 默认列表:必须为每个要保留的工具携带完整定义(含 parameters JSON Schema),
# 参见「工具与审批」页。
```

既有 Agent 始终按其磁盘上的配置原样运行——更新后的代码默认值不会自动合并。内置默认发生实质变化时，配置的 `kernel_version` 落后于当前内核版本，详情页与智能体列表会给出更新提示。采用当前默认值有两条路径（同在设置页概览、相邻放置）：

- **更新内核**：无损合并。逐字段比对：字段缺失、或仍等于某一代已记录的内置默认，跟进当前默认；被用户改过的保持不变并在结果中列出。`tools.builtin` 按工具名逐个比对——只保留改过的那一个，其余照常跟进，用户自加的条目不受影响；`name`、`description`、`version` 与 `tools.mcpServers` 永不触碰。完成后盖章 `kernel_version`。比对是**保守**的：只有哈希命中已记录代际的值才被视为旧默认，太老而无法识别的代际一律按自定义保留。
- **还原为默认配置**：与 Skill 更新同语义，用当前默认值覆盖现有配置——自定义系统提示词、工具列表、模型/压缩参数与 MCP Server——仅保留 `name`、`description` 与 `version`。更新内核因保守保留而没跟上时，这是全量刷新的兜底。

面向开发者：`kernel_version` 只在对内置默认做出实质修改时手动前进（取当日日期）。CI 的 pinned-hash 测试（`core/test/kernel-version.test.ts`）重算全部默认字段哈希并与 `kernel-history.ts` 最新条目比对，不一致即失败并提示更新 `KERNEL_VERSION`、追加新条目；同日多次变更可修订当日条目，历史条目一经冻结不再改动——它们就是「仍是旧默认」的识别依据。

### 系统提示词占位符

`system_prompt` 是唯一进行占位符替换的模板，可用占位符：

| 占位符 | 注入内容 |
| --- | --- |
| `{{AGENTS_MD}}` | `AGENTS.md` 的全文 |
| `{{VAULT}}` | 渲染后的 `vault.prompt` 区块（保险柜小节）；`vault.enabled` 关闭时为空。模板没有它就不注入该小节——Vault 标签页提供显式插入/迁移 |
| `{{SKILLS}}` | 渲染后的 `skills.prompt` 区块（技能小节）；`skills.enabled` 关闭时为空。模板没有它就不注入该小节——技能标签页提供显式插入/迁移 |
| `{{MEMORY}}` | 渲染后的 `memory.prompt` 区块，持久 Workspace 下再追加 `memory.workspace_prompt`；关闭记忆时为空。模板没有它就不注入记忆——记忆标签页提供显式插入 |
| `{{SCHEDULES}}` | 渲染后的 `schedules.prompt` 区块（定时任务小节）；`schedules.enabled` 关闭时为空。模板没有它就不注入该小节——定时任务标签页提供显式插入 |
| `{{VAULT_KEYS}}` | `vault.prompt` 内：Vault 的键名列表（仅键名，每键一行 `- KEY`）。为兼容旧模板，直接写在模板正文中的该占位符仍会被替换，并同样受 `vault.enabled` 控制 |
| `{{SKILL_METADATA}}` | `skills.prompt` 内：已安装 Skill 的元数据行。为兼容旧模板，直接写在模板正文中的该占位符仍会被替换，并同样受 `skills.enabled` 控制 |
| `{{SCHEDULE_LIST}}` | `schedules.prompt` 内：现有定时任务名列表（每任务一行 `- name`；无任务时为空清单说明） |
| `{{USER_MEMORY_INDEX}}` | 记忆提示词内：用户作用域 `MEMORY.md` 索引的内容（最多注入 200 行、总计 25000 字符） |
| `{{WORKSPACE_MEMORY_INDEX}}` | 仅 `memory.workspace_prompt` 内：Workspace 作用域 `MEMORY.md` 索引的内容（最多注入 200 行、总计 25000 字符） |
| `{{WORKSPACE_MEMORY_DIR}}` | 仅 `memory.workspace_prompt` 内：当前 Workspace 记忆目录的绝对路径 |
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

Vault / 技能 / 记忆 / 定时任务四个小节均采用「段落占位符 + 开关 + 可编辑提示词」模式：模板只保留 `{{VAULT}}` / `{{SKILLS}}` / `{{MEMORY}}` / `{{SCHEDULES}}` 占位符，小节文本存于各自的 `*.prompt` 配置、在对应设置标签页编辑，`*.enabled` 关闭即整段为空。四个段落占位符在装配时**最后单趟展开**：展开产物不再被扫描，因此记忆索引或提示词正文里出现的占位符字样只会保持字面原样，不会引发二次替换。

**旧模板兼容**：`system_config.yaml` 在 Agent 创建时物化、从不自动升级，早于本机制创建的 Agent 模板中是硬编码的 `# Vault` / `# Skills` 段落文字加内联 `{{VAULT_KEYS}}` / `{{SKILL_METADATA}}`。这类模板继续工作：内联占位符仍被替换，且同样受新开关控制（关闭时替换为空串）。对应标签页会提示「旧版模板」并提供一键迁移——把旧默认段落逐字原位替换为新占位符，装配结果不变；自定义改动过段落文字的模板不匹配逐字迁移，则按缺占位符处理、提供一键插入（插到 `# Environment` 之前）。

## 记忆

`agent_state/memory/` 保存 Agent 跨 Session 的长期记忆：用户反馈、项目决策、协作约定与外部系统入口——这些无法从 Workspace 或代码历史可靠重新推导。它不是上下文压缩：压缩保存单个 Session 的短期工作状态。

记忆有两个作用域，都归属于单个 Agent，绝不跨 Agent 共享：

- **用户作用域**（`memory/user/`）——无论在哪工作都成立的内容：用户是谁、其长期偏好、与具体代码库无关的参考。每个 Session 都会读到，包括运行在临时 Workspace 中的会话——那种会话没有别处可写。
- **Workspace 作用域**（`memory/<workspace_memory_key>/`）——关于某一个 Workspace 的事实。同一 Agent、同一 Workspace 的多个 Session 共享；不同 Workspace 的主题文件相互隔离。

每个作用域各带一份 `MEMORY.md` 索引；不同 Agent 即使使用同一 Workspace 也各自维护。记忆位于 Agent State，因此随导出、导入与快照一同流转，Project 内有权访问该 Agent 的成员都能读到——所以凭据与敏感个人信息绝不应写入。

```text
agent_state/memory/
├── user/                         # 用户作用域（无 marker：它不对应任何路径）
│   ├── MEMORY.md                 # 本作用域索引
│   └── prefers-pnpm.md
└── my-app-a81f32c4/              # 单个 Workspace
    ├── .workspace                # 该 key 对应的 Workspace 路径
    ├── MEMORY.md
    └── testing-conventions.md
```

`user` 是保留目录名。之所以安全：生成的 workspace memory key 一律是 `<base>-<8 位十六进制>`，必然含连字符——不含连字符的名字永远不会被生成出来。

workspace memory key 为 `<安全 basename>-<真实路径 sha256 的 8 位十六进制>`。身份只由实际目录决定，与 Git 无关：指向同一目录的两个软链接得到同一 key；目录移动或重命名后视为新的 Workspace（旧记忆仍以旧 key 留在磁盘上）。PenguinHarness 自动创建的临时 Workspace（位于 `agents/<agent_id>/workspaces/` 下）没有 Workspace 作用域，子 Agent 继承该临时 Workspace 时同样没有：临时 Workspace 是每个 Session 分配一个，之后不会有任何 Session 再跑进去读它。这类会话仍然拥有用户作用域——它能学到的东西本来也属于那一层。

主题文件按语义划分，不按 Task、Session 或日期划分，并带 frontmatter：

```markdown
---
name: testing-conventions
description: 项目的测试环境和验证规则
updated_at: 2026-08-07
---

- 集成测试必须连接真实数据库，不使用 mock repository。
```

frontmatter 只有这三个字段——记忆属于哪一层由所在目录表达，不设 `type` 字段（早期文件里残留的 `type:` 行会被当作未知字段忽略）。值得保存的是：用户是谁（角色、专长、长期偏好）以及希望 agent 如何工作（连同原因）；无法仅从代码推导的决策、约束与计划；外部系统、文档与服务的稳定入口。记错的主题连同其索引行一并删除；日期写绝对日期（`YYYY-MM-DD`），相对日期对后续 Session 没有意义。不应保存：可从代码、配置或 Git 历史直接获得的事实；短期任务进度与调试流水；凭据、Token 等敏感值；未经确认的推测；大段对话原文。

每份 `MEMORY.md` 一行列一条记忆——`- [标题](file.md) — 一句钩子`，链接相对本作用域目录——并与记忆文件同轮更新，两者永不脱节。

进入上下文的只有索引，入口是模板的 `{{MEMORY}}` 占位符。它展开为 `memory.prompt`——记忆的用途、写入规范，以及 `## User memory` 小节与其索引（`{{USER_MEMORY_INDEX}}`）——持久 Workspace 的会话再追加 `memory.workspace_prompt`（`## Workspace memory` 小节，含 `{{WORKSPACE_MEMORY_INDEX}}`）。两个提示词都是 Agent 级配置，可在设置页记忆标签直接编辑；区块和模板其他小节一样用 Markdown 标题组织。`User Memory Dir` 行是字面模式 `<app_data_dir>/agents/<agent_id>/agent_state/memory/user`，模型可据 Environment 段自行拼出；`Workspace Memory Dir` 行经 `{{WORKSPACE_MEMORY_DIR}}` 直接渲染为解析后的路径——它的末段（工作区记忆键）是路径哈希，模型无从自行推得。

空索引会注入一句"尚未保存任何内容"的占位说明。每个作用域最多注入 200 行索引（按约定每条记忆一行），再以总计 25000 字符兜底——防住行数不多但单行超长的索引；超出上限的部分以截断提示替代、由模型自行读取完整 `MEMORY.md`，磁盘上的文件不受影响。默认记忆提示词只声明行数上限，并要求每行索引保持在约 150 字符以内，模型在撞线之前就会把索引保持在限内；字符兜底仅存在于代码中。主题正文由模型按需读取。

两半之所以是两个独立配置键：替换引擎没有条件分支，临时 Workspace 绝不能被塞进 Workspace 小节（它的目录行和作用域二选一规则），所以那一半在临时 Workspace 下干脆不追加。Harness 只负责确定记忆位置并限制写入边界，判断什么值得保存、如何划分主题、如何维护索引都由模型用现有文件工具完成。

模板中没有 `{{MEMORY}}` 的 Agent（例如创建于记忆功能之前）不会注入任何内容；记忆标签页会给出提示并提供一键插入占位符（插到 `# Environment` 之前，即默认模板中的位置）——不存在任何自动拼接。组装后的完整提示词记录在 `session_meta`。

查看、删除或让 Agent 修改已保存的记忆，见设置页的[记忆标签](/web-app#agent-设置agents)。

## Vault

`agent_state/.vault.toml` 是 Agent 级的环境变量保险库：隐藏文件，落盘权限 0600。

- 键名须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`（shell 环境变量命名规则）；
- 值只注入工具子进程的环境变量，永远不进入模型上下文与 Trace；
- 系统提示词中只披露键名：模板的 `{{VAULT}}` 占位符展开为 `vault.prompt`（内含 `{{VAULT_KEYS}}` 键名列表），提示词可在 Vault 标签页编辑；`vault.enabled` 关闭则整段为空——值照旧注入子进程，只是模型看不到键名清单。旧模板的内联 `{{VAULT_KEYS}}` 仍被替换并受同一开关控制，标签页提供一键迁移（见「系统提示词占位符」一节）；
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

模板的 `{{SCHEDULES}}` 占位符展开为 `schedules.prompt`：教模型用文件工具自行管理这些 TOML 文件（目录、字段规则、约 30 秒自动生效、防重复等卫生规则），末尾经 `{{SCHEDULE_LIST}}` 注入现有任务名列表。提示词可在定时任务标签页编辑；`schedules.enabled` 关闭则整段为空——server 照常按计划触发任务，只是模型不了解任务体系。早于本机制创建的 Agent 模板没有该占位符，标签页提供一键插入。

## 设计原则

Agent 的行为完整地存放于磁盘上的可编辑文件——提示词、Skill、配置都是数据而非代码。正因如此，Agent 才能被 Agent 改进：优化器编辑的与你手工编辑的是同一批文件。参见[自我进化](/self-improvement)与 [CLI 参考](/cli)。
