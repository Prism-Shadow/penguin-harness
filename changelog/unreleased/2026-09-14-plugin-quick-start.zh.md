# 每个插件都能快速开始，发送之前什么都不运行

- **Date:** 2026-09-14
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#726](https://github.com/Prism-Shadow/penguin-harness/pull/726)

[English](2026-09-14-plugin-quick-start.md)

插件页的快速开始原本只对「当前 Agent 已安装了某个技能」的技能库插件可用。现在每个插件都有，而且它是一段演示：一条发出后就能看到插件起作用的提示词。

- **只写草稿，不发起运行。** 快速开始以当前 Agent 打开一份新对话草稿，按界面语言填好演示，按演示预选技能、打开目标模式；演示指定了 surface 时，打开该 surface 的草稿并把提示词填进首行。在你点发送（或打开 surface）之前，不调用任何模型、不消耗 Token。
- **先确认、再安装。** 当前 Agent 没装的技能库插件，确认后安装到它上面；Project 没列入的模块插件，走原有的安装确认，运行起来后再打开草稿。等待重启或加载失败的模块插件不能快速开始，并说明原因。
- **由各插件自己声明。** 技能库插件在 `plugin.json` 的 `quick_start` 里声明（`prompt`、`prompt_zh`、`skills`、`goal`）；模块插件向 `WebModule.quickStarts` 投递（`prompt`、`promptZh`、`surface`），经 `GET /api/contributions` 按模块列出。每个内置插件都声明了：沙盒后端测试它的封禁会拒绝什么，语言插件输出它支持的五种语言，Claude Code 打开它的 surface，目标插件启动一个小目标。未声明的第三方插件取它的第一个技能，或一条通用的演示提示词。
