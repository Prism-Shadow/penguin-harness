---
title: 安装
description: 通过安装脚本、npm 或源码安装 PenguinHarness。
---

## 系统要求

- Linux / macOS（x64 或 arm64）：安装脚本提供内置官方 Node.js 运行时的平台压缩包，解压即用，无需本机安装 Node。
- 其他平台，或通过 npm / 源码安装：需要系统 Node.js >= 24。

## 脚本安装（推荐）

在 Linux / macOS 上执行：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
```

脚本按平台下载 `penguin-{linux,darwin}-{x64,arm64}.tar.gz`，其中捆绑了官方 Node.js 运行时。其他平台**不会自动回退**：脚本会退出并提示先安装 Node.js >= 24、再携带 `--universal` 重新执行，改用不含运行时的 `penguin-universal.tar.gz`。

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

脚本参数通过 `curl ... | sh -s -- --universal` 的形式传入。

### 数据目录

数据目录默认位于 `~/.penguin/data`（在安装主目录 `~/.penguin` 之下，但安装与升级都不会改动它），可用环境变量 `PENGUIN_HOME` 覆盖。模型配置、Session 记录等在升级后均会保留。

## npm 安装

需要系统 Node.js >= 24：

```bash
npm install -g @prismshadow/penguin-cli
```

npm 包名为 `@prismshadow/penguin-cli`，安装后的命令是 `penguin`。Web UI 静态资源随 `@prismshadow/penguin-server` 包发布，因此仅执行上述命令即可直接使用 `penguin web`。

## 源码安装

需要 Node.js >= 24 与 pnpm：

```bash
git clone https://github.com/Prism-Shadow/penguin-harness.git
cd penguin-harness
pnpm install && pnpm build
```

构建完成后，在仓库内用 `pnpm penguin <args>` 作为开发入口运行，或使用全局链接的 `penguin` 命令。

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
