---
title: 快速开始
description: 在桌面应用、命令行与 Web App、Docker、SDK 四条路线中任选一条，安装 PenguinHarness 并跑通第一个 Task。
---

PenguinHarness 有四条入口：桌面应用、命令行与 Web App、Docker 和 SDK。它们背后是同一个引擎，区别只在于你以什么方式接触它。挑一条适合自己的路线，每条路线的页面都会一路带你跑通第一个 Task。

## 开始之前

PenguinHarness 不内置任何模型凭据，跑第一个 Task 之前要先配置一个模型。准备好一个供应商的 API Key 即可，每条路线的页面都包含这一步。

模型始终以 `(provider, model_id)` 二元组引用，供应商绝不由模型 id 推断。内置分组见[模型与 Provider](/models)。

## 选择路线

| 路线 | 适合 | 需要终端吗？ |
| --- | --- | --- |
| [桌面应用](/quickstart-desktop) | 想直接把 PenguinHarness 当作产品来用 | 不需要，而且它会替你装好 `penguin` 命令 |
| [命令行与 Web App](/quickstart-cli) | 装到服务器或远程机器上，或者想要 `penguin` 命令 | 安装时用一次 |
| [Docker](/quickstart-docker) | 部署而非安装的服务端：一个容器、一个卷 | 启动时用一次 |
| [SDK](/quickstart-sdk) | 把引擎嵌入自己的 TypeScript 程序 | 需要 |

拿不准就选[桌面应用](/quickstart-desktop)：它步骤最少，以后换到别的路线也不用付出任何代价。macOS 和 Windows 的安装包都已签名，只有下载来的 Linux AppImage 在首次启动前需要多做一步，桌面应用页面里写了。

## 各条路线的共同点

- **同一个数据目录**：`~/.penguin/data`（Windows 为 `%USERPROFILE%\.penguin\data`，容器内为 `/data`）。Agent、模型配置和历史会话都在其中，所以同一台机器上的几条路线可以随意混用：在桌面应用里配好的模型，CLI 和 SDK 立刻就能用。
- **同一时刻只有一个服务端**：一个数据目录只运行一个服务端进程。如果你已经用 `penguin web` 启动了一个，桌面应用会直接接入它，而不会再启动第二个。
- **同一套界面**：桌面应用与 `penguin web` 打开的是同一个 Web App，只是桌面应用内嵌了服务端，并免去了登录。

## 下一步

- [桌面应用](/quickstart-desktop)：双击安装，打开即已登录。
- [命令行与 Web App](/quickstart-cli)：一行命令装好 `penguin`，附完整的安装参考。
- [Docker](/quickstart-docker)：官方镜像，用于经网络访问的服务端。
- [SDK](/quickstart-sdk)：在自己的程序里创建 Agent 与 Session。
- [核心概念](/concepts)：文档中通用的术语。
