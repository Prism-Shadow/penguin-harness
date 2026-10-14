---
title: "PenguinHarness 0.2.16：Agent Workbench、内置问答助手与 Gemini 4 Argon"
date: 2026-10-14
category: news
excerpt: "一句话创建 Agent 和专属应用，以插件方式管理工作台，在内置客服中心查询产品问题。模型库新增 Gemini 4 Argon 与 GPT-6 Luna。"
---

PenguinHarness 0.2.16 让 Agent 的应用有了统一入口：Agent Workbench。首页三个示例都会创建一个专用 Agent，并为它配置工作台标签页。默认 Project 还会初始化 PenguinHarness 问答助手。本版同时加入 Gemini 4 Argon、GPT-6 Luna，更新模型预置列表，并支持自定义本地背景图片。

## Agent Workbench

用一句话描述想要的应用，PenguinHarness 会使用插件创建 Agent 和专属工作台。打开这个 Agent，新建对话，再选择工作台标签页即可使用。切换首页示例时，所选 Skill 会被替换，不再累加。

工作台和 Skill、钩子一样，可以随插件安装。在「智能体」→ 对应 Agent 的设置 →「工作台」中，可以打开、重新加载、恢复版本或移除工作台。紧凑的 Agent 选择框显示 Skill 和工作台数量，支持搜索与键盘选择。

![在 Agent 设置中管理工作台](/blog-assets/penguinharness-0-2-16-workbench-settings-zh.jpg)

退出「占满应用」后会回到原工作台。工作台创建的对话标记为 `workbench` 来源并自动归档，由应用管理自己的问题，不挤占主对话列表。

## 内置 PenguinHarness 客服中心

默认 Project 会初始化一个安装了 `penguin-support` 插件的问答助手。它根据官方文档和代码仓库回答问题，并用 [1] 这样的正文编号链接标明依据。

工作台默认显示居中的问题列表。点击问题弹出对话详情，点击「新建问题」只需输入问题正文，标题跟随 Session 标题。生成回答时，弹窗显示已用时间和约两分钟的预计倒计时。问题支持搜索、追问和标记解决；重新加载或更新插件后，问题记录仍会保留。

![内置 PenguinHarness 客服工作台](/blog-assets/penguinharness-0-2-16-support-zh.jpg)

构建工作台的 Skill 也补充了交互要求：列表与详情分开、弹窗可关闭、运行有进度反馈，并在浏览器里验证两个独立对话。

## Gemini 4 Argon 与模型预置更新

Google、Penguin Go 和 OpenRouter 分组新增 Gemini 4 Argon。OpenAI、OpenRouter 和 OpenCode Go 分组新增 GPT-6 Luna。OpenCode Go 还更新了 Claude Haiku 5.5、Gemini 4 Argon Contributor、Grok 4.7 等模型。

![模型库中的 Gemini 4 Argon](/blog-assets/penguinharness-0-2-16-models-zh.jpg)

已有 Project 可在模型库选择「添加新模型」，保留已保存模型、凭据和默认模型。「恢复默认」则会将配置重置为当前预置列表，只保留 API Key。

价格排序改为按 85% 缓存输入、10% 未缓存输入和 5% 输出加权计算，并计入当前折扣与闲时价格。Penguin Go 余额也可以固定到侧栏。

## 本版其他更新

- **本地背景图片**：在设置 → 外观中选择不超过 20 MB 的 PNG、JPEG 或 WebP，调整透明度、显示方式和对齐位置。图片在本地处理，不会上传。
- **浏览器隔离**：每个 Session 保留自己的标签页。同一 Project 共享登录状态和网站存储，不同 Project 彼此隔离。切换到应用其他页面时，媒体继续播放。
- **Agent API 设置**：为新建 API Session 选择模型、思考等级、工作区和并发上限，默认并发上限为 4。
- **稳定性修复**：Google 官方 Gemini 接口可配合服务端代理设置使用。长对话恢复显示记忆更新卡片。桌面端和安装包部署的服务端可以正常安装远程机器。

## 升级须知

- **Workflow 改名为 Workbench**：已有目录和版本历史在访问时一次性迁移，原文件保留在 Agent 的 `.workbench-migration/backup/` 中。外部集成需要改用 `/workbenches` 路由及 `workbench_updated` / `workbench_removed` 事件，不保留旧路由别名。工作台 ID 和全页链接不变。
- **更新已安装插件**，获取新版应用构建与客服 Skill。默认 Project 会补齐问答助手，不覆盖已有 Agent 文件。
- **更新桌面端原生外壳**后，浏览器按 Project 隔离存储，需要分别重新登录或导入 Cookie。旧的全局浏览器数据仍保留，但不会复制到新配置中。
- **Agent SDK 调用方**：流式 `client.run(...)` 改为 `client.stream(...)`，`client.ask(...)` 改为 `await client.run(...)`。
- **Benchmark 导入**：移除了 `penguin benchmark import`。将 `benchmark_config.toml` 和 `CASE-*` 目录复制到 Project 的 `benchmarks/<id>/`，再创建内容为 `evaluations: []` 的 `scoreboard.yaml`；新版 `benchmark-design` Skill 提供了目录说明。
- **源码开发环境**：重启开发命令，使工作台重新加载修复生效。

安装包见 [penguin.ooo/download](https://penguin.ooo/download)，完整变更见 [0.2.16 更新日志](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.16)。
