---
title: 安装
description: 通过安装脚本、npm 或源码安装 PenguinHarness。
---

## 系统要求

- Linux / macOS（x64 或 arm64）：安装脚本提供内置官方 Node.js 运行时的平台压缩包，解压即用，无需本机安装 Node。
- Windows 10 及以上（x64），PowerShell 5.1+：Windows 安装器提供内置运行时的 `penguin-win32-x64.zip`，同样无需本机安装 Node。
- 其他平台，或通过 npm / 源码安装：需要系统 Node.js >= 24。

## 脚本安装（推荐）

在 Linux / macOS 上执行：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
```

脚本按平台下载 `penguin-{linux,darwin}-{x64,arm64}.tar.gz`，其中捆绑了官方 Node.js 运行时。其他 POSIX 平台**不会自动回退**：脚本会退出并提示先安装 Node.js >= 24、再携带 `--universal` 重新执行，改用不含运行时的 `penguin-universal.tar.gz`（Windows 使用下方专属安装器，而不是 `--universal`）。

在 Windows（PowerShell）上执行：

```powershell
irm https://penguin.ooo/install.ps1 | iex
```

如需固定版本，先设置环境变量：

```powershell
$env:PENGUIN_VERSION = "vX.Y.Z"; irm https://penguin.ooo/install.ps1 | iex
```

安装完成后验证：

```bash
penguin -v
```

### 安装位置与选项

| 项目 | 说明 |
| --- | --- |
| 安装目录 | 默认 `~/.penguin`，可用环境变量 `PENGUIN_INSTALL_DIR` 覆盖 |
| 命令入口 | 创建符号链接 `~/.local/bin/penguin`（若 `~/.local/bin` 不在 PATH 上，脚本会给出提示） |
| 版本固定 | 环境变量 `PENGUIN_VERSION=vX.Y.Z`，或脚本参数 `--version vX.Y.Z`；默认安装最新 Release |
| 完整性校验 | Release 提供 checksum 资产时自动进行 sha256 校验 |
| 升级 | 重新执行安装脚本即可，文件原子替换 |

脚本参数写在 `sh -s --` 之后，例如 `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal`。

### Windows 细节

| 项目 | 说明 |
| --- | --- |
| 安装目录 | 默认 `%USERPROFILE%\.penguin`，可用环境变量 `PENGUIN_INSTALL_DIR` 覆盖 |
| 命令入口 | `bin\penguin.cmd` 与 `bin\penguin.ps1` 启动器；安装器会把 `%USERPROFILE%\.penguin\bin` 加入**用户** Path（重启终端后生效） |
| 版本固定 | 运行安装器前设置 `$env:PENGUIN_VERSION = "vX.Y.Z"` |
| 完整性校验 | Release 提供 checksum 资产时自动进行 sha256 校验 |
| 升级 | 重新运行安装器；只替换 `bin`/`lib`/`web`/`node`，绝不触碰 `data` |

- **Agent shell**：Windows 上 `exec_command` 优先使用 Git-Bash（PATH 上的 `bash`，如 [Git for Windows](https://gitforwindows.org/)），与面向 POSIX shell 编写的技能生态兼容性最好；没有 bash 时回退到 PowerShell（先 `pwsh` 后 `powershell`）。环境变量 `PENGUIN_SHELL` 可强制指定；会话的系统提示词会告知模型当前 shell。
- **Ctrl-C 语义**：Windows 上向运行中的命令会话发送 Ctrl-C（`input_command` 传 `"\u0003"`）会终止整棵命令会话进程树，而不是中断前台命令——Windows 无法向管道子进程投递控制台 Ctrl-C，中断因此退化为整树强杀。
- **就地更新**：`penguin update` 暂不支持 Windows——升级请重新运行上面的安装器。
- **配置文件权限**：POSIX 上配置/凭据文件以 `0600`（仅属主可读写）写入；Windows 没有对应的权限位，文件遵循你用户目录的默认 NTFS ACL。
- 如果 PowerShell 提示 "running scripts is disabled" 而无法运行 `penguin`，是执行策略拦住了 `penguin.ps1`：可以显式调用 `penguin.cmd`，或用 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 允许本地脚本。

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
