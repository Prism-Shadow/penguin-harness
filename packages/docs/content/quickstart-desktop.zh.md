---
title: 桌面端应用
description: 双击安装，打开即已登录——对终端要求最少的那条路线。
---

完整的 Web 体验打包成一个独立应用：内嵌服务端，双击打开即已登录——没有登录页，不用抄初始密码，也不必从命令行安装任何东西。用户菜单里相应地没有**修改密码**这一项：这个窗口自己完成登录，因此既没有要输的密码，也没有要改的密码。它还会替你装好 `penguin` 命令，需要用终端时随时可用。它与[命令行安装](/quickstart-cli)共用同一个数据目录，两者可以混用——如果之后想用 `penguin server` 把这个数据目录放到网络上，请先用 `penguin server reset-admin-password`（服务端已停止时执行）给其中的 admin 设一个可用的密码，因为桌面端刻意生成的是一个谁也读不到的初始密码。

## 下载与安装

前往[下载页](https://penguin.ooo/download)获取对应平台的安装包（国内自动走 OSS 镜像加速）；同样的文件也附于每个 [GitHub Release](https://github.com/Prism-Shadow/penguin-harness/releases)。

| 平台 | 安装包 |
| --- | --- |
| macOS 11+ | dmg（Apple 芯片 / Intel） |
| Windows 10+ | 安装程序（.exe，x64） |
| Linux（x64） | AppImage / deb |

macOS 安装包已由 Developer ID 签名并公证，Windows 安装程序已 Authenticode 签名，两个平台首次启动都无需额外放行；只有 Linux 是例外：

> [!INFO]- Linux 双击 AppImage 没有反应
>
> 浏览器下载的 AppImage 默认没有执行权限，赋权一次后即可正常启动（deb 包经包管理器安装，无此问题）：
>
> ```bash
> chmod +x penguin-desktop-linux-x86_64.AppImage
> ```

## `penguin` 命令

应用会在每次启动时，用打包在自身内部的那份 CLI 装好 `penguin` 命令。两者始终来自同一次构建，所以应用更新时命令也随之更新；过程中不需要系统里的 Node.js——启动器用应用自带的运行时执行打包好的 CLI。

| 平台 | 命令装到哪里 |
| --- | --- |
| macOS | `/usr/local/bin/penguin`，链接到应用。创建该目录可能需要管理员密码；只有在普通写入被拒时 macOS 才会询问，取消则不安装该命令。 |
| Windows | 应用的 `bin` 目录会追加到用户 `Path`。之后请**新开一个终端窗口**——已经开着的终端仍沿用旧 `Path`。 |
| Linux（deb） | `/usr/bin/penguin`，由软件包自身的安装脚本创建。 |
| Linux（AppImage） | `~/.local/bin/penguin`，一个运行该 AppImage 的包装脚本。多数发行版会在登录时把该目录加入 `PATH`。 |

**已存在的 `penguin` 绝不会被替换。**如果该命令已由别处提供——[命令行安装](/quickstart-cli)、全局 npm 包、你自己写的脚本——应用会原样保留它，不安装自己的那份。想主动替换，请在应用菜单里选择 **Install 'penguin' Command…**；在 macOS 上取消过管理员授权后，也从这里重新安装。

在 macOS 上，只要应用还是从挂载的 dmg 里运行，就不会安装该命令——推出磁盘映像后链接就会失效。请先把应用拖入「应用程序」文件夹，再从那里打开。

## 配置模型

打开应用，在左侧进入**模型**页，点「添加模型」填入 Provider、模型 id 与 API key，保存后设为默认模型。

已在 shell 配置里 export 过的 API key（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等）无需重复填写：macOS 与 Linux 上从 Dock / 桌面启动时，应用会导入登录 shell 的环境变量，且只补启动环境中缺失的项（agent shell 的 `PATH` 同样受益；设置 `PENGUIN_NO_LOGIN_SHELL_ENV` 可关闭导入）。未配置存储 key 的官方供应商模型，**模型**页会像显示存储 key 一样，以掩码显示检测到的变量取值：卡片上如此，模型详情里也一样，并注明该 key 读取自环境变量（网关与自定义分组不匹配这些变量）。

模型引用始终是 `(provider, model_id)` 二元组，Provider 绝不由模型 id 推断；内置分组见[模型与 Provider](/models)。

## 跑通第一个 Task

回到**对话**页新建会话：先选好 Agent、Workspace（用服务器端目录浏览器选取）与审批模式，再发送第一条消息，例如「创建 hello.txt，内容为 Hello, Penguin」。

工具调用会在消息流里以卡片形式内联展开，可点开查看参数与输出；审批模式选 `always-ask` 时，每次写文件都会等你点「允许」。四种审批模式的区别见[工具与审批](/tools)。

## 下一步

- [Web App 指南](/web-app)：按页面逐一介绍界面的全部功能。
- [命令行与 Web 应用](/quickstart-cli)：独立安装，适用于服务器或远程机器。同一台机器上不必再装——应用已经提供了 `penguin`，再装一次只会在 `PATH` 上多出一份。
- [架构总览](/architecture)：了解整体设计。
