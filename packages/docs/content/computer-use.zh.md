---
title: 电脑操作
description: 让 Agent 用 penguin computer 查看并操作电脑桌面上的应用——基于 agent-desktop 的插件，支持 macOS、Windows 与 Linux。
---

**电脑操作**（Computer Use）插件让 Agent 在运行 PenguinHarness 的这台电脑的桌面应用里干活。Agent 在 shell 中运行 `penguin computer`：把应用窗口读成无障碍树，经各元素的无障碍接口点击、输入、选择与等待，截取窗口截图，启动或退出应用。底层是 [agent-desktop](https://github.com/vercel-labs/agent-desktop)，它使用各系统的无障碍接口——macOS 的辅助功能、Windows 的 UI Automation、Linux 的 AT-SPI。插件附带的 `computer-use` 技能教 Agent 先观察、再操作、然后核对结果。

网站请改用[内置浏览器](/builtin-browser)。

## 开始之前

- 电脑操作作用于运行服务端的那台机器的桌面，以服务端自己的用户身份运行。用桌面应用时就是你的电脑；服务端在另一台机器上时，就是那台机器的桌面。
- 它不受 Agent 沙盒约束：打开之后，Agent 能做那个桌面允许它做的事。每条 `penguin computer` 命令仍是 Agent 执行的 shell 命令，照常受审批模式约束。
- 安装插件与修改其设置由管理员进行。
- **谁能使用。** 缺省只有管理员，以及由管理员驱动对话的 Agent，可以运行 `penguin computer`；Project 还须在本服务端启用了本插件。在单人使用的桌面上你就是管理员，你的 Agent 可以使用。管理员可以在卡片上打开**允许成员使用**——这等于把这台机器的桌面会话交给已启用本插件的 Project 的所有成员控制，与允许他们在这台机器上运行程序无异。其他人的命令一律被拒绝：未允许成员使用时为 `admin_only`，Project 未启用本插件时为 `plugin_not_enabled`。
- **Agent 算作谁。** Agent 的 shell 带着服务端的本机 API token，它代表管理员。对 `penguin computer`，服务端改把 Agent 算作其对话此刻正在处理其消息的那位已登录者，并检查此人对该 Project 的访问权。定时任务的运行算作以自己的登录保存该定时任务的人，直到 Agent 或其他人改动了它的文件。没有指明对话的 Agent 调用被拒绝为 `session_required`；没有这样的运行在进行——空闲、无人署名的定时任务、Agent API、公司模式、目标模式，或被他人插话过的运行——时被拒绝为 `driver_unknown`。对登录的人，这条规则没有例外；对 Agent 只是尽力而为：Agent 可以指明它能触及的 Project 中的另一个对话，借用那里正在进行的运行的发起者，真正的隔离要等每个对话有了自己的凭据。

> **Agent 使用电脑操作时，不要在这个桌面上开着 Web App。** 使用电脑操作的 Agent 能操作这个桌面上的任何窗口，包括显示 PenguinHarness Web App 的浏览器标签页，并可能在那里批准自己的请求或修改设置。只有桌面应用自己的窗口受到保护。

## 安装

1. 打开**设置 › 插件**，在插件市场中找到**电脑操作**，安装到服务端。
2. 插件从「插件源」所选的 npm registry 下载 agent-desktop 1.3.1（约 16 MB），按插件钉死的摘要校验，只把本机的程序保存在数据根的 `cache/computer-use/` 下。设置 › 插件中的**电脑操作**卡片显示进度。
3. 在 Agent 的**插件**标签页把插件装到该 Agent 上，Agent 即获得 `computer-use` 技能，该 Project 也随之在本服务端启用了本插件。

电脑操作有自己的版本号，与 PenguinHarness 的版本分开：从 0.1.0 起，只在插件本身改动时变化。

从插件市场（或 zip）安装插件会在服务端所在的机器上运行 npm，而桌面应用目前不自带 npm：没有 npm 的机器上，安装会说明这一点。下载 agent-desktop 本身不需要 npm。它先试「插件源」中选择的 registry，在「插件镜像」中选了 **npm registry 镜像**时再试该镜像；只写在 `.npmrc` 文件里的镜像不读取。网速慢也没关系：一个地址只有在 30 秒内没有任何数据时才放弃，整个下载最长 30 分钟。移除插件会停止正在进行的下载。

下载失败时，卡片会说明，错误原文放在详情里：在 **插件源** 中换一个 registry 或加入 npm registry 镜像，然后点 **重试**。无法访问任何 npm registry 的机器，可以使用以其他方式安装的 agent-desktop 程序：在卡片高级设置的 **agent-desktop 程序路径**中填写它的绝对路径。

## 授予系统所需的权限

电脑操作卡片列出这台机器还缺什么；改动之后点**重新检查**。

| 系统 | 需要什么 |
| --- | --- |
| macOS 13 及以上 | 为 PenguinHarness 授予**辅助功能**权限——从终端启动的服务端则授予那个终端；截图另需**屏幕录制**。卡片上的**打开系统设置**会打开对应位置，并指明应授权的应用。 |
| Windows 10 1809 及以上 | 服务端运行在你已登录的桌面上：不能以服务、经 SSH 或在 Session 0 中运行，也不能处于锁屏之后。以管理员身份运行的应用只能读取、不能操作。需要安装 Visual C++ 运行库。 |
| Linux（glibc 2.35 及以上） | 一个桌面会话：显示、会话总线与无障碍总线，以及窗口管理器。Wayland 下没有指针输入，第一次截图需要你同意，不支持 wlroots 合成器。 |

## Agent 能做什么

缺省情况下，Agent 可以：

- 读取窗口：`snapshot`、`find`、`get`、`is`、`wait`、`screenshot`；
- 经无障碍接口操作元素：`click`、`type`、`set-value`、`select`、`toggle`、`check`、`expand`、`scroll-to` 等；
- 移动、缩放、最小化与聚焦窗口，启动与退出应用，写入剪贴板；
- 向它指明的应用发送按键。

技能要求 Agent 在启动或退出应用、移动窗口、写入剪贴板之前，以及在付款、发送、删除或修改设置之前，先征得你的同意。

每条读取或操作窗口的命令都必须指明应用，Agent 因此不会误操作恰好处于焦点的窗口。电脑操作从不操作 PenguinHarness 自身——桌面应用的窗口、服务端，以及它们启动的任何程序。

### 与你共用桌面

Agent 和你在同一块屏幕上工作，插件因此让它不妨碍你：

- **用户操作时暂停（默认关闭）。** 开启后，你最近一次键盘或鼠标输入不到 3 秒时，作用于桌面的命令一律被拒绝（`user_active`），并提示 Agent 先问你；读取屏幕仍然可以。可在卡片上开启 **用户操作时暂停**。它需要读取你的输入空闲时间：macOS 与 Windows 上总能读取；Linux 上 X11 可以（借助 `xprintidle`，或大多数桌面都带的 Python 与 libXss），Wayland 不行——这时卡片会说明无法暂停，也不会暂停。
- **按键只发往当前激活的窗口。** `press` 的按键总是发往拥有焦点的窗口，因此 Agent 指明的窗口不是焦点窗口时会被拒绝（`window_not_focused`），并告诉 Agent 先征得你同意，再用 `focus-window` 把哪个窗口调到前面。它从不悄悄抢焦点。
- `penguin computer status` 会告诉 Agent 当前的焦点窗口、各显示器及其位置，以及你已空闲多久，让它知道你何时在操作。

### 需要你允许的操作

| 设置 | 允许 |
| --- | --- |
| **允许物理输入** | 真实的鼠标与键盘：按坐标点击、悬停、拖拽、双击、切换焦点与滚轮。它们会移动你的指针，并把键盘焦点从你正在做的事情上抢走。关闭时，Agent 只经各元素的无障碍接口操作，不碰指针，但并非每个应用都能这样驱动——部分 Electron 与画布类应用只响应真实输入。 |
| **允许读取剪贴板** | `clipboard-get`：最近复制的内容，可能是密码。 |
| **允许读取通知** | `list-notifications`：来自所有应用的通知。 |

三项缺省都关闭，**允许成员使用**也是（见上文「开始之前」）。以下一律不提供：agent-desktop 的沙盒、MCP 服务器、光标浮层、会话与追踪、操作通知、调试截图，以及带参数、环境变量或工作目录启动应用。

`launch` 只接受已安装应用的名称，从不接受路径、脚本或以文件名给出的应用包，因此无法运行 Agent 写到磁盘上的程序，也无法打开调试端口：

| 系统 | `launch` 接受什么 |
| --- | --- |
| Linux | 系统应用目录（`/usr/share/applications` 及 `XDG_DATA_DIRS` 中其余服务端用户既不拥有、也不能写入的目录）里某个桌面条目的 id、名称或命令，如 `gnome-calculator`、`Calculator` 或 `org.gnome.Calculator`。命令只在恰有一个条目运行它时才算数，且从不算 `sh` 之类的 shell 或解释器。条目的程序也须在系统目录中：启动时的 `PATH` 只含服务端 `PATH` 里的系统目录。你自己目录里的条目、隐藏的条目、在终端中运行的条目与终端模拟器不提供。 |
| Windows | System32 或 Windows 目录中的程序，如 `notepad` 或 `notepad.exe`。 |
| macOS | 应用的名称或 bundle ID，如 `Calculator` 或 `com.apple.calculator`。名称由 macOS 自己解析，可能包括你可写的文件夹（如 `~/Applications`）中的应用。 |

向已经打开的终端应用输入文字仍然可行；不要为你不放心的 Agent 留着打开的终端。

Agent 须按 `penguin computer list-apps` 打印的名称逐字指明应用；bundle ID、名称的一部分，或 `list-windows` 没有列出的窗口一律被拒绝，插件因此总能确定一条命令作用于哪个进程。命令运行之后，agent-desktop 报告它读取或操作的窗口会再检查一次，来自 PenguinHarness 自身窗口的结果一律丢弃。

要整体停用，关闭卡片上的**电脑操作**开关：此后所有命令都被拒绝。

## 数据在哪里

移除插件不会删除它保存在服务端数据根（缺省 `~/.penguin/data`）中的内容：

- `cache/computer-use/`——下载的 agent-desktop（约 16 MB）；
- `computer-use/state/`——各个对话的快照，其中含有从屏幕读到的文字；一个对话的文件夹 14 天未用即被删除。

移除插件后如需清除，请手动删除这两个文件夹。

## 从命令行驱动

`penguin computer` 接受 agent-desktop 的命令与参数，并打印 agent-desktop 的 JSON 信封：

```bash
penguin computer status
penguin computer snapshot --app "Calculator" -i --compact
penguin computer click @s8f3k2p9:e12
penguin computer type @s8f3k2p9:e3 "hello"
penguin computer wait --element @s8f3k2p9:e9 --predicate actionable
penguin computer screenshot --app "Calculator" calc.png --out-dir shots
```

- `status` 在 `data.penguin` 下附上插件自己的状态：是否开启、agent-desktop 的安装情况（`install`）、各项设置、本机的检查项（`checks`），以及此刻的桌面（`desktop`）——焦点窗口、各显示器及其范围、用户的输入空闲秒数（读不到时为 `null`）。电脑操作无法运行时以退出码 1 结束。
- 截图保存在运行命令的目录（或 `--out-dir`），不会覆盖已有文件。
- `--text-file <file>` 从文件读取 `type`、`set-value` 或 `clipboard-set` 的文本，秘密因此不会出现在命令行上。
- `penguin computer <command> --help` 打印 agent-desktop 对单条命令的帮助。
- 插件拒绝的操作输出一行 `error: <代码>: <原因>`，退出码为 1：如 `policy_refused`、`user_active`（你正在使用电脑）或 `window_not_focused`（所指的窗口不是焦点窗口）。

ref（`@s8f3k2p9:e12`）属于产生它的那次快照，也属于做快照的那个对话：窗口变化之后请重新快照。
