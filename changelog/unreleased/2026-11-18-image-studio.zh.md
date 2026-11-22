# 图像工作室

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `plugins`
- **PR:** [#1599](https://github.com/Prism-Shadow/penguin-harness/pull/1599)

[English](2026-11-18-image-studio.md)

多模态工具插件新增**图像工作室**，可从应用中心或 Agent 的标签页打开。描述图片、选择画幅：每次创作都会为该 Agent 新建一个会话，由它在会话中用项目的图像生成模型运行 `penguin tools t2i … --json`。工作室从会话的文件中展示并提供下载该会话生成的图像。重新打开以前的创作即可再次查看；失败或取消的创作连同状态保留在历史记录中，取消会同时停止会话和其中的生图任务。

项目关闭插件后，已有图像仍可查看和下载，新的创作要等重新启用后才能开始。

插件的路由新增列出会话任务的接口（`GET …/multimodal-tools/sessions/:sessionId/runs`），供工作室跟进。`multimodal-tools` 技能说明了图像工作室如何读取会话中的图像。
