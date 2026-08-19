# Skill：skill-porting——从任意生态引入 Skill

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#195](https://github.com/Prism-Shadow/penguin-harness/pull/195)

[English](2026-08-04-skill-porting-library-skill.md)

新的库 Skill `skill-porting`（agent-tuning 分组）教 Agent 把外部世界的 Skill 引进来，并正确落到 `agent_state/skills/<name>/`。它的 schema 表格是在 2026-08-04 直接抓取各来源核实过的——该 Skill 自己写明了这一点，并把线上 JSON 视作权威：

- **Claude Code 插件市场**（`anthropics/claude-plugins-official`，278 个插件）：marketplace.json 的结构、全部四种 `source` 形式（相对路径、按 sha 固定的 `url`、`git-subdir`、`github`），以及一个插件可能存放 Skill 的五个位置。
- **Codex 插件**（`openai/plugins`，180 个插件）：`.agents/plugins/marketplace.json` 的条目结构及其 `policy` 区块，以及 `.codex-plugin/plugin.json` 的布局。
- **`npx skills add` / skills.sh**（`vercel-labs/skills`）：规格形式、逐 Agent 的安装目标位置，以及仓库内的发现顺序——通过从源仓库抓取来解析，绝不盲目运行安装脚本。
- 普通的 **GitHub 仓库/子目录**（稀疏检出 / tarball / 原始抓取三种变体）与**本地文件夹**，另加 agentskills.io 的 SKILL.md 约定。

每条流程都以同样的规范化收尾：把 frontmatter 适配到 penguin 的字段（`short_description`、`short_description_zh`、整数 `version`、`updated`），把 penguin 没有运行时支持的命令/agent/hook 移植过来或干脆丢弃（并且要诚实——该 Skill 禁止假装某项被丢弃的能力还在），最后验证安装结果。安全优先是强制的：安装前读遍每一个文件，拒绝任何会外泄数据、回连外部或覆盖安全规则的内容，优先使用固定的版本号。

Web 端导入对话框生成的提示词会在该 Skill 已安装时指向它。文档的 Skill 表格（中英）补上了库同步测试所要求的那一行。
