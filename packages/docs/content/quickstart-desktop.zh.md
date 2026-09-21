---
title: 桌面应用
description: 安装 PenguinHarness 桌面应用，配置模型，跑通第一个 Task，全程不需要终端。
---

桌面应用把完整的 Web App 做成了一个独立应用。它内置服务端，打开即已登录：没有登录页，不用抄初始密码，也不必从命令行安装任何东西。它还会替你装好 `penguin` 命令，需要终端时随时可用。

## 开始之前

- macOS 11 及以上、Windows 10 及以上（x64），或 Linux（x64）。
- 一个模型供应商的 API Key。

## 下载并安装

从[下载页](https://penguin.ooo/download)下载对应平台的安装包；OSS 加速镜像可用时，下载页会走镜像。同样的文件也附在每个 [GitHub Release](https://github.com/Prism-Shadow/penguin-harness/releases) 里。

| 平台 | 安装包 |
| --- | --- |
| macOS 11+ | dmg（Apple Silicon / Intel） |
| Windows 10+ | 安装程序（.exe，x64） |
| Linux（x64） | AppImage / deb |

安装并打开应用。在 macOS 上，先把应用拖入**应用程序**文件夹，再从那里打开。

macOS 安装包已经过 Developer ID 签名和公证，Windows 安装程序已经过 Authenticode 签名，两个平台首次启动都不需要手动放行。只有 Linux 是例外：

> [!INFO]- 双击 Linux AppImage 没有反应
>
> 浏览器下载的 AppImage 没有执行权限。赋予一次执行权限后，应用就能正常启动。deb 包通过包管理器安装，不受影响。
>
> ```bash
> chmod +x penguin-desktop-linux-x86_64.AppImage
> ```

应用打开即已登录。窗口自己完成登录，既没有要输入的密码，也没有可修改的密码，所以应用窗口里的**设置**没有带**修改密码**的**账户**页面。

## 配置模型

PenguinHarness 不内置任何模型凭据。为要使用的模型配置 API Key：

1. 在侧边栏选择**模型库**。模型按供应商分组列出，默认模型带有**默认**标记。
2. 在你所用供应商的分组里点击**手动设置密钥**，输入 API Key，然后点击**确认**。这个 Key 会写入分组里的每个模型。
3. 如果要使用默认模型以外的模型，打开那个模型，点击**设为默认模型**。

要添加列表里没有的模型，在对应供应商的分组里点击**添加模型**，填写**模型 ID** 和 **API key**。

模型始终以 `(provider, model_id)` 二元组引用，供应商绝不会由模型 id 推断。内置分组见[模型与 Provider](/models)。

### 使用 shell 配置里的 API Key

已经在 shell 配置文件里 export 的 API Key（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等）不用再填一遍。在 macOS 和 Linux 上从 Dock 或桌面启动应用时，应用会导入登录 shell 的环境变量，只补上启动时没有设置的变量。Agent shell 的 `PATH` 也因此受益。设置 `PENGUIN_NO_LOGIN_SHELL_ENV` 可以关闭这项导入。

官方供应商的模型没有保存 Key 时，**模型库**页面会以掩码显示检测到的环境变量值，和显示已保存的 Key 一样：模型卡片上显示，模型详情弹窗里也显示，并标注为**读取自环境变量**。网关分组和自定义分组不会匹配这些变量。

## 跑通第一个 Task

1. 在侧边栏点击**新建对话**。
2. 选择 Agent、Workspace 和审批模式。Workspace 通过服务端的目录浏览器选择。
3. 发送第一条消息，例如「创建 hello.txt，内容为 Hello, Penguin」。

工具调用会以卡片形式显示在消息流里，点开卡片可以查看参数和输出。审批模式为**总是询问**（`always-ask`）时，每次写文件都会等你点击**允许**。四种审批模式的区别见[工具与审批](/tools)。

## `penguin` 命令

应用每次启动时，都会用自身打包的 CLI 装好 `penguin` 命令。应用和命令始终来自同一次构建，所以更新应用时命令也会随之更新。整个过程不需要系统里的 Node.js：启动器用应用自带的运行时执行打包的 CLI。

| 平台 | 命令装到哪里 |
| --- | --- |
| macOS | `/usr/local/bin/penguin`，链接到应用。创建这个目录可能需要管理员密码。只有普通写入遭拒时，macOS 才会询问；如果拒绝授权，就不会安装命令。 |
| Windows | 应用的 `bin` 目录会追加到你的用户 `Path`。之后请打开一个**新的**终端窗口，已经在运行的终端仍沿用旧的 `Path`。 |
| Linux（deb） | `/usr/bin/penguin`，由软件包自己的安装脚本创建。 |
| Linux（AppImage） | `~/.local/bin/penguin`，一个用来运行 AppImage 的包装脚本。多数发行版会在登录时把这个目录加入 `PATH`。 |

应用绝不会替换已有的 `penguin`。如果别处已经提供了这个命令，比如 [CLI 安装](/quickstart-cli)、全局 npm 包或你自己写的脚本，应用会原样保留它，自己的那份不安装。要主动替换，在应用菜单里选择 **Install 'penguin' Command…**。如果在 macOS 上拒绝过管理员授权，也可以通过这个菜单项重新安装。

在 macOS 上，应用从挂载的 dmg 里运行时不会安装命令，因为推出磁盘映像后链接就会失效。请把应用拖入**应用程序**文件夹，再从那里打开。

## 与 CLI 共用数据目录

桌面应用与 [CLI 安装](/quickstart-cli)使用同一个数据目录，两者可以搭配使用。

如果之后要用 `penguin server` 把这个数据目录开放到网络上，要先给 `admin` 设置一个你能用的密码，因为桌面应用刻意生成了一个谁也读不到的密码。先停止服务端，再运行：

```bash
penguin server reset-admin-password
```

`admin` 账号会回到未认领状态。再次启动服务端时，它会打印一条首次登录链接，打开链接即可设置新密码。

## 下一步

- [Web App](/web-app)：熟悉界面。
- [更新 PenguinHarness](/updates)：桌面应用如何更新自身。
- [命令行与 Web App](/quickstart-cli)：独立安装，适用于服务器或远程机器。同一台机器上不需要再装：应用已经提供了 `penguin`，再装 CLI 只会在 `PATH` 上多出一份。
- [架构总览](/architecture)：各个部分如何协作。
