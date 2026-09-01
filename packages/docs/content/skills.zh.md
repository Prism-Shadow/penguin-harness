---
title: 技能与插件
description: 插件打包 Skill（目录加 SKILL.md，元数据先行、正文按需读取）与会话钩子（循环在固定点执行的脚本）——同一个库装进 Agent State，版本按日期编号。
---

## 插件

内置库由一组**插件**组成。一个插件就是一个目录：一份 `plugin.json` 清单，加上它携带的内容——**Skill**（模型按需读取的可复用指令）和/或一个**钩子包**（harness 在循环固定点上运行的脚本，见[运行循环](/agent-loop#stop-hook)）。安装插件即把它的 Skill 放进 `agent_state/skills/`、钩子包放进 `agent_state/hooks/`——Agent State 里并列的两个一等成员，本页其余部分分别介绍。

```text
official/<plugin>/
├── plugin.json                # 清单——插件唯一的元数据载体
├── skills/<name>/SKILL.md     # 零个或多个 Skill（icon.svg、reference/… 随行）
└── hooks/*.mjs                # 至多一个钩子包：纯 Node 脚本
```

`plugin.json`：

| 字段 | 说明 |
| --- | --- |
| `description` / `description_zh` | 单行描述（只含钩子的插件必须写英文描述；Skill 插件缺省回退到首个 Skill 的描述） |
| `short_description` / `short_description_zh` | 卡片短标签（回退到首个 Skill 的） |
| `version` | `YYYY-MM-DD.N`——日期加当日序号 |
| `category` | `office-productivity`、`software-development`、`ai-app-development`、`agent-tuning`、`session-hooks` 之一；缺失或未知归入「其他」 |
| `preinstall` | 可选；`false` 表示不进入 `default_agent` 的预装集合，仅可从插件库手动安装 |
| `hooks.stop` | 钩子包的 stop hook 命令：`[{ "command": "stop.mjs", "timeout": 60 }]`，路径相对 `hooks/`，超时以秒计 |

插件名即目录名（`^[A-Za-z0-9_-]+$`）。版本先比日期、再比序号，因此 `2026-08-29.10` 排在 `2026-08-29.9` 之后；清单里的版本就是插件携带的一切内容的版本。没有别的版本方案。

插件库以 npm 包 `@prismshadow/penguin-plugins` 发布，tarball 直接携带原始 `official/` 目录；运行时库内容的事实源同样是包内文件，每次调用直接读取。

## Skill 的形态

一个 Skill 就是一个目录：内含一份 `SKILL.md`，可选附带一个 `icon.svg` 自定义图标，以及 `SKILL.md` 引用的其他文件（例如它链接到的 `reference/` 子目录）。目录名即权威的 Skill 名，须匹配 `^[A-Za-z0-9_-]+$`；frontmatter 中的 `name` 以目录名为准。

库内 `SKILL.md` 的 frontmatter 只有两个字段——其余全部放在 `plugin.json`：

| 字段 | 说明 |
| --- | --- |
| `name` | Skill 名，与目录名一致 |
| `description` | 英文单行描述，注入系统 Prompt |

```md
---
name: my-skill
description: One-line English description injected into the system prompt.
---

# My Skill

具体的步骤、边界与验收标准……
```

**已安装**的副本是自描述的：库在读取时把插件的 `short_description`、`short_description_zh` 与 `version` 盖章进各 Skill 的 frontmatter 重新生成（如同已装钩子包的 `hooks.json` 由清单生成），写进 `agent_state/skills/` 的就是这份内容。更新检查读已装 frontmatter 的 `version`，UI 读它的短标签。解析是容错的：只识别首个 `---` 块内的 `key: value` 标量行；`version` 不是 `YYYY-MM-DD.N` 时读作空——比库里任何版本都旧，于是库内副本算作可更新。

## 渐进式加载

Skill 采用「先索引、后正文」的设计：系统 Prompt 经 `{{SKILL_METADATA}}` 占位符只注入每个已安装 Skill 的元数据(name + description)，并指示模型在任务匹配某个 Skill 时，先用 Shell 完整读取对应的 `SKILL.md`，再遵循执行。系统不设专门的 Skill 工具，读取正文就是一次 `read_file` 或 Shell 调用(见 [工具与审批](/tools))。

对话中也可以显式指定 Skill：此时消息以 `[use_skills]` 块开头，列出要使用的 Skill 名（重新渲染旧 Trace 时仍识别早期的 `<use_skills>` 形式）。

若消息只点名 Skill 而没有给出具体任务，模型会先询问需求再开始。

## 钩子包

钩子包就是插件的 `hooks/` 目录，安装为 `agent_state/hooks/<plugin>/`，脚本旁边生成一份 `hooks.json`——清单的身份字段（`name`、`description`、`description_zh`、`version`）加上各钩子点的命令：

```json
{
  "name": "goal",
  "description": "Goal mode: …",
  "version": "2026-08-29.1",
  "stop": [{ "command": "stop.mjs", "timeout": 60 }]
}
```

装了即生效：Agent 的每个顶层 Session 都会在循环的钩子点上咨询已安装的钩子包。脚本是只用内置模块的纯 Node——harness 跑在哪它就跑在哪，以子进程方式运行，stdin 进 JSON、stdout 出 JSON 回答；契约见[运行循环](/agent-loop#stop-hook)。钩子包里的其他脚本由宿主按约定调用：goal 插件的 `start.mjs` 就是用户发起目标时服务端运行的那个（[目标模式](/goal-mode)）。

## 安装与存放

已安装的 Skill 位于 `agent_state/skills/<name>/`，钩子包位于 `agent_state/hooks/<name>/`。文件即事实源：每次读取直接读文件、不设缓存，因此 Skill 天然可编辑。

- 内置 Agent `default_agent` 在初始化时安装完整插件库（标记 `preinstall: false` 的插件除外，仅手动安装）；
- 其他 Agent 按需安装：经 Web 界面的插件库页，或经 SDK；
- 安装 Skill 即写入它的可安装 `SKILL.md`（frontmatter 已按插件元数据重新生成，见上），目录内的 `icon.svg` 与其他文件（保留子目录）一并拷贝；安装钩子包即写入 `hooks.json` 与插件 `hooks/` 下的全部文件。每次安装整目录替换，因此重装会丢弃新版本不再携带的文件——重装就是更新已装副本的方式，Agent 列表页会标出已装 Skill 或钩子包落后于库的插件。

## 内置插件库

内置插件按分类列出（分类清单是 `packages/plugins/src/index.ts` 的 `PLUGIN_CATEGORIES`；新增插件以库目录为准）：

| 分类 | 插件 | 用途 |
| --- | --- | --- |
| 办公效率 | `data-analysis` | 完成数据分析任务：有限度地核查证据、明确会改变结论的决策、原生处理产物并在最终输出前验证 |
| | `firecrawl` | 通过 Firecrawl API 做网页搜索与抓取，输出干净的 Markdown |
| | `bento-slides` | 编写与修改 Bento 演示：单文件 `.bento.html`、文档即 JSON，把素材映射为图表、morph 转场与状态页 |
| | `humanizer` | 去除任意语言文本里的 AI 味，改写成书籍、报纸、百科的行文（不预装：需要时从库安装） |
| 软件开发 | `web-design` | 生成网页与应用 UI 的 Penguin 视觉规范：设计令牌、组件、明暗主题与聊天布局 |
| | `software-engineering` | 完成软件工程任务：调研与评审代码，以最小范围实现修复、功能与重构，验证改动并报告已验证的结果 |
| | `remote-claude-code` | 经 SSH 在远程主机上驱动 Claude Code——持久的 expect 会话、带 stdin 修正的无头 `-p`、tmux 驱动的交互式 TUI（逐次按键并截屏核验，用户消息原样转达）与多轮延续（不预装：需要时从库安装） |
| AI 应用开发 | `penguin-sdk` | 基于 SDK 构建智能体、AI 与 RAG 应用——写的是应用代码而非 Agent State 配置：createSession/run 流式循环、CLI 封装的用户工具，以及带分块引用的完整检索方案 |
| | `penguin-cli` | 用 penguin CLI 管理模型 API key、默认模型与各 Agent 的 Vault 密钥 |
| | `penguin-orchestration` | 从 Shell 驱动 PenguinHarness 本身：列出并创建 Agent 与 Session、发送与中途引导消息、查询成本与定时任务 |
| | `agenthub-models` | 通过 `@prismshadow/agenthub` 调用模型 API：流式文本、图像生成、语音合成与向量嵌入 |
| | `vllm` | 用 vLLM 部署与服务 LLM，暴露 OpenAI 兼容端点并为智能体负载开启工具调用 |
| | `ollama` | 用 Ollama 部署与服务本地模型：拉取运行后把 OpenAI 兼容端点接给应用与智能体 |
| | `llamafactory` | 用 LlamaFactory 微调 LLM：登记数据集、按 YAML 配置训练、合并 LoRA 适配器并部署 |
| | `skill-porting` | 把外部来源（插件市场、skills.sh 注册表、GitHub 仓库或本地目录）的 Skill 经审查与规范化后移植进 Agent |
| Agent 调优 | `agent-initialization` | 依据用户需求初始化 Agent 设定：编写 AGENTS.md、设置身份元数据、安装所需 Skill |
| | `benchmark-design` | 为指定 Agent 设计并校准多 Case 能力 Benchmark，建立可追溯的正式基线 |
| | `agent-evaluation` | 内部叶子工作者：按完整评测协议执行并私下打分恰好一次 Case 运行 |
| | `agent-optimization` | 在冻结的 Benchmark 上，从完整的当前基线出发改进指定 Agent |
| 会话钩子 | `goal` | [目标模式](/goal-mode)背后的 stop hook：让会话持续朝目标工作，直到完成、受阻或 token 预算耗尽（预装） |
| | `skill-summary` | 单个任务结束时轮次超过 20，就把该任务的浓缩摘录交给一个后台子会话，由它把值得沉淀的发现写进 Agent 的 Skill（不预装） |

## 编写与优化

- 手工安装：在 `agent_state/skills/<name>/` 下建目录并写入 `SKILL.md` 即可，系统组装系统 Prompt 时扫描 `skills/` 注入元数据；没有 `SKILL.md` 的目录不计为 Skill。
- 卸载即删除整个 `skills/<name>/`（或 `hooks/<name>/`）目录，操作幂等。
- Agent 可以在任务中直接改写自己的 SKILL.md——配合 Benchmark 评测与优化形成闭环，见 [自我进化](/self-improvement)。改完把 `version` 记成当天日期加下一个序号。
- 长任务可以自己回流：装上 `skill-summary` 插件后，某个任务结束时轮次超过 20，它的 stop hook 就把该任务的浓缩摘录交给一个后台子 Session，由它把值得沉淀的发现写进相关 SKILL.md——见[运行循环](/agent-loop#stop-hook)。
