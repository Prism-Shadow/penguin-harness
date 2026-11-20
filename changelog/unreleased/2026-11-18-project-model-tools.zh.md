# 多模态工具：用项目的模型处理文字、图片、视频、语音与网页

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `plugins`, `server`, `core`, `web`
- **PR:** [#1597](https://github.com/Prism-Shadow/penguin-harness/pull/1597)

[English](2026-11-18-project-model-tools.md)

内置的「多模态工具」插件（`@penguinharness/multimodal-tools`）让 Agent 与 Web App 用项目的模型完成八种工作：文本生成、图片理解、网页搜索、网页读取、图像、视频与语音生成，以及语音识别。它是建在模型工具平台（[#1639](https://github.com/Prism-Shadow/penguin-harness/pull/1639)）之上的插件：平台不出现任何工具的名字，命令、路由、技能与结果文件都由插件提供。

## 绑定

- 插件声明七个工具模型绑定，每个工具对应 `[tools]` 的一个键：`t2t`、`search`、`fetch`、`t2i`、`t2v`、`t2s` 与 `s2t`。项目所有者经 `PATCH /api/projects/:projectId/models/tool-bindings` 为各工具绑定已配置的模型；选择器只列出该工具能用的模型，依据是 MMSP 把模型路由到的客户端及其注册表登记的输入输出模态。
- 图片理解不设绑定：它使用项目的视觉模型（`vision_model`），该键保持不变。
- 语音输入的转写润色与 `t2t` 共用同一个模型。是否开启及其提示词是插件按项目保存的设置，存放在插件于项目目录下的文件夹中。

## `penguin tools`

- 这些工具是插件的成员命令，在服务端以调用方的项目与会话运行：`penguin tools t2t|i2t|search|fetch|t2i|t2v|t2s|s2t`，以及 `list`、`status <id>` 与 `cancel <id>`。项目的任何成员都可以运行。
- 本地文件只经 `--image` 或 `--audio` 交给工具，由终端读取并发送；生成的文件保存到 `--out`（缺省为当前目录），不会覆盖已有文件。
- 会话中耗时超过四分钟的任务会在会话里继续进行并输出任务 ID；`--detach` 立即返回 ID。`status` 查看任务并可用 `--out` 保存其文件，`cancel` 停止任务。

## 结果与用量

- 工具生成的文件属于其会话：保存在 `<项目>/.multimodal-tools/sessions/<会话>/`，经插件在 `/api/projects/:projectId/multimodal-tools/` 下的路由列出与下载，会话不在后随之删除（启动时与每日一次清扫）。没有会话的任务不保存任何文件。
- 每个请求都经平台的 `ProjectModelRequests` 发出：每个请求在 `usage_records` 落一行，用途为 `@penguinharness/multimodal-tools:<工具>`（转写润色为 `…:polish`），计入发起它的会话，与对话请求同样计价。

## 目录中的工具模型

- 二十个图像、视频、语音、转写与网页模型作为普通条目加入模型目录，按 MMSP 注册表的价格计价（服务商的计费单位已折算进 MMSP 的 Token 桶）：Gemini 3.1 Flash（Lite）Image、Gemini 3.8 Flash（Lite）TTS、Gemini Omni 1.2 Flash、GPT Image 2.5 Flare、DeepSeek Search、Fetch、TTS 与 ASR（DeepSeek 与 TokenDance 各一份）、Jina Search 与 Reader、Seedream 5.5、5.0 Flash 与 5.0 Lite，以及 Fish Audio Drama 3 与 Transcribe 1。Gemini 的图像与语音条目与 MMSP 注册表一样不标价。已有项目可经「添加新模型」获得这些条目。
- 目录标为工具模型的条目在 `GET /models` 中为 `chatEligible: false`，对话的模型选择器不再列出它。

## 面向插件作者

- 插件交给 `ProjectModelRequests.stream` 的请求类型 `ProjectModelRequest` 改由 `@prismshadow/penguin-core` 声明，插件包因此能依赖该接口；服务端照旧导出它。
- 绑定的 `accepts(model)` 另外收到 `client`（请求实际使用的 MMSP 客户端）与 `input` / `output`（MMSP 注册表为该模型登记的模态）。
