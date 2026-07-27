---
title: "PenguinHarness 0.1.4：Windows 支持、目标模式与智能体面板"
date: 2026-07-27
category: news
excerpt: 0.1.4 只有一个主题——harness 来到你工作的地方，并在你离开后继续工作。Windows 有了自己的一行安装命令与完整 CI；新的目标模式让 Session 循环推进，直到目标真正完成而不是「回复完了」；新的智能体面板把子智能体的并发执行变成一张实时调用图。逐项说明如下。
---

PenguinHarness 0.1.4 发布了。这个版本只有一个主题：harness 来到你工作的地方，并在你离开后继续工作。它现在可以在 Windows 上安装运行；新的**目标模式**让 Session 循环推进，直到目标真正完成而不是「回复完了」；新的**智能体面板**把子智能体从层层嵌套的卡片变成一张可观察、可操作的实时调用图。逐项来看：

## Windows 成为一等公民

PowerShell 里一行命令：

```powershell
irm https://penguin.ooo/install.ps1 | iex
```

它会下载 `penguin-win32-x64.zip`——内置官方 Windows Node 运行时，无需预装任何东西——校验 SHA256，用「先落地再替换」的方式解压安装（绝不触碰你的 `data\` 目录），并把 `penguin` 加入用户 PATH：注册表值按原始类型读写，已有的 `%USERPROFILE%` 风格条目不会被展开破坏。稳定地址是一个「完整下载后才执行」的转发脚本，截断的流不可能装出半个产品。偏好 npm 的话，`npm install -g @prismshadow/penguin-cli` 在任何 Node ≥ 24 的环境同样可用。

有意思的部分不在打包，而在智能体本身。过去每一次 `exec_command` 在 Windows 上都死于 `spawn bash ENOENT`——命令会话把 bash 写死了。现在命令会话按平台解析 shell：优先 Git-Bash（与 POSIX 取向的技能生态兼容性最好；解析到 Windows 系统目录的 `bash` 会被拒绝——那是 WSL 启动器，完全是另一个文件系统视图），其次 `pwsh`，再次 `powershell`，`PENGUIN_SHELL` 可随时覆盖。选定的 shell 会通过会话环境里新增的 `Shell:` 一行告知模型，让它在拿到 PowerShell 时写 PowerShell 语法，而不是对着空气输出 bash。

这一切由 CI 保真：新增的 `ci-windows` 任务（完整构建、类型检查、测试，外加 PowerShell 语法门禁）与必需的 Ubuntu 任务并排运行；把它跑绿的过程本身就发现并修复了数个真实的 Windows 问题，包括一个此前由 POSIX 的 `O_NOFOLLOW` 默默兜底的工作区上传符号链接漏洞。剩余的限制如实写进文档而非假装不存在：安装包目前仅有 x64（ARM64 经转译运行），`input_command` 里的 Ctrl-C 会整树杀掉命令进程而非中断前台命令，升级方式是重跑安装器——`penguin update` 在 Windows 上仍拒绝原地更新。

## 目标模式：循环到完成为止

普通 Task 在模型停止调用工具并给出回复时结束。这对「一个请求」是对的，对「一个目标」是错的——「让检查套件全绿」不会因为模型不说话了就算完成。目标模式把契约倒了过来：你给出目标，系统在同一个 Session 上持续驱动 Task，每一轮重新注入目标，直到目标进入终态。

<img class="dark:hidden" src="/blog-assets/goal-mode-zh-light.webp" alt="目标模式进行中：检查套件目标的第 3 轮，输入框上方的目标横幅实时显示目标、轮次与 token 用量对预算" width="1920" height="1350" />
<img class="hidden dark:block" src="/blog-assets/goal-mode-zh-dark.webp" alt="深色主题下的目标模式：检查套件目标的第 3 轮，输入框上方的目标横幅实时显示目标、轮次与 token 用量对预算" width="1920" height="1350" />

完成必须通过协议声明，而不是从沉默里推断。每次目标运行都会在会话的 `PLAN.md` 旁创建一个 `GOAL.yaml`；模型只允许改动其中一个字段 `status`，且只能改成 `complete` 或 `blocked`。每轮注入的工作规则要求它：声明完成前先对照证据（文件、命令输出、测试结果）逐项自查；不得把目标缩水成更容易的子集；只有同一障碍连续三轮存在才可声明 `blocked`，一次性的阻碍不会终结目标。可选的 token 预算（`500k`、`2m`）在轮与轮之间检查；预算耗尽时模型获得最后一个收尾轮——总结进展、列出剩余工作——然后目标以「预算受限」结束，而不是伪装成功。

在 Web App 里，输入框新增的「+」菜单可挂上目标条并内联填写预算（斜杠菜单里的 `/goal` 等价）。每一轮都渲染成一条普通的用户气泡，下方带「目标 · 第 N 轮」的标注；输入框上方的实时横幅跟踪目标、轮次与 token 用量对预算——上面的截图正是一次真实循环的第 3 轮验证现场。CLI 侧同样齐备：聊天里的 `/goal[:<预算>] <目标>`，以及 `penguin run` 的 `--goal`——只有真正完成的目标才以 0 退出，一个可以写进脚本的目标。SDK 保持唯一入口：`session.run(input, { goal: { budget } })`。

## 智能体面板：看清整棵树

`run_subagent` 过去把子会话的完整对话内联进父消息流——卡片套卡片，两个子智能体之后就没法读了。0.1.4 把子会话对话移进专门的**智能体面板**，像工作区文件面板一样停靠在右侧：工具栏开关、拖拽调宽、窄屏变成底部抽屉。消息流里每个子智能体只留下一条横条：头像、解析出的智能体名称、运行中的旋转指示，以及子树中任何位置有待审批时的琥珀色圆点——面板关着也不会错过嵌套审批。

<img class="dark:hidden" src="/blog-assets/agents-panel-zh-light.webp" alt="智能体面板：调用图以主会话为根、两个具名子智能体带实时用时，下方是选中子会话的流式对话" width="1920" height="1350" />
<img class="hidden dark:block" src="/blog-assets/agents-panel-zh-dark.webp" alt="深色主题下的智能体面板：调用图以主会话为根、两个具名子智能体带实时用时，下方是选中子会话的流式对话" width="1920" height="1350" />

面板顶部是一张**调用图**：每个参与的智能体一个节点——头像、名称、运行状态点与用时，运行中按墙钟实时走秒，结束后定格为实际耗时，刷新后的页面与实时页面显示同样的数字。主会话是根节点，边表示谁派生了谁。点击节点，下方对话切换到对应子会话，由与主消息流完全相同的机制渲染：它自己的用户提示词就在那里，工具卡片实时流式输出，审批按钮在面板里直接可用。可见性按任务划定作用域——每个新 Task 开始时面板关闭，任务第一次派生子智能体时自动打开一次，此后你的手动开合在该任务内始终优先。调用图默认跟随最新 Task；点击更早轮次的横条，则钉住那一轮的历史派生树。

## 0.1.4 还有

同一个版本里：进行中的回复现在能挺过页面刷新——服务端为每个运行中的会话维护实时尾部，刷新后已流出的前缀立即回来并继续增长；聊天页头部的费用与用时统计在 Task 运行期间实时走动，与此前就随请求推进的 token 计数并列；Trace 文件支持导出与导入，一条轨迹可以跨部署迁移；应用终于知道自己的版本——「检查更新」一行内联显示当前版本号，管理员可一键原地更新。完整清单见 [v0.1.4 发布说明](https://github.com/Prism-Shadow/penguin-harness/releases/tag/v0.1.4)。

## 获取

```bash
# Linux / macOS
curl -fsSL https://penguin.ooo/install.sh | sh
```

```powershell
# Windows
irm https://penguin.ooo/install.ps1 | iex
```

或 `npm install -g @prismshadow/penguin-cli`（Node ≥ 24）——请安装 0.1.4：0.1.3 的功能集与之相同，但未能发布到 npm。然后 `penguin web`，在模型页配好密钥——给它一个目标。
