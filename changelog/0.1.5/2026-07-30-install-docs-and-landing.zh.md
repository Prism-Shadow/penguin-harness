# 0.1.5 的安装文档与落地页刷新

- **Date:** 2026-07-30
- **Type:** process
- **Scope:** `landing`, `docs`
- **PR:** [#134](https://github.com/Prism-Shadow/penguin-harness/pull/134)

[English](2026-07-30-install-docs-and-landing.md)

0.1.5 重新打包了产品自我介绍与自我安装的方式，涉及两份 README 与落地页站点。

## 全站统一一对标语

README 与落地页统一到同样的两行：**"Your Automated Agent Builder, Right on Your Desktop / Server"**（落地页首屏仍轮播 Desktop/Server 这个词，README 则用斜杠把这一对写在一起）与副标题 **"Create Self-Evolving Agents in One Click"**——中文为「全自动 Agent 构建平台，运行在你的桌面 / 服务器上」与「一键创建自进化 Agent」。首屏的 "Agents building agents" 徽章被移除；该说法移到 LangChain 对比小节，该节改名为 **"Building Agents with Agents"**（用 Agent 构建 Agent）。

## README：每种安装方式都写全

安装小节现在为每种方式各给一段完整、可直接复制粘贴的代码块——Linux、macOS 与 Windows 的在线一行命令，以及 npm——每段都以 `penguin web` 结尾；五个离线安装包则按操作系统记录在一个可折叠的 `<details>` 块内（解压并运行的命令、架构提示，以及无条件的 SHA256 说明）。Web App 的功能卖点并入该小节的引言；CLI & SDK 小节未变。

## 落地页：用切换，不用罗列

- 首屏的安装框与快速开始的安装步骤都改为按操作系统切换（Linux / macOS / Windows），而不是把所有命令堆叠起来；快速开始另加一层在线/离线切换，离线一侧带上安装包说明、按操作系统的命令、架构提示与 Releases 链接。离线命令与在线一行命令并列存放在 `lib/links.ts` 中。
- 公告栏从四条轮播减为两条：Kimi K3 与免费模型，以及 AMD 开发者计划的额度。
- 0.1.5 发布文章以两种语言发布（`penguinharness-0-1-5`），涵盖离线安装、附件与输入图片、运行内的 LLM 恢复，以及 Skill 库升级。
