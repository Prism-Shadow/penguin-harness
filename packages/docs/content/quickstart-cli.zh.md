---
title: 命令行与 Web App
description: 安装 penguin 命令，配置模型，打开 Web App，在终端或浏览器里跑通第一个 Task。
---

一行命令装好 `penguin`，配置模型，然后在终端或浏览器里跑通第一个 Task。`penguin web` 会在浏览器里打开与[桌面应用](/quickstart-desktop)相同的界面。

## 开始之前

- Linux 或 macOS（x64 或 arm64），或 Windows 10 及以上（x64）且 PowerShell 为 5.1 或更高版本。这些平台的安装器自带官方 Node.js 运行时，机器上不需要另装 Node.js。
- Node.js >= 24：用 npm 安装、从源码构建或在其他平台上使用时才需要。
- 一个模型供应商的 API Key。

## 安装 CLI

按平台运行对应的安装命令。Linux / macOS 与 Windows 的安装器自带 Node.js 运行时；npm 方式要求机器上已经装有 Node.js >= 24。

```bash tab="Linux / macOS"
curl -fsSL https://penguin.ooo/install.sh | sh
```

```powershell tab="Windows"
irm https://penguin.ooo/install.ps1 | iex
```

```bash tab="npm（任意平台）"
npm install -g @prismshadow/penguin-cli
```

验证安装：

```bash
penguin -v
```

命令会输出刚装好的版本号。

离线安装、从源码安装、安装位置、版本固定与 Windows 细节，见本页末尾的[安装参考](#安装参考)。

## 配置模型

PenguinHarness 不内置任何模型凭据，跑第一个 Task 之前要先添加模型。下面这条命令添加 DeepSeek 的 `deepseek-flash`，并设为默认模型：

```bash
penguin config model add --provider deepseek --model-id deepseek-flash --api-key sk-... --set-default
```

之后也可以在 Web App 的**模型库**页面添加模型。

- 模型始终以 `(provider, model_id)` 二元组引用，因此 `--provider` 与 `--model-id` 都必填。PenguinHarness 不会根据模型 id 推断供应商。内置分组见[模型与 Provider](/models)。
- API Key 也可以来自环境变量，但仅限厂商自己的端点。模型条目没有内联 `api_key`、且没有自己的 `base_url`（或 `base_url` 就是厂商官方端点）时，LLM 网关库 AgentHub 会读取 `DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY` 等变量。指向网关或自己服务器的条目需要 `--api-key`。工作目录下的 `.env` 文件会自动加载。

## 启动 Web App

```bash
penguin web
```

服务在 http://127.0.0.1:7364 启动，并自动打开浏览器；加 `--no-open` 则不打开浏览器。`penguin server` 以 headless 方式启动同一个进程。

账号是 `admin`，此时还没有密码。服务端会以带边框的提示打印一条首次登录链接。打开链接，浏览器即以登录状态进入，随后设置密码。

> [!NOTE]
> 首次登录链接在设置密码之前一直有效，最长 30 天。链接可以反复打开，重启服务会打印一条新链接。

界面的整体介绍见 [Web App](/web-app)。

## 跑通第一个 Task

可以在终端里运行单个 Task，也可以开启一段对话。两种方式的底层机制相同，见[终端会话的工作方式](#终端会话的工作方式)。

### 运行单个 Task

```bash
penguin run -m "Create hello.txt containing Hello, Penguin"
```

命令会流式输出 Agent 的执行过程，Task 结束后退出。Task 在当前目录下运行，当前目录就是它的 Workspace。要换一个目录，传入 `--workspace /path`，目录必须已经存在。

### 在终端里对话

```bash
penguin chat
```

每输入一行就发起一个 Task。对话中可以使用：

- `/compact`：压缩上下文。
- `/clear`：开启一个全新的 Session，原来的 Session 之后仍可恢复。
- `/exit` 或 `/quit`：退出。
- Ctrl-C：中断正在运行的 Task。

退出时会打印一条 `penguin chat --resume <sessionId>` 命令，用它可以恢复这个 Session。`--resume` 不带 id 时，恢复这个 Agent 最近的 Session。

### 终端会话的工作方式

`run`、`chat` 以及其他会话命令都是服务端的瘦客户端：本机已有服务端在运行时直接连上它，没有时静默启动一个。连接本机的服务端无需登录，连接规则见 [CLI 参考](/cli)。

这些命令创建的内容同样会出现在 Web App 里；在终端里也可以用 `penguin ls`、`penguin logs`、`penguin input` 继续操作这些会话。全部命令与选项见 [CLI 参考](/cli)。

## 安装参考

上面的安装命令覆盖了绝大多数情况，本节是其余的选项与细节。

### 安装脚本细节

在 Linux 和 macOS 上，脚本会下载对应平台的安装包 `penguin-{linux,darwin}-{x64,arm64}.tar.gz`。这是标准安装包，里面封入了程序负载（含官方 Node.js 运行时）、负载的 SHA256 校验值，以及这份安装器本身。脚本先对照发布的 `.sha256` 校验下载的文件，再校验封入的负载校验值，之后才开始暂存安装。在 Windows 上，安装器下载的是 `penguin-win32-x64.zip`，同样自带运行时。

其他 POSIX 平台不会自动回退：脚本会退出，提示先安装 Node.js >= 24，再加上 `--universal` 重新运行，改用不含运行时的 `penguin-universal.tar.gz` 安装包。Windows 有自己的安装器，不使用 `--universal`。

### 下载来源与版本

稳定入口默认使用 `PENGUIN_DOWNLOAD_SOURCE=auto`。它通过 OSS 上不可变的版本目录确定目标版本，而且只认已经完整上传并通过验证的版本；元数据不可用时，回退到对应的 GitHub Release。

安装包实际从哪个来源下载，由实测决定，而不是预设：

- 安装器先对 GitHub 上的测速文件计时，速度达到 256 KB/s 就继续用 GitHub。
- 只有低于这个速度，才会测量 OSS 镜像，并且镜像要快 1.5 倍以上才会切换。只快一点的镜像不值得为它支付带宽费用，GitHub 下载即使慢，也能断点续传。

设置 `PENGUIN_DOWNLOAD_SPEED_PROBE=0` 可以跳过测速，把 `PENGUIN_DOWNLOAD_SOURCE` 设为 `oss` 或 `github` 可以强制指定来源。安装器的常规输出只写明来源，不打印镜像的完整 URL。

`penguin.ooo` 稳定入口每次运行时都会解析当前的稳定版本。从 GitHub 或 OSS 某个版本的 Release 里单独下载的安装脚本，会写入所属 Release 的 tag，默认安装同一版本，从而保证安装器与安装包格式相互匹配。要改用其他版本，设置 `PENGUIN_VERSION`；在 POSIX 系统上也可以传入 `--version`。在 Windows 上，先设置环境变量，再运行安装器：

```powershell
$env:PENGUIN_VERSION = "vX.Y.Z"; irm https://penguin.ooo/install.ps1 | iex
```

### 离线安装

离线安装使用的就是在线安装的 Release 文件，没有单独的离线包。

1. 在一台能联网的电脑上，下载与目标电脑匹配的文件：`penguin-<target>.tar.gz`，Windows 为 `penguin-win32-x64.zip`。
2. 把这一个文件传到目标电脑上并解压。
3. 在解压出的目录里运行安装器。Windows 上双击 `install.cmd`，或运行 `.\install.ps1`；Linux 和 macOS 上运行 `./install.sh`。

```powershell tab="Windows"
.\install.ps1
```

```bash tab="Linux / macOS"
./install.sh
```

解压后的目录里同时有安装器、程序负载（`payload.tar.gz` / `payload.zip`）和负载的 `.sha256`。安装器会自己找到同目录下的负载，始终校验封入的校验值，全程不发起网络请求，因此不需要另外传输校验文件。

也可以显式指定本地文件：`install.sh --archive <file>`、`PENGUIN_ARCHIVE=<file>`、`install.ps1 -ArchivePath <file>` 或 `$env:PENGUIN_ARCHIVE`。这几种方式都接受 Release 安装包、其中的负载，以及 0.1.6 之前的旧版程序压缩包。

### 从源码安装

从源码构建需要 Node.js >= 24 与 pnpm：

```bash
git clone https://github.com/Prism-Shadow/penguin-harness.git
cd penguin-harness
pnpm install && pnpm build
```

构建完成后，可以在仓库内用 `pnpm penguin <args>` 以开发方式运行，也可以使用全局链接的 `penguin` 命令。

开发入口（`pnpm penguin`、`pnpm dev`、`pnpm desktop`）默认使用独立的数据目录 `~/.penguin/dev-data`，全局链接或正式安装的 `penguin` 仍使用 `~/.penguin/data`，设置 `PENGUIN_HOME` 可以覆盖。桌面应用的开发运行还使用独立的应用标识（`PenguinHarness-Dev`），因此可以和已安装的桌面应用同时运行，互不冲突。

### 安装位置与选项

| 项目 | 说明 |
| --- | --- |
| 安装目录 | 默认为 `~/.penguin`，可用环境变量 `PENGUIN_INSTALL_DIR` 覆盖 |
| 命令入口 | 符号链接 `~/.local/bin/penguin`。如果 `~/.local/bin` 不在 `PATH` 中，脚本会给出提示 |
| 版本 | 环境变量 `PENGUIN_VERSION=vX.Y.Z`，或脚本参数 `--version vX.Y.Z`。稳定入口默认安装最新的 Release，某个版本的 Release 安装器默认安装自身的 tag |
| 下载来源 | `PENGUIN_DOWNLOAD_SOURCE=auto`（默认）、`oss` 或 `github`。`auto` 会对测速文件计时，除非 OSS 镜像明显更快，否则保持免费的 GitHub 下载，并可回退到另一个来源的同一版本。`PENGUIN_DOWNLOAD_SPEED_PROBE=0` 跳过测速 |
| 本地压缩包 | `PENGUIN_ARCHIVE=<file>` 或 `--archive <file>`。接受 Release 安装包（凭封入的负载校验值自行校验），或旁边带有 `<file>.sha256` 的负载、旧版程序压缩包。重命名过的旧版文件可以使用平台标准文件名的 `.sha256` |
| 完整性校验 | 始终开启。在线下载对照发布的 `.sha256` 校验，安装包里的负载对照包内封入的校验值校验 |
| 升级 | 重新运行安装脚本，文件以原子方式替换 |

脚本参数写在 `sh -s --` 之后，例如 `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal`。

### Windows 细节

| 项目 | 说明 |
| --- | --- |
| 安装目录 | 默认为 `%USERPROFILE%\.penguin`，可用环境变量 `PENGUIN_INSTALL_DIR` 覆盖 |
| 命令入口 | 启动器 `bin\penguin.cmd`。特意不提供 `.ps1` 启动器：批处理文件不受 PowerShell 执行策略限制，所以在默认的 Restricted 策略下 `penguin` 也能运行。安装器会把 `%USERPROFILE%\.penguin\bin` 加入**用户** Path 并广播这一变更。之后请**新开一个终端窗口**，已在运行的终端即使新开标签页，也仍沿用旧的 Path |
| 版本固定 | 运行安装器之前设置 `$env:PENGUIN_VERSION = "vX.Y.Z"` |
| 本地压缩包 | `$env:PENGUIN_ARCHIVE = "<file>"` 或 `-ArchivePath <file>`。接受 Release 安装包（凭封入的负载校验值自行校验），或旁边带有 `<file>.sha256` 的负载、旧版 zip。重命名过的旧版文件可以使用 `penguin-win32-x64.zip.sha256` |
| 完整性校验 | 始终开启。在线下载对照发布的 `.sha256` 校验，安装包里的负载对照包内封入的校验值校验 |
| 升级 | 重新运行安装器。它只替换 `bin`/`lib`/`web`/`node`，从不改动 `data` |

Windows 上还有以下不同：

- **Agent shell**：Agent 的 `exec_command` 在 POSIX shell 中运行，这样面向 POSIX 编写的 Skill 可以照常工作。shell 的选择顺序是：首先是 PATH 上的 `bash`，优先使用它，因为你自己安装的 [Git for Windows](https://gitforwindows.org/) 带有完整的 MSYS 工具集；其次是**内置 bash**，Windows zip 在 `git\` 下自带 MinGit，没有安装 Git for Windows 的机器也能得到 POSIX shell、约六十个核心工具和 `git.exe`；最后是 PowerShell（先 `pwsh`，后 `powershell`）。只有 npm 安装不带任何内置组件，才会用到 PowerShell 这一兜底。环境变量 `PENGUIN_SHELL` 可以强制指定 shell，Session 的系统提示词会告诉模型当前使用的是哪个 shell。内置 shell 的许可信息见 [THIRD-PARTY-NOTICES.md](https://github.com/Prism-Shadow/penguin-harness/blob/main/THIRD-PARTY-NOTICES.md)。
- **Ctrl-C**：向运行中的命令会话发送 Ctrl-C（`input_command` 传入 `"\u0003"`），会终止整棵命令会话进程树，而不是中断前台命令。Windows 无法把控制台 Ctrl-C 投递给通过管道连接的子进程，中断因此退化为强制结束整棵进程树。
- **就地更新**：Windows 暂不支持 `penguin update`，升级请重新运行安装器。
- **配置文件权限**：在 POSIX 系统上，配置文件与凭据文件以 `0600`（仅属主可读写）权限写入。Windows 没有这类权限位，这些文件遵循你用户目录的默认 NTFS ACL。
- **「running scripts is disabled」**：PowerShell 报这个错误、拒绝运行 `penguin` 时，PowerShell 拦下的其实是某个 `penguin.ps1` 启动器。它可能来自 0.1.6 之前的旧安装，重新运行安装器即可（升级会替换 `bin\` 并删除它）；也可能是 npm 全局安装生成的，这时可以显式调用 `penguin.cmd`，或用 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 允许运行本地脚本。安装包本身只带 `penguin.cmd`，在任何执行策略下都能运行。

### 数据目录

数据目录默认为 `~/.penguin/data`（Windows 为 `%USERPROFILE%\.penguin\data`）。它位于安装目录之下，但安装和升级都不会改动它。设置环境变量 `PENGUIN_HOME` 可以改用其他目录。模型配置、Session 记录等数据在升级后都会保留。

### 已发布的 npm 包

| 包 | 说明 |
| --- | --- |
| `@prismshadow/penguin-cli` | 命令行工具，提供 `penguin` 命令 |
| `@prismshadow/penguin-core` | SDK，用代码创建 Agent 与 Session |
| `@prismshadow/penguin-server` | Web 服务，含 Web App 的静态资源 |
| `@penguinharness/*` | 内置插件，每个插件一个包（Skill 与会话钩子），由 core 加载 |

所有包均以 Apache-2.0 许可证发布。

## 下一步

- [Web App](/web-app)：在浏览器里使用 PenguinHarness。
- [CLI 参考](/cli)：全部命令与选项。
- [更新 PenguinHarness](/updates)：查看版本并升级。
- [SDK](/quickstart-sdk)：把引擎嵌入自己的程序。
