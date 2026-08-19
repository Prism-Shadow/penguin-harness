---
title: 技能系统
description: Skill 以目录加 SKILL.md 承载可复用指令，元数据先行、正文按需读取，并可由 Agent 自行编辑优化。
---

## Skill 的形态

一个 Skill 就是一个目录：内含一份 `SKILL.md`，可选附带一个 `icon.svg` 自定义图标，以及 `SKILL.md` 引用的其他文件（例如它链接到的 `reference/` 子目录）。目录名即权威的 Skill 名，须匹配 `^[A-Za-z0-9_-]+$`;frontmatter 中的 `name` 以目录名为准。

frontmatter 字段：

| 字段 | 说明 |
| --- | --- |
| `name` | Skill 名，与目录名一致 |
| `description` | 英文单行描述，注入系统 Prompt |
| `short_description` / `short_description_zh` | UI 短标签(卡片等紧凑位置用)，不注入 Prompt |
| `preinstall` | 可选；`false` 表示不进入 default_agent 的预装集合，仅可从技能库手动安装 |
| `version` | 自然数版本号，默认 1 |
| `updated` | 更新日期 |

```md
---
name: my-skill
description: One-line English description injected into the system prompt.
short_description: Short UI label.
short_description_zh: 简短的中文标签。
version: 1
updated: 2026-07-17
---

# My Skill

具体的步骤、边界与验收标准……
```

解析是容错的：只识别首个 `---` 块内的 `key: value` 标量行；`version` 不是自然数时回退为 1,`updated` 缺省为空；`preinstall` 仅识别字面量 `false`。

## 渐进式加载

Skill 采用「先索引、后正文」的设计：系统 Prompt 经 `{{SKILL_METADATA}}` 占位符只注入每个已安装 Skill 的元数据(name + description)，并指示模型在任务匹配某个 Skill 时，先用 Shell 完整读取对应的 `SKILL.md`，再遵循执行。系统不设专门的 Skill 工具，读取正文就是一次 `read_file` 或 Shell 调用(见 [工具与审批](/tools))。

对话中也可以显式指定 Skill：此时消息以 `[use_skills]` 块开头，列出要使用的 Skill 名（重新渲染旧 Trace 时仍识别早期的 `<use_skills>` 形式）。

若消息只点名 Skill 而没有给出具体任务，模型会先询问需求再开始。

## 安装与存放

已安装的 Skill 位于 Agent State 的 `agent_state/skills/<name>/`。文件即事实源：每次读取直接读文件、不设缓存，因此 Skill 天然可编辑。

- 内置 Agent `default_agent` 在初始化时安装完整 Skill 库（标记 `preinstall: false` 的 Skill 除外，仅手动安装）；
- 其他 Agent 按需安装：经 Web 界面的 Skill 库页，或经 SDK;
- 安装即把库里的 `SKILL.md` 原样写入(含 frontmatter)，目录内的 `icon.svg` 与其他文件（保留子目录）一并拷贝；每次安装整目录替换，因此重装会丢弃新版本不再携带的文件。

Skill 库以 npm 包 `@prismshadow/penguin-skills` 发布，tarball 直接携带原始 `skills/` 目录；运行时库内容的事实源同样是包内的 `skills/<name>/SKILL.md` 文件。

## 内置 Skill 库

内置 Skill 按分组列出如下(分组清单见 `packages/skills/src/index.ts` 的 `SKILL_GROUPS`，新增 Skill 时以库目录为准):

| 分组 | Skill | 说明 |
| --- | --- | --- |
| 办公效率 | `data-analysis` | 以有界的证据检查、显式的改答案决策、原生产物处理与最终输出校验完成数据分析任务 |
| | `firecrawl` | 经 Firecrawl API 做网络搜索与页面抓取，产出干净的 Markdown |
| | `bento-slides` | 制作与编辑 Bento 演示文稿：单文件 `.bento.html`、文档即 JSON，把素材映射到图表、morph 转场与状态页 |
| | `humanizer` | 去除任意语言文本的 AI 味，把行文改写成书籍、报纸、百科式的风格（不预装，按需从技能库安装） |
| 软件开发 | `web-design` | 生成网页与应用界面的 Penguin 视觉语言：设计令牌、组件配方、明暗主题与聊天布局 |
| | `software-engineering` | 完成软件工程任务：调查与审查代码，以最小改动实现修复、特性与重构，验证改动并报告经过确认的结果 |
| | `remote-claude-code` | 通过 SSH 在远程主机上驱动 Claude Code：expect 持久会话、headless `-p` 的 stdin 修正、tmux 驱动的交互 TUI（逐个按键并截屏确认，用户消息原样转发）与多轮续接（不预装，按需从技能库安装） |
| AI 应用开发 | `penguin-sdk` | 基于 SDK 构建 AI 与 RAG 应用：createSession/run 流式循环，外加带可溯源引用的完整检索配方 |
| | `penguin-cli` | 用 penguin CLI 管理模型 API Key、默认模型与各 Agent 的 Vault 密钥 |
| | `agenthub-models` | 经 `@prismshadow/agenthub` 调用模型 API：流式文本、图像生成、语音合成与 Embedding |
| | `vllm` | 用 vLLM 部署与服务 LLM，提供 OpenAI 兼容端点，并为 Agent 负载启用工具调用 |
| | `ollama` | 用 Ollama 部署与运行本地模型，把 OpenAI 兼容端点接入应用与 Agent |
| | `llamafactory` | 用 LlamaFactory 微调 LLM：注册数据集、以 YAML 配置训练、合并 LoRA 适配器并部署产物 |
| | `skill-porting` | 把外部来源（插件市场、skills.sh、GitHub 仓库或本地目录）的 Skill 经审查与规范化后安装进 Agent |
| Agent 调优 | `agent-creation` | 根据需求创建或配置 Agent State，编写 AGENTS.md、设置身份信息并安装所需 Skill |
| | `benchmark-design` | 为指定 Agent 设计并校准多 Case Benchmark，建立可追溯的 Formal Baseline |
| | `agent-evaluation` | 内部叶子执行器：根据完整评测协议隔离执行并私密评分一个 Case Run |
| | `agent-optimization` | 基于冻结 Benchmark 的完整当前基线改进指定 Agent |

## 编写与优化

- 手工安装：在 `agent_state/skills/<name>/` 下建目录并写入 `SKILL.md` 即可，系统组装系统 Prompt 时扫描 `skills/` 注入元数据；没有 `SKILL.md` 的目录不计为 Skill。
- 卸载即删除整个 `skills/<name>/` 目录，操作幂等。
- Agent 可以在任务中直接改写自己的 SKILL.md——配合 Benchmark 评测与优化形成闭环，见 [自我进化](/self-improvement)。
