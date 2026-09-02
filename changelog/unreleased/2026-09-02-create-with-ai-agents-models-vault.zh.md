# Agents 页、模型库页与密钥保险柜标签页的「让 AI 创建」

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#591](https://github.com/Prism-Shadow/penguin-harness/pull/591)

[English](2026-09-02-create-with-ai-agents-models-vault.md)

三个页面接入了[共用组件包](2026-09-02-create-with-ai-kit.zh.md)提供的 AI 路径：Agent、模型分组与保险柜密钥现在都可以向 Project 的默认 Agent 描述，而不必填表单。每个页面自带可点击的示例与一段固定的说明尾巴，点名 Agent 必须使用的技能，让新手的一句话变成 Agent 能做完的任务。

## 细节

- Agents 页的**创建 Agent**按钮改为分体式控件，弹窗顶部以**手动配置 / 让 AI 创建**切换，两侧共用一份草稿，本次会话内记住上次的选择，Project 里除 `default_agent` 外没有 Agent 时默认让 AI 创建——此时列表末尾的空态按钮也指向它。AI 一侧带五个示例（随记智能体、金融 Copilot、文档 RAG 智能体、深度研究报告智能体，以及新手引导链起点的报告写作智能体，id 为 `report-writer`）与一段尾巴，要求 Agent 用 `agent-initialization` 技能在当前 Project 下新建 Agent：写好 AGENTS.md 与名称、描述，只从插件库复制它需要的技能，不动其他 Agent，最后报出 id 与开始对话的方式。手动表单不变。
- 模型库页页头在**同步预置**旁新增**让 AI 添加模型**（仅 owner）：模型列表页的链接或一段服务描述交给默认 Agent，尾巴要求它用 `penguin-config` 技能——每个模型执行一次 `penguin config model add --provider … --model-id … --project-id …`，OpenAI 兼容端点加 `--client-type openai --base-url …`，来源是网页时先抓取并优先加点名的模型（否则取最常用的、十个左右），缺 API key 只问一次、不给则留空到模型库页补填，不读写配置文件，最后 `penguin config model list`。弹窗引导语说明何时用现有的**新增分组 → 导入模型**更快。
- 密钥保险柜标签页在**添加**旁新增魔法棒按钮（仅 owner），弹窗如实提醒写进提示词的值会进入对话记录（Trace），建议只让 AI 建键名；尾巴在每条 `penguin config vault set` 上带上目标 Agent 与 Project，禁止复述值或读取 `.vault.toml`，最后 `penguin config vault list`。
- Web App 与模型文档以双语描述了这三个入口。
