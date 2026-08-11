---
title: 安装
description: 通过安装脚本、npm 或源码安装 PenguinHarness。
---

## 系统要求

- Linux / macOS（x64 或 arm64）：安装脚本提供内置官方 Node.js 运行时的平台压缩包，解压即用，无需本机安装 Node。
- 离线 profile：系统已安装带 `venv` 的 CPython 3.9–3.13；Linux 要求 glibc 2.17 或更高，不支持 musl/Alpine。
- Windows 10 及以上（x64），PowerShell 5.1+：Windows 安装器提供内置运行时的 `penguin-win32-x64.zip`，同样无需本机安装 Node。
- 其他平台，或通过 npm / 源码安装：需要系统 Node.js >= 24。

## 脚本安装（推荐）

在 Linux / macOS 上执行：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
```

安装与当前原生平台匹配的离线 profile（包含 `word-docx`、`powerpoint-pptx` 和 `pdf-tools`）：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh -s -- --offline
```

默认仍按平台下载标准 `penguin-{linux,darwin}-{x64,arm64}.tar.gz`，现有安装行为不变。`--offline` 会选择对应的 `penguin-offline-{linux,darwin}-{x64,arm64}.tar.gz`；它不能与 `--universal` 或 `--archive` 组合。每个包都封入程序负载（捆绑官方 Node.js 运行时）、负载的 SHA256 校验文件与同一个安装器。下载后先对照 Release 发布的 `.sha256` 校验外层，再校验包内封入的负载 checksum，然后才进入暂存安装。其他 POSIX 平台**不会自动回退**：脚本会退出并提示先安装 Node.js >= 24、再携带 `--universal` 重新执行，改用不含运行时的 `penguin-universal.tar.gz` 安装包（Windows 使用下方专属安装器，而不是 `--universal`）。

稳定入口默认使用 `PENGUIN_DOWNLOAD_SOURCE=auto`：优先选择已完整上传并验证的 OSS 不可变版本目录；元数据或下载不可用时，回退到同一版本的 GitHub Release。也可以将该变量设为 `oss` 或 `github` 来强制指定来源。安装器只显示来源名称，不在常规输出中打印镜像的完整 URL。

`penguin.ooo` 稳定入口每次执行时都会解析当前稳定版本。从 GitHub 或 OSS 的版本化 Release 中直接下载的独立安装脚本会写入该 Release tag，并默认安装同一版本，确保安装器与安装包格式匹配；如需覆盖，可显式设置 `PENGUIN_VERSION`（POSIX 也可使用 `--version`）。

在 Windows（PowerShell）上执行：

```powershell
irm https://penguin.ooo/install.ps1 | iex
```

安装 Windows x64 离线 profile：

```powershell
& ([scriptblock]::Create((irm https://penguin.ooo/install.ps1))) -Offline
```

如需固定版本，先设置环境变量：

```powershell
$env:PENGUIN_VERSION = "vX.Y.Z"; irm https://penguin.ooo/install.ps1 | iex
```

安装完成后验证：

```bash
penguin -v
```

### 离线安装

离线安装使用与在线安装相同的 Release 制品。先在可联网电脑上下载与目标电脑匹配的文件：轻量标准 profile 使用 `penguin-<target>`，可选离线能力使用 `penguin-offline-<target>`；Linux/macOS 后缀为 `.tar.gz`，Windows 为 `.zip`。离线 profile 包含确定性的 DOCX 检查/编辑、PPTX 检查/追加幻灯片和 PDF 检查/合并 Skill，后续离线 Skill 继续扩展同一 profile。传输选中的一个文件后解压一次。

Windows 上双击 `install.cmd`，或执行：

```powershell
.\install.ps1
```

Linux / macOS 上执行：

```bash
./install.sh
```

解压后的目录同时包含安装器、程序负载（`payload.tar.gz` / `payload.zip`）与负载的 `.sha256`；安装器会自行找到同目录负载，始终校验包内封入的 checksum，且不发起任何网络请求——无需另外传输校验文件。也可以显式指定本地文件：`install.sh --archive <file>`、`PENGUIN_ARCHIVE=<file>`、`install.ps1 -ArchivePath <file>` 或 `$env:PENGUIN_ARCHIVE`——Release 安装包、其内部负载或 0.1.6 之前的旧版程序压缩包均可。

### 安装位置与选项

| 项目 | 说明 |
| --- | --- |
| 安装目录 | 默认 `~/.penguin`，可用环境变量 `PENGUIN_INSTALL_DIR` 覆盖 |
| 命令入口 | 创建符号链接 `~/.local/bin/penguin`（若 `~/.local/bin` 不在 PATH 上，脚本会给出提示） |
| 版本选择 | 环境变量 `PENGUIN_VERSION=vX.Y.Z`，或脚本参数 `--version vX.Y.Z`；稳定入口默认安装最新 Release，版本化 Release 安装器默认安装自身 tag |
| 下载来源 | `PENGUIN_DOWNLOAD_SOURCE=auto`（默认）、`oss` 或 `github`；自动模式优先 OSS，并按同一版本回退到 GitHub |
| 离线 profile | `--offline` 选择匹配 Linux/macOS 平台的离线包；不能与 `--universal` 或 `--archive` 组合 |
| 本地压缩包 | `PENGUIN_ARCHIVE=<file>` 或 `--archive <file>`；接受 Release 安装包（凭包内封入的负载 checksum 自校验），或旁边带 `<file>.sha256` 的负载 / 旧版程序压缩包（重命名的旧版文件可用平台标准名称的 `.sha256`） |
| 完整性校验 | 始终进行：在线下载对照发布的 `.sha256` 校验，安装包负载对照包内封入的 checksum 校验 |
| 升级 | 重新执行安装脚本即可，文件原子替换 |

脚本参数写在 `sh -s --` 之后，例如 `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal` 或 `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --offline`。

### Windows 细节

| 项目 | 说明 |
| --- | --- |
| 安装目录 | 默认 `%USERPROFILE%\.penguin`，可用环境变量 `PENGUIN_INSTALL_DIR` 覆盖 |
| 命令入口 | `bin\penguin.cmd` 启动器（特意不带 `.ps1` 启动器——批处理不受 PowerShell 执行策略限制，默认 Restricted 策略下 `penguin` 也能直接运行）；安装器会把 `%USERPROFILE%\.penguin\bin` 加入**用户** Path 并广播变更——请**新开一个终端窗口**（已开终端的新标签页仍沿用旧 Path） |
| 版本固定 | 运行安装器前设置 `$env:PENGUIN_VERSION = "vX.Y.Z"` |
| 离线 profile | 使用 `-Offline` 执行稳定入口脚本块，选择 `penguin-offline-win32-x64.zip`；不能与 `-ArchivePath` 组合 |
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

## npm 安装

需要系统 Node.js >= 24：

```bash
npm install -g @prismshadow/penguin-cli
```

npm 包名为 `@prismshadow/penguin-cli`，安装后的命令是 `penguin`。Web UI 静态资源随 `@prismshadow/penguin-server` 包发布，因此仅执行上述命令即可直接使用 `penguin web`。该方式在所有平台（含 Windows）可用，是压缩包不适用时的替代路径。

## 源码安装

需要 Node.js >= 24 与 pnpm：

```bash
git clone https://github.com/Prism-Shadow/penguin-harness.git
cd penguin-harness
pnpm install && pnpm build
```

构建完成后，在仓库内用 `pnpm penguin <args>` 作为开发入口运行，或使用全局链接的 `penguin` 命令。开发入口（`pnpm penguin`、`pnpm dev`）默认使用独立数据根目录 `~/.penguin/dev-data`，全局链接或安装的 `penguin` 仍使用 `~/.penguin/data`；可通过环境变量 `PENGUIN_HOME` 覆盖。

## 已发布的 npm 包

| 包 | 说明 |
| --- | --- |
| `@prismshadow/penguin-cli` | 命令行工具，提供 `penguin` 命令 |
| `@prismshadow/penguin-core` | SDK，程序化创建 Agent 与 Session |
| `@prismshadow/penguin-server` | Web 服务，含 Web UI 静态资源 |
| `@prismshadow/penguin-skills` | Skill 集合 |

全部包以 Apache-2.0 协议发布。

## 下一步

- [快速开始](/quickstart)：配置模型并运行第一个 Task。
- [CLI 参考](/cli)：完整的命令与选项列表。
