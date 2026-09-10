---
title: "PenguinHarness 0.2.11：文件浏览升级、压缩时机动态调整、Hook 能力、Docker 镜像"
date: 2026-09-10
category: news
excerpt: 对话长出了一张工作台。文件面板变成可就地编辑、带版本校验保存的双栏浏览器；上下文环改为对着压缩真正触发的那个点计量，阈值本身成了一把可拖动的刻刀；对话右缘多了一颗快捷球，可以把整个面板栏扇开；定时任务也搬进了面板栏。钩子成为智能体循环自身的能力，目标模式与持续学习则作为可安装插件发布。官方 Docker 镜像让一台服务端只需一条 `docker run`，而新建 Project 的默认模型换成了 DeepSeek V4.1 Flash。
---

PenguinHarness 0.2.11 发布。本版大部分变化在对话内部：文件面板可编辑、上下文环按压缩点计量、快捷球与定时任务进入面板栏；钩子成为智能体循环能力，官方容器镜像让服务端一条命令部署，模型库同步更新。

## 可以直接敲字的文件面板

文件面板改为两栏：左侧目录树，右侧选中文件，中间可拖动分隔条。文本文件新增**编辑**操作，提供等宽输入框、**自动换行**和 Ctrl+S 保存。保存带版本校验：文件变化时返回 `409` 并提示覆盖，同时保留草稿。未保存改动在切换文件或移除前会确认，折叠面板不会丢失草稿。

![文件面板：左侧目录树，右侧是在纯文本编辑器里打开的文件](/blog-assets/penguinharness-0-2-10-files-panel-zh.png)

## 上下文环对着压缩计量

输入框上下文环改为按压缩触发点计量：128k 阈值下用掉 64k 显示为 50%。长条仍以模型窗口为刻度，触发点用虚线刻刀表示，拖动刻刀即可调整，确认框预填建议值。压缩设置会在每个压缩检查点重新读取，对运行中的对话同样生效。面板新增 Top 5 文件视图。

![上下文面板：以模型窗口为刻度的长条、可拖动的压缩刻刀，以及 Top 5 文件视图](/blog-assets/penguinharness-0-2-10-context-panel-zh.png)

## 对话边缘的一颗快捷球

无面板打开时，对话右缘内侧出现半透明快捷球。点击后沿半圆弧展开面板入口（每个面板一个，外加终端），选中即打开对应面板。球可沿边缘拖动并记住位置，带待审批小圆点；弧上最后一个入口会永久收起，可在外观设置中恢复。

![对话右缘的快捷球，展开成一圈半圆形的面板入口](/blog-assets/penguinharness-0-2-10-shortcuts-launcher-zh.png)

## 定时任务进入对话

面板栏新增**定时任务**面板，列出当前 Session 的任务，带搜索、状态过滤和启用开关。头部提供**AI 创建**（把请求写进当前对话输入框，不发送）和**手动创建**（打开锁定 Session 的表单）。侧栏为有未触发任务的 Session 显示闹钟；保存提示不再说“在新对话中生效”。

![面板栏里的定时任务面板，带 AI 创建与手动创建两个按钮，以及侧栏中带闹钟标记的会话行](/blog-assets/penguinharness-0-2-10-schedule-panel-zh.png)

## 钩子成为一项能力，目标模式成为插件

Session 获得通用钩子机制：core 只定义触发点（**stop**、**pre_tool_use**、**user_prompt**），钩子以 Node 脚本包安装在 `agent_state/hooks/`，子进程运行并返回 `continue`、`stop`、`subagent` 或空。目标模式移出 core，成为 `goal` 插件的 stop 钩子；技能库改为**插件库**，新增 `continual-learning` 包。Agent 设置新增**钩子**标签页，含 `hooks.enabled` 总开关和每包管理（触发点标签、zip 导入导出、对话导入）。

![Agent 设置的钩子标签页：启用开关卡片、带触发点标签的包条目，以及导入对话框入口](/blog-assets/penguinharness-0-2-10-hooks-tab-zh.png)

## AI 创建，作为一套套件

Web App 中每个由表单创建的对象将获得第二种方式：描述给智能体。本版发布机件：按钮对、带示例与可折叠完整提示词预览的提示面板，以及把提示词交给 Project 默认智能体的对话框。**AI 创建**与**手动创建**为两个独立按钮；对话框唯一出口是**在新对话中编辑**，永不自动发送。本版仅定时任务两处入口启用。

![页面头部的 AI 创建与手动创建按钮对，其上打开着 AI 创建对话框](/blog-assets/penguinharness-0-2-10-create-with-ai-zh.png)

## 把服务端放到另一台机器上

官方容器镜像 `hiyouga/penguinharness` 发布在 Docker Hub，支持 `linux/amd64` 与 `linux/arm64`，以 `0.0.0.0:7364` 运行 `penguin server`，数据挂 `/data`。标签 `latest` 跟随 `main`，`X.Y.Z` 由发布 tag 构建。机器记录从 JSON 文件迁入 `web.db` 并归属 Project；每台机器自行签发 16 位 id，通过 ssh 应答，流量走常驻 `ssh -T -D` 会话。

## 模型库

- **DeepSeek V4.1 Flash** 以 `deepseek-flash` 发布并成为默认模型：1,000,000 Token 窗口，支持图片。
- **Gemini 3.8 Flash** 进入直连与 OpenRouter，1,048,576 Token 窗口，支持图片；Google Gemini 3.x Flash 记录现在存官方标价并声明折扣。
- **GPT-6 Astra** 进入直连与 OpenRouter（1,050,000 Token 窗口，支持图片）。
- 三条 **Doubao Seed** 进入 TokenDance 分组，享五折促销。
- 新增 **vLLM** 分组，收录八个自建部署模型：价格为零，不带 base URL，协议由分组统一锁定。

已有 Project 需在模型页执行**同步预置**获取。

## 这一版还有

- 被拒绝的工具调用会说明错误、参数表和正确形状；`exec_command` 同时接受 `command`/`cmd`，`read_image`/`describe_image` 并入 `read_file`。
- 慢轮显示耗时分解，如 `Elapsed 10.3s (API 5s, tools 5.3s)`，不含等待审批。
- 侧栏为有开发服务器或后台子智能体的 Session 显示活动标记和胶囊标签。
- 压缩展示状态与耗时，思考与摘要分别流进折叠行。
- LLM 请求按沉默超时，`model.timeoutMs` 是事件间空闲预算，默认提升到 300000，收到内容后重试阶梯重置。
- 更新只走一个对话框：检查、发布说明、下载、重启并更新。
- 对话默认只打开最近 50 轮，向上滚动按需加载更早内容。
- 侧栏列出每个 Workspace，依据服务端计数。
- 终端链接按目标打开，重绘后按位置判定点击，OSC 52 复制可到系统剪贴板。
- 插件版本写作 `2026.09.10.1`，旧写法被读作同一版本。

## 升级须知

- **热推送需重启一次**：本版包含首个“仅限重启”迁移 `drop-goal-state`，热推送会在触及数据库前被拒绝；正常安装会重启并执行迁移，回退 0.2.9 可行。
- 给旧 Agent 安装 `goal` 插件，否则启动目标模式会返回 `409 goal_plugin_not_installed`。
- 内核需更新到 `2026-09-10` 才能用 `read_file` 读图；脚本中 `skills`/`--skills` 改为 `plugins`/`--plugins`。
- API 变化：`POST /api/version/update` 返回任务状态而非阻塞到结束；机器路由移至 Project 下，0.2.9 装机机器列表会为空，从对应 Project 重装恢复。

桌面端安装包在 [penguin.ooo/download](https://penguin.ooo/download)；CLI 与服务端的安装方式：

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

```sh
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:latest
```

0.2.11 是 0.2.10 的重新构建版：electron-builder 升至 26.16.1，签名的 macOS 安装包得以重新构建；0.2.10 本身没有安装包也没有 Release 页面。完整细节见 [`changelog/0.2.10/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.10)。
