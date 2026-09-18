---
title: "PenguinHarness 0.1.4：Windows 支持、目标模式与智能体面板"
date: 2026-07-27
category: news
excerpt: 0.1.4 让 PenguinHarness 登陆 Windows，一行命令即可安装；新增目标模式，让会话一直推进到目标真正完成；子 Agent 移进智能体面板，以实时调用图呈现。
---

PenguinHarness 0.1.4 发布了，现在可以在 Windows 上安装和运行。新增的**目标模式**让会话持续推进，直到目标真正完成，而不是模型回复一句就算结束。新增的**智能体面板**把子 Agent 的运行从层层嵌套的卡片变成一张实时调用图，可观察，也可操作。

## Windows 支持

在 PowerShell 里用一行命令即可在 Windows 上安装 PenguinHarness：

```powershell
irm https://penguin.ooo/install.ps1 | iex
```

脚本会下载 `penguin-win32-x64.zip`，包内自带官方 Windows 版 Node 运行时，无需预装任何东西。它会校验压缩包的 SHA256，用「先落地再替换」的方式安装，全程不碰你的 `data\` 目录，并把 `penguin` 加入用户 PATH。PATH 里已有的带变量条目（例如 `%USERPROFILE%`）会原样保留。稳定地址上的脚本只是一个转发器，它会先把完整的安装脚本下载下来再执行，即使下载中途断掉，也不会留下装到一半的程序。偏好 npm 的话，`npm install -g @prismshadow/penguin-cli` 在任何 Node ≥ 24 的环境都能用。

真正难的部分在 Agent 本身。以前在 Windows 上，每次 `exec_command` 都会报 `spawn bash ENOENT`，因为命令会话写死了 bash。现在命令会话按平台选择 shell：Windows 上优先尝试 Git-Bash，它和面向 POSIX shell 编写的 Skill 最兼容；其次是 `pwsh`，再次是 `powershell`。设置 `PENGUIN_SHELL` 可以覆盖这个选择。如果 `bash` 解析到 Windows 系统目录，就会跳过它，因为那是 WSL 启动器，看到的是另一套文件系统。

模型通过会话环境里的 `Shell:` 一行得知自己用的是哪种 shell。拿到 PowerShell 时，它就写 PowerShell 语法，而不是 bash。

这些都由 CI 守住。除了必需的 Ubuntu 任务，现在还有一个 `ci-windows` 任务，运行完整的构建、类型检查和测试，外加 PowerShell 语法检查。把它跑绿的过程中发现并修复了几个真实的 Windows 问题，其中包括 Workspace 上传的符号链接防护：在 POSIX 系统上，这层防护一直由 `O_NOFOLLOW` 默默提供，Windows 上却没有。

目前仍有几项限制，文档里都写明了：

- 安装包暂时只有 x64，ARM64 机器通过转译运行。
- `input_command` 里的 Ctrl-C 会结束整棵命令进程树，而不是只中断前台命令。
- 升级需要重新运行安装脚本。在 Windows 上，`penguin update` 仍然拒绝原地升级。

## 目标模式

普通 Task 在模型停止调用工具、给出回复时结束。这对「一个请求」是对的，对「一个目标」却不对：「让检查套件全绿」不会因为模型不说话了就算完成。目标模式改变了这个约定：你给出目标，系统在同一个会话上持续运行 Task，每一轮重新注入目标，直到目标进入终态。

完成必须通过协议声明，沉默不算数。每次目标运行都会在会话的 `PLAN.md` 旁边创建一个 `GOAL.yaml` 文件。模型只能改其中一个字段 `status`，而且只能改成 `complete` 或 `blocked`。每轮注入的规则要求模型：

- 声明完成之前，先对照证据自查，例如文件、命令输出和测试结果。
- 不得把目标缩水成更容易的子集。
- 同一个障碍连续存在三轮之后，才能声明 `blocked`，这样一时的阻碍不会让目标就此结束。

还可以给目标设一个 Token 预算，例如 `500k` 或 `2m`，系统在每两轮之间检查一次。预算耗尽时，模型还有最后一个收尾轮，用来总结进展和剩余工作。随后目标以「预算耗尽」结束，而不是假装成功。

在 Web App 里，输入框新增的 **+** 菜单可以挂上目标条，并直接在里面填写预算；斜杠菜单里的 `/goal` 效果相同。每一轮都显示为一条普通的用户消息，下方带「目标 · 第 N 轮」的标注；输入框上方的实时横幅显示目标、轮次，以及 Token 用量与预算的对比。下面的截图就是一次真实循环的第 3 轮，正在验证中。

<img class="dark:hidden" src="/blog-assets/goal-mode-zh-light.webp" alt="目标模式进行中：检查套件目标的第 3 轮，输入框上方的目标横幅实时显示目标、轮次与 token 用量对预算" width="1920" height="1350" />
<img class="hidden dark:block" src="/blog-assets/goal-mode-zh-dark.webp" alt="深色主题下的目标模式：检查套件目标的第 3 轮，输入框上方的目标横幅实时显示目标、轮次与 token 用量对预算" width="1920" height="1350" />

CLI 提供同样的循环：聊天里用 `/goal[:<预算>] <目标>`，`penguin run` 则加上 `--goal`，此时只有目标真正完成，命令才以 0 退出，所以可以把目标直接写进脚本。SDK 仍然只有一个入口：`session.run(input, { goal: { budget } })`。

## 智能体面板

以前，`run_subagent` 会把每个子 Agent 的完整对话内联进父会话的消息流。卡片套卡片，超过两个子 Agent 就没法读了。0.1.4 把子 Agent 的对话移进专门的智能体面板。它和 Workspace 文件面板一样停靠在右侧：在工具栏里开关，拖拽调整宽度；在手机上则以底部抽屉的形式打开。

消息流里，每个子 Agent 只留下一行：头像、Agent 名称、运行中的旋转指示，以及一个琥珀色圆点，子树中任何位置有待审批时就会出现。即使面板关着，也不会错过嵌套的审批。

<img class="dark:hidden" src="/blog-assets/agents-panel-zh-light.webp" alt="智能体面板：调用图以主会话为根、两个具名子智能体带实时用时，下方是选中子会话的流式对话" width="1920" height="1350" />
<img class="hidden dark:block" src="/blog-assets/agents-panel-zh-dark.webp" alt="深色主题下的智能体面板：调用图以主会话为根、两个具名子智能体带实时用时，下方是选中子会话的流式对话" width="1920" height="1350" />

面板顶部是**调用关系**图，每个参与的 Agent 对应一个节点，显示头像、名称、运行状态圆点和用时。子 Agent 运行时，用时实时走秒；结束后定格为实际耗时，所以刷新后的页面和实时页面显示的数字一致。主会话是根节点，连线表示哪个 Agent 派生了哪个。

点击节点，下方的对话就切换到这个子 Agent。它的渲染方式和主消息流相同：子 Agent 自己收到的用户消息也显示在其中，工具卡片实时流式输出，审批按钮在面板里直接可用。

面板的显隐以 Task 为单位。每个新 Task 开始时面板关闭；Task 第一次派生子 Agent 时，面板自动打开一次。之后你手动打开或关闭面板，这个选择会一直保持到这个 Task 结束。调用图默认跟随最新的 Task；点击更早轮次里的子 Agent 行，则钉住那一轮的派生树。

## 0.1.4 还有这些

- 正在生成的回复不会再因为刷新页面而丢失。刷新后，已经输出的部分立刻恢复，并接着往下生成。
- Task 运行期间，对话页头部的费用和用时统计会实时更新，和此前就已实时更新的 Token 计数一样。
- Trace 文件支持导出和导入，一条轨迹可以在不同部署之间迁移。
- 应用现在能显示自己的版本号：用户菜单里的**检查更新**一行会显示当前运行的版本，管理员还能一键原地更新。

完整清单见 [v0.1.4 发布说明](https://github.com/Prism-Shadow/penguin-harness/releases/tag/v0.1.4)。

## 获取

```bash
# Linux / macOS
curl -fsSL https://penguin.ooo/install.sh | sh
```

```powershell
# Windows
irm https://penguin.ooo/install.ps1 | iex
```

也可以在 Node ≥ 24 的环境里用 `npm install -g @prismshadow/penguin-cli` 安装。通过 npm 安装请选 0.1.4：0.1.3 的功能与之相同，但没能发布到 npm。

然后运行 `penguin web`，在**模型仓库**页面添加模型密钥，再给它一个目标。
