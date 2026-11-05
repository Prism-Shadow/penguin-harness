# agent-porting Skill 把其他编码工具中的 Agent 迁移成新的 Agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[English](2026-11-04-agent-porting-skill.md)

`skill-porting` 插件新增第三个 Skill：`agent-porting`（版本 `2026.11.05.2`）。Agents 页面的导入对话框打开迁移对话时，Agent 按它的流程操作；用户在任意对话里要求迁移时也一样。Agent 读取来源工具的文件，写成 Agent zip 文件夹，再用 `penguin agent import <folder>` 新建 Agent，最后报告没能迁移的部分。

## 来源

- Skill 记录了 Claude Code、Codex、DeepSeek Harness（`dsh`）、Qoder CLI、Qwen Code 和 Pi 的用户级与项目级目录结构。对每个工具，它列出指令、Skill、命令或 Prompt、子 Agent、MCP Server、钩子、模型设置和记忆所在的位置，以及哪些文件从不读取：凭据存储、登录状态和对话记录。
- WorkBuddy 只公开了自定义模型文件，所以 Agent 先列出 `~/.workbuddy/` 和 `~/.workbuddy-ai/`，按文件形态映射找到的内容，两个目录都不存在时询问用户。其他工具或用户描述的路径也按同样的方式处理。
- 导出的 PenguinHarness zip 和较早的 `.tar.gz` Agent State 包直接导入。

## 密钥不进入对话

- Agent 读取任何来源文件都只经过 Skill 自带的读取脚本 `scripts/inspect-config.mjs`，不用其他命令。
- JSON、TOML 和 YAML 配置文件按白名单打印成 JSON：
  - 键名、数字和布尔值照常打印；
  - 字符串只在以下情况打印：`${VAR}` 引用、结构性键（`name`、`type`、`transport`、`command`、`cwd`、`matcher`、`model`、推理强度与审批设置）的值、`args` 中的开关、包名或路径，以及 URL 的协议、主机和路径；
  - `command` 中的整行 shell 命令只打印程序名和词数；
  - 其余字符串一律打印为 `<redacted:N chars>`，凭据键下的引用也只保留结构；
  - `~/.claude.json` 只显示其中的 MCP Server。
- 无法解析的文件只报出错的行号，并且只打印键名，从不打印内容。
- `--scan` 把文件或文件夹中疑似含有凭据的每一行列为 `file:line: <kind>`，从不打印该行内容。Agent 在读取任何来源目录之前、以及导入之前运行它。
- `--show` 打印文本文件（指令、Skill、命令、脚本），被标出的行整行替换，私钥块替换到结束。
- 凭据存储（`.env`、`*.env`、`.envrc`、`auth.json`、`.credentials.*`、OAuth 令牌缓存、`*.pem`、`*.key`、`id_rsa*`、`.netrc`、`.npmrc`、`.pypirc`）一律拒绝读取。
- 命令是脚本文件的钩子通过该脚本移植；命令是整行 shell 命令的钩子（读取脚本不显示其内容）写进报告。

## 迁移的内容

- **指令**：指令文件和规则按读取顺序合并进 `agent_state/AGENTS.md`，用户级在前。
- **Skill、命令和 Prompt**：Skill 原样复制，每个命令或 Prompt 各自成为一个 Skill。它们的 frontmatter 由 `plugin-porting` Skill 的 `normalize-skills.mjs` 规范化。
- **MCP Server**：写进清单的 `definition.mcpServers`。每个凭据都改成列在 `vaultKeys` 里的 `${KEY}` Vault 引用，不带任何值。
- **钩子**：`PreToolUse`、`Stop` 或 `UserPromptSubmit` 上的 `command` 钩子会变成钩子包，由一个 Node 包装脚本在 PenguinHarness 的钩子输入、输出与来源工具的格式之间转换。其他钩子写进报告。
- **记忆**：自动记忆文件放进 `agent_state/memory/` 的用户作用域。
- **模型设置**：推理强度映射为 Agent 的思考等级。
- **不迁移的内容**：模型本身、权限、沙箱设置和扩展写进报告，并给出最接近的审批模式。
- **子 Agent**：每个子 Agent 单独导入为一个 Agent，父 Agent 的指令里写明它的名字，供 `run_subagent` 调用。
- **清单**：始终带有 `definition`，没有内容时写空对象 `{}`。文件夹里没有 `system_config.yaml` 又缺少它时，服务端拒绝导入。
- **导出**：一段说明指向反方向的 `penguin agent export`。

## 插件与文档

- 插件的描述和卡片文字加上了 Agent 迁移。它的 npm 版本照旧跟随发布。
- 「技能与插件」文档页列出插件的三个 Skill，中英文同步。
