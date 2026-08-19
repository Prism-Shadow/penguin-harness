---
title: 桌面端应用
description: 双击安装，打开即已登录——对终端要求最少的那条路线。
---

完整的 Web 体验打包成一个独立应用：内嵌服务端，双击打开即已登录——没有登录页，不用抄初始密码，也不必从命令行安装任何东西。目前的构建尚未签名，macOS 与 Linux 在系统拦下首次启动时各需要执行一条命令，下面的方框里写了。它与[命令行安装](/quickstart-cli)共用同一个数据目录，两者可以混用。

## 下载与安装

前往[下载页](https://penguin.ooo/download)获取对应平台的安装包（国内自动走 OSS 镜像加速）；同样的文件也附于每个 [GitHub Release](https://github.com/Prism-Shadow/penguin-harness/releases)。

| 平台 | 安装包 |
| --- | --- |
| macOS 11+ | dmg（Apple 芯片 / Intel） |
| Windows 10+ | 安装程序（.exe，x64） |
| Linux（x64） | AppImage / deb |

> [!INFO]- 首次启动被系统拦下？按平台操作一次即可解除
>
> 当前构建暂未签名，系统可能拦截第一次启动。只需处理你自己的平台：
>
> **macOS 提示「PenguinHarness 已损坏，无法打开」**——macOS 会给从网络下载的文件加上隔离标记，应用未签名时会因此被误报为「已损坏」。把 `PenguinHarness.app` 从 dmg 拖入「应用程序」文件夹，打开终端（启动台 → 其他 → 终端），粘贴下面这条命令并回车，再输入开机密码（输入时屏幕不显示字符，输完回车即可）；执行完成后双击即可正常打开：
>
> ```bash
> sudo xattr -rd com.apple.quarantine /Applications/PenguinHarness.app
> ```
>
> **Windows SmartScreen 提示「Windows 已保护你的电脑」**——安装程序暂未签名，点「更多信息」，再点「仍要运行」即可继续安装，仅首次运行需要。
>
> **Linux 双击 AppImage 没有反应**——浏览器下载的 AppImage 默认没有执行权限，赋权一次后即可正常启动（deb 包经包管理器安装，无此问题）：
>
> ```bash
> chmod +x penguin-desktop-linux-x86_64.AppImage
> ```

## 配置模型

打开应用，在左侧进入**模型**页，点「添加模型」填入 Provider、模型 id 与 API key，保存后设为默认模型。

模型引用始终是 `(provider, model_id)` 二元组，Provider 绝不由模型 id 推断；内置分组见[模型与 Provider](/models)。

## 跑通第一个 Task

回到**对话**页新建会话：先选好 Agent、Workspace（用服务器端目录浏览器选取）与审批模式，再发送第一条消息，例如「创建 hello.txt，内容为 Hello, Penguin」。

工具调用会在消息流里以卡片形式内联展开，可点开查看参数与输出；审批模式选 `always-ask` 时，每次写文件都会等你点「允许」。四种审批模式的区别见[工具与审批](/tools)。

## 下一步

- [Web App 指南](/web-app)：按页面逐一介绍界面的全部功能。
- [命令行与 Web 应用](/quickstart-cli)：想在同一台机器上再装一个 `penguin` 命令时看这里。
- [架构总览](/architecture)：了解整体设计。
