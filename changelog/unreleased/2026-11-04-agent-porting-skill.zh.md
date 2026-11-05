# agent-porting Skill 把其他编码工具中的 Agent 迁移成新的 Agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[English](2026-11-04-agent-porting-skill.md)

`skill-porting` 插件新增第三个 Skill：`agent-porting`（版本 `2026.11.04.1`）。Agents 页面的导入对话框打开迁移对话时，Agent 按它的流程操作；用户在任意对话里要求迁移时也一样。Agent 读取来源工具的文件，写成 Agent zip 文件夹，再用 `penguin agent import <folder>` 新建 Agent，最后报告没能迁移的部分。

## 来源

- Skill 记录了 Claude Code、Codex、DeepSeek Harness（`dsh`）、Qoder CLI、Qwen Code 和 Pi 的用户级与项目级目录结构。对每个工具，它列出指令、Skill、命令或 Prompt、子 Agent、MCP Server、钩子、模型设置和记忆所在的位置，以及哪些文件从不读取：凭据存储、登录状态和对话记录。
- WorkBuddy 只公开了自定义模型文件，所以 Agent 先列出 `~/.workbuddy/` 和 `~/.workbuddy-ai/`，按文件形态映射找到的内容，两个目录都不存在时询问用户。其他工具或用户描述的路径也按同样的方式处理。
- 导出的 PenguinHarness zip 和较早的 `.tar.gz` Agent State 包直接导入。

## 迁移的内容

- **指令**：指令文件和规则按读取顺序合并进 `agent_state/AGENTS.md`，用户级在前。
- **Skill、命令和 Prompt**：Skill 原样复制，每个命令或 Prompt 各自成为一个 Skill。它们的 frontmatter 由 `plugin-porting` Skill 的 `normalize-skills.mjs` 规范化。
- **MCP Server**：写进清单的 `definition.mcpServers`。每个凭据都改成列在 `vaultKeys` 里的 `${KEY}` Vault 引用，不带任何值。
- **钩子**：`PreToolUse`、`Stop` 或 `UserPromptSubmit` 上的 `command` 钩子会变成钩子包，由一个 Node 包装脚本在 PenguinHarness 的钩子输入、输出与来源工具的格式之间转换。其他钩子写进报告。
- **记忆**：自动记忆文件放进 `agent_state/memory/` 的用户作用域。
- **模型设置**：推理强度映射为 Agent 的思考等级。
- **不迁移的内容**：模型本身、权限、沙箱设置和扩展写进报告，并给出最接近的审批模式。
- **子 Agent**：每个子 Agent 单独导入为一个 Agent，父 Agent 的指令里写明它的名字，供 `run_subagent` 调用。
- **导出**：一段说明指向反方向的 `penguin agent export`。

## 插件与文档

- 插件的描述和卡片文字加上了 Agent 迁移。它的 npm 版本照旧跟随发布。
- 「技能与插件」文档页列出插件的三个 Skill，中英文同步。
