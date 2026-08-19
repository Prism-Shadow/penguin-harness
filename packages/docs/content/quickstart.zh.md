---
title: 快速开始
description: 桌面端、命令行、SDK 三条路线，挑一条装好 PenguinHarness 并跑通第一个 Task。
---

PenguinHarness 有三条入口，背后是同一个引擎，区别只在你以什么方式接触它。先挑一条适合自己的，各自的页面会把你一路带到第一个 Task：

| 路线 | 适合 | 需要用终端吗 |
| --- | --- | --- |
| [桌面端应用](/quickstart-desktop) | 想直接把 PenguinHarness 当成一个应用来用 | 仅在系统拦下首次启动时 |
| [命令行与 Web 应用](/quickstart-cli) | 装到服务器或远程机器，或想要 `penguin` 命令 | 安装时用一次 |
| [SDK](/quickstart-sdk) | 把引擎嵌进自己的 TypeScript 程序 | 需要 |

拿不准就选[桌面端应用](/quickstart-desktop)：它步骤最少，而且换到另一条路线不用重来。目前的构建尚未签名，macOS 与 Linux 首次启动时可能需要执行一条命令，那一页里写了。

## 三条路线共用什么

- **同一个数据目录**：`~/.penguin/data`（Windows 为 `%USERPROFILE%\.penguin\data`）。Agent、模型配置与历史会话互通，所以三条路线可以随时混用——桌面端配好的模型，CLI 与 SDK 立刻就能用。
- **同一时刻只有一个服务端**：一个数据目录只跑一个服务端进程。命令行已经用 `penguin web` 启动过实例时，桌面端应用会直接接入它，而不是再起一个。
- **同一套界面**：桌面端应用与 `penguin web` 打开的是同一个 Web App，只是前者内嵌了服务端、免去登录。

## 开始之前

PenguinHarness 不内置任何模型凭据，跑第一个 Task 之前必须先配置一个模型，准备好一个 Provider 的 API Key 即可。三条路线各自的页面都包含这一步。

模型引用始终是 `(provider, model_id)` 二元组，Provider 绝不由模型 id 推断；内置分组见[模型与 Provider](/models)。

## 下一步

- [桌面端应用](/quickstart-desktop)：双击安装，打开即已登录。
- [命令行与 Web 应用](/quickstart-cli)：一行安装 `penguin`，含完整的安装参考。
- [SDK](/quickstart-sdk)：在自己的程序里创建 Agent 与 Session。
