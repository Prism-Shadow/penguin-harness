# agent-porting Skill 把其他编码工具中的 Agent 迁移成新的 Agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[English](2026-11-04-agent-porting-skill.md)

`skill-porting` 插件新增第三个 Skill：`agent-porting`（版本 `2026.11.05.5`）。Agents 页面的导入对话框打开迁移对话时，Agent 按它的流程操作；用户在任意对话里要求迁移时也一样。Agent 读取来源工具的文件，写成 Agent zip 文件夹，再用 `penguin agent import <folder>` 新建 Agent，最后报告没能迁移的部分。

## 来源

- Skill 记录了 Claude Code、Codex、DeepSeek Harness（`dsh`）、Qoder CLI、Qwen Code 和 Pi 的用户级与项目级目录结构。对每个工具，它列出指令、Skill、命令或 Prompt、子 Agent、MCP Server、钩子、模型设置和记忆所在的位置，以及哪些文件从不读取：凭据存储、登录状态和对话记录。
- WorkBuddy 只公开了自定义模型文件，所以 Agent 先列出 `~/.workbuddy/` 和 `~/.workbuddy-ai/`，按文件形态映射找到的内容，两个目录都不存在时询问用户。其他工具或用户描述的路径也按同样的方式处理。
- 导出的 PenguinHarness zip 和较早的 `.tar.gz` Agent State 包直接导入。

## 密钥不进入对话

Skill 靠写入来移植，而不是靠读取。它的脚本 `scripts/inspect-config.mjs` 自己把来源中的值写进移植文件夹，值只在文件之间流转，从不经过对话，因此也不会进入 Session 的 Trace（导出时可能带上 Trace）。

- **`--emit <config> --framework <tool> --out <port folder>`** 解析 Claude Code、Codex、DeepSeek Harness、Qoder、Qwen Code、Pi 或其他工具的配置，或子 Agent 的文件，并写入能映射的部分：
  - MCP Server 写进 `manifest.json` 的 `definition.mcpServers`，命令、参数、地址和普通值与来源完全一致，每个凭据替换为 `${NAME}` Vault 引用并列入 `vaultKeys`。凭据指：凭据名称下的值、凭据开关后的词、凭据查询参数，以及任何形如令牌的值；
  - `PreToolUse`、`Stop` 和 `UserPromptSubmit` 上的 `command` 钩子写成钩子包。每个包装脚本在 Session 的 Workspace 中运行来源的命令，并转换其应答。Stop 钩子若拦下了本 Session 的上一次停止，就会收到 `stop_hook_active`，连续拦下 3 次后放行。无法启动的 PreToolUse 守卫会拒绝，`ask` 也按拒绝处理。`mcp__<server>__` 匹配器跟随 Server 移植后的名称。再次 emit 同一文件时替换它写过的钩子；
  - 思考等级，以及子 Agent 的指令。

  它只打印摘要：写了什么、创建了哪些 Vault 键、哪些没能映射。`${HOME}` 一类的变量不算 Vault 键，摘要会说明需要填入本机的值。Codex 的 `[profiles.<name>.mcp_servers]` 会在摘要中列出，用 `--profile` 移植。
- **`--append <file> --to <file>`** 原样复制指令文件，不打印内容；frontmatter 不带过去，`paths` 作用范围改写成一句话。
- **遮蔽视图**（`<file>`）按白名单显示配置的结构。变量名只在环境变量形式时打印。参数只在是开关、路径或包名形状时打印，URL 只到普通的第一段路径，shell 命令只显示程序名，文本字段只给出 `--show --key` 的指引。
- **`--show` 和 `--scan` 对文本只能尽力而为。** 它们也会识别密码短语、十六进制密钥、`secret_` 与 `ntn_` 令牌、webhook 和疑似含密钥的 URL 路径，以及高熵词。Markdown 的 frontmatter 按位置检查（`--show` 经遮蔽视图显示）。`--scan` 只打印 `file:line: <kind>`，有发现时以 1 退出。
- **被标出的指令、Skill 或记忆文件要等用户确认。** `--append` 和 `--emit` 在收到 `--confirmed` 之前不写入它，报告里也会说明检查只是尽力而为。
- **解析错误**只报行号。**凭据存储**（`.env`、`*.env`、`.envrc`、`auth.json`、`.credentials.*`、OAuth 令牌缓存、`*.pem`、`*.key`、`id_rsa*`、`.netrc`、`.npmrc`、`.pypirc`）一律拒绝读取。

## 迁移的内容

- **指令**：指令文件和规则按读取顺序追加到 `agent_state/AGENTS.md`，用户级在前。
- **Skill、命令和 Prompt**：Skill 原样复制，每个命令或 Prompt 各自成为一个 Skill。它们的 frontmatter 由 `plugin-porting` Skill 的 `normalize-skills.mjs` 规范化。
- **MCP Server**：`--emit` 把它们写进清单的 `definition.mcpServers`，每个凭据都改成列在 `vaultKeys` 里的 `${KEY}` Vault 引用。
- **钩子**：`--emit` 把 `PreToolUse`、`Stop` 或 `UserPromptSubmit` 上的 `command` 钩子写成钩子包，由 Node 包装脚本在 PenguinHarness 的钩子输入、输出与来源工具的格式之间转换。其他钩子写进报告。
- **记忆**：自动记忆文件放进 `agent_state/memory/` 的用户作用域。
- **模型设置**：推理强度映射为 Agent 的思考等级。
- **不迁移的内容**：模型本身、权限、沙箱设置和扩展写进报告，并给出最接近的审批模式。
- **子 Agent**：每个子 Agent 单独导入为一个 Agent，父 Agent 的指令里写明它的名字，供 `run_subagent` 调用。
- **清单**：始终带有 `definition`，没有内容时写空对象 `{}`。文件夹里没有 `system_config.yaml` 又缺少它时，服务端拒绝导入。
- **导出**：一段说明指向反方向的 `penguin agent export`。

## 插件与文档

- 插件的描述和卡片文字加上了 Agent 迁移。它的 npm 版本照旧跟随发布。
- 「技能与插件」文档页列出插件的三个 Skill，中英文同步。
