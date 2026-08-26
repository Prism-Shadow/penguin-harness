---
title: 命令行与 Web 应用
description: 一行命令装出 penguin，配置模型，用 penguin web 打开浏览器界面——附完整安装参考。
---

一行命令装出 `penguin`，再用 `penguin web` 在浏览器里打开与[桌面端应用](/quickstart-desktop)相同的界面。在线安装器自带官方 Node.js 运行时，解压即用，本机无需安装 Node。

## 安装

选择你的平台。前两种自带 Node.js 运行时；npm 方式需要本机已有 Node.js >= 24。

```bash tab="Linux / macOS"
curl -fsSL https://penguin.ooo/install.sh | sh
```

```powershell tab="Windows"
irm https://penguin.ooo/install.ps1 | iex
```

```bash tab="npm（任意平台）"
npm install -g @prismshadow/penguin-cli
```

安装完成后验证：

```bash
penguin -v
```

离线安装、源码安装、安装目录、版本固定与 Windows 细节，见本页末尾的[安装参考](#安装参考)。

## 配置模型

可以在 Web UI 的模型页完成，也可以用 CLI：

```bash
penguin config model add --provider deepseek --model-id deepseek-v4-flash --api-key sk-... --set-default
```

- 模型引用始终是 `(provider, model_id)` 二元组，因此 `--provider` 与 `--model-id` 均为必填——Provider 绝不由模型 id 推断。内置分组见[模型与 Provider](/models)。
- API Key 也可以来自环境变量：当模型条目没有内联 api_key 时，LLM 网关库 AgentHub 会读取 `DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY` 等变量；工作目录下的 `.env` 会被自动加载。

## 启动 Web App

```bash
penguin web
```

服务运行在 http://127.0.0.1:7364 并自动打开浏览器（`--no-open` 跳过）。账号是 `admin`，此时它还没有密码：服务端会以边框提示打印一条首次登录链接，打开即以登录态进入，随后设置密码即可。在密码被设置之前该链接一直有效（上限 30 天，重启会打印新的），可以重复打开。`penguin server` 启动同一进程的 headless 版本。

界面的完整说明见 [Web App 指南](/web-app)。

## 单次运行

```bash
penguin run -m "创建 hello.txt，内容为 Hello, Penguin"
```

Workspace 默认为当前目录，可用 `--workspace /path` 指定；目标目录必须已存在。

## 交互式对话

```bash
penguin chat
```

- 每输入一行即发起一个 Task。
- `/compact` 压缩上下文；`/clear` 开启全新 Session（原会话仍可恢复）；`/exit` 或 `/quit` 退出；Ctrl-C 中断正在运行的 Task。
- 退出时会打印 `penguin chat --resume <sessionId>` 提示，用于恢复本次 Session；`--resume` 不带 id 时恢复该 Agent 最近的 Session。

完整命令与选项见 [CLI 参考](/cli)。

## 安装参考

上面的三条安装命令覆盖绝大多数情况；以下是其余选项与细节。

### 系统要求

- Linux / macOS（x64 或 arm64）：安装脚本提供内置官方 Node.js 运行时的平台压缩包，解压即用，无需本机安装 Node。
- Windows 10 及以上（x64），PowerShell 5.1+：Windows 安装器提供内置运行时的 `penguin-win32-x64.zip`，同样无需本机安装 Node。
- 其他平台，或通过 npm / 源码安装：需要系统 Node.js >= 24。

### 安装脚本细节

脚本按平台下载 `penguin-{linux,darwin}-{x64,arm64}.tar.gz`——即标准安装包：包内封入程序负载（捆绑官方 Node.js 运行时）、负载的 SHA256 校验文件与同一个安装器。下载后先对照 Release 发布的 `.sha256` 校验外层，再校验包内封入的负载 checksum，然后才进入暂存安装。其他 POSIX 平台**不会自动回退**：脚本会退出并提示先安装 Node.js >= 24、再携带 `--universal` 重新执行，改用不含运行时的 `penguin-universal.tar.gz` 安装包（Windows 使用专属安装器，而不是 `--universal`）。

稳定入口默认使用 `PENGUIN_DOWNLOAD_SOURCE=auto`：先经已完整上传并验证的 OSS 不可变版本目录确定目标版本，元数据不可用时回退到同一版本的 GitHub Release。至于由哪个源提供安装包，则由实测决定，而非预设：安装器先对 GitHub 上的测速文件计时，达到 256 KB/s 即保持 GitHub；只有低于该值时才测量 OSS 镜像，且仅当镜像快出 1.5 倍以上才切换——仅快一点的镜像不值得其带宽成本，而较慢的 GitHub 下载仍可续传。设置 `PENGUIN_DOWNLOAD_SPEED_PROBE=0` 可跳过测速，设置 `PENGUIN_DOWNLOAD_SOURCE` 为 `oss` 或 `github` 可强制指定来源。安装器只显示来源名称，不在常规输出中打印镜像的完整 URL。

`penguin.ooo` 稳定入口每次执行时都会解析当前稳定版本。从 GitHub 或 OSS 的版本化 Release 中直接下载的独立安装脚本会写入该 Release tag，并默认安装同一版本，确保安装器与安装包格式匹配；如需覆盖，可显式设置 `PENGUIN_VERSION`（POSIX 也可使用 `--version`）。Windows 上固定版本，在运行安装器前设置环境变量：

```powershell
$env:PENGUIN_VERSION = "vX.Y.Z"; irm https://penguin.ooo/install.ps1 | iex
```

### 离线安装

离线安装使用与在线安装相同的 Release 制品——不再有单独的离线包。先在可联网电脑上下载与目标电脑匹配的那一个文件（`penguin-<target>.tar.gz`，Windows 为 `penguin-win32-x64.zip`），传输后解压一次。

Windows 上双击 `install.cmd`，或执行：

```powershell
.\install.ps1
```

Linux / macOS 上执行：

```bash
./install.sh
```

解压后的目录同时包含安装器、程序负载（`payload.tar.gz` / `payload.zip`）与负载的 `.sha256`；安装器会自行找到同目录负载，始终校验包内封入的 checksum，且不发起任何网络请求——无需另外传输校验文件。也可以显式指定本地文件：`install.sh --archive <file>`、`PENGUIN_ARCHIVE=<file>`、`install.ps1 -ArchivePath <file>` 或 `$env:PENGUIN_ARCHIVE`——Release 安装包、其内部负载或 0.1.6 之前的旧版程序压缩包均可。

### 源码安装

需要 Node.js >= 24 与 pnpm：

```bash
git clone https://github.com/Prism-Shadow/penguin-harness.git
cd penguin-harness
pnpm install && pnpm build
```

构建完成后，在仓库内用 `pnpm penguin <args>` 作为开发入口运行，或使用全局链接的 `penguin` 命令。开发入口（`pnpm penguin`、`pnpm dev`、`pnpm desktop`）默认使用独立数据根目录 `~/.penguin/dev-data`，全局链接或安装的 `penguin` 仍使用 `~/.penguin/data`；可通过环境变量 `PENGUIN_HOME` 覆盖。桌面开发运行还会使用独立的应用标识（`PenguinHarness-Dev`），因此可以与已安装的桌面版同时运行、互不冲突。

### 安装位置与选项

| 项目 | 说明 |
| --- | --- |
| 安装目录 | 默认 `~/.penguin`，可用环境变量 `PENGUIN_INSTALL_DIR` 覆盖 |
| 命令入口 | 创建符号链接 `~/.local/bin/penguin`（若 `~/.local/bin` 不在 PATH 上，脚本会给出提示） |
| 版本选择 | 环境变量 `PENGUIN_VERSION=vX.Y.Z`，或脚本参数 `--version vX.Y.Z`；稳定入口默认安装最新 Release，版本化 Release 安装器默认安装自身 tag |
| 下载来源 | `PENGUIN_DOWNLOAD_SOURCE=auto`（默认）、`oss` 或 `github`；自动模式对测速文件计时，除非 OSS 镜像明显更快，否则保持免费的 GitHub 下载，并按同一版本回退到另一个源（`PENGUIN_DOWNLOAD_SPEED_PROBE=0` 可跳过测速） |
| 本地压缩包 | `PENGUIN_ARCHIVE=<file>` 或 `--archive <file>`；接受 Release 安装包（凭包内封入的负载 checksum 自校验），或旁边带 `<file>.sha256` 的负载 / 旧版程序压缩包（重命名的旧版文件可用平台标准名称的 `.sha256`） |
| 完整性校验 | 始终进行：在线下载对照发布的 `.sha256` 校验，安装包负载对照包内封入的 checksum 校验 |
| 升级 | 重新执行安装脚本即可，文件原子替换 |

脚本参数写在 `sh -s --` 之后，例如 `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal`。

### Windows 细节

| 项目 | 说明 |
| --- | --- |
| 安装目录 | 默认 `%USERPROFILE%\.penguin`，可用环境变量 `PENGUIN_INSTALL_DIR` 覆盖 |
| 命令入口 | `bin\penguin.cmd` 启动器（特意不带 `.ps1` 启动器——批处理不受 PowerShell 执行策略限制，默认 Restricted 策略下 `penguin` 也能直接运行）；安装器会把 `%USERPROFILE%\.penguin\bin` 加入**用户** Path 并广播变更——请**新开一个终端窗口**（已开终端的新标签页仍沿用旧 Path） |
| 版本固定 | 运行安装器前设置 `$env:PENGUIN_VERSION = "vX.Y.Z"` |
| 本地压缩包 | `$env:PENGUIN_ARCHIVE = "<file>"` 或 `-ArchivePath <file>`；接受 Release 安装包（凭包内封入的负载 checksum 自校验），或旁边带 `<file>.sha256` 的负载 / 旧版 zip（重命名的旧版文件可用 `penguin-win32-x64.zip.sha256`） |
| 完整性校验 | 始终进行：在线下载对照发布的 `.sha256` 校验，安装包负载对照包内封入的 checksum 校验 |
| 升级 | 重新运行安装器；只替换 `bin`/`lib`/`web`/`node`，绝不触碰 `data` |

- **Agent shell**：Windows 上 `exec_command` 在 POSIX shell 中执行，以兼容面向 POSIX 编写的技能生态。选择顺序为：PATH 上的 `bash`（你自己安装的 [Git for Windows](https://gitforwindows.org/)，优先，因为它带完整的 MSYS 工具集）；其次是**内置 bash**——Windows zip 在 `git\` 下自带 MinGit，因此未安装 Git for Windows 的机器同样有 POSIX shell、约六十个核心工具和 `git.exe`；最后才是 PowerShell（先 `pwsh` 后 `powershell`）。只有经 npm 安装（不含内置包）才会走到 PowerShell。环境变量 `PENGUIN_SHELL` 可强制指定；会话的系统提示词会告知模型当前 shell。内置 shell 的许可信息见 [THIRD-PARTY-NOTICES.md](https://github.com/Prism-Shadow/penguin-harness/blob/main/THIRD-PARTY-NOTICES.md)。
- **Ctrl-C 语义**：Windows 上向运行中的命令会话发送 Ctrl-C（`input_command` 传 `"\u0003"`）会终止整棵命令会话进程树，而不是中断前台命令——Windows 无法向管道子进程投递控制台 Ctrl-C，中断因此退化为整树强杀。
- **就地更新**：`penguin update` 暂不支持 Windows——升级请重新运行上面的安装器。
- **配置文件权限**：POSIX 上配置/凭据文件以 `0600`（仅属主可读写）写入；Windows 没有对应的权限位，文件遵循你用户目录的默认 NTFS ACL。
- 如果 PowerShell 提示 "running scripts is disabled" 而无法运行 `penguin`，被拦下的是某个 `penguin.ps1` 启动器——来自 0.1.6 之前的旧安装（重新运行安装器即可：升级会整体替换 `bin\` 并移除它），或来自 npm 全局安装生成的 shim（可显式调用 `penguin.cmd`，或用 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 允许本地脚本）。安装包本身只带 `penguin.cmd`，任何执行策略下都能运行。

### 数据目录

数据目录默认位于 `~/.penguin/data`（Windows 为 `%USERPROFILE%\.penguin\data`），在安装主目录之下，但安装与升级都不会改动它，可用环境变量 `PENGUIN_HOME` 覆盖。模型配置、Session 记录等在升级后均会保留。

### 已发布的 npm 包

| 包 | 说明 |
| --- | --- |
| `@prismshadow/penguin-cli` | 命令行工具，提供 `penguin` 命令 |
| `@prismshadow/penguin-core` | SDK，程序化创建 Agent 与 Session |
| `@prismshadow/penguin-server` | Web 服务，含 Web UI 静态资源 |
| `@prismshadow/penguin-skills` | Skill 集合 |

全部包以 Apache-2.0 协议发布。

## 下一步

- [Web App 指南](/web-app)：在浏览器中使用 PenguinHarness。
- [CLI 参考](/cli)：完整命令与选项。
- [SDK](/quickstart-sdk)：把引擎嵌进自己的程序。
