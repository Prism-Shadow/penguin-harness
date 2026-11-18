# 项目工具模型迁移

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `core`、`server`、`cli`
- **PR:** [#1597](https://github.com/Prism-Shadow/penguin-harness/pull/1597)

[English](2026-11-19-backward-compatibility.md)

首次打开已有项目时，视觉模型迁到 `tools.i2t`，听写润色模型迁到 `tools.t2t`，原有六项能力的模型也迁入同一张表。已有的新工具设置优先。润色保留原来的开关状态，之前使用默认聊天模型的项目会把当时的默认模型选为文本工具。旧字段迁移后移除，之后可以直接清空绑定。

发布维护者将在准备 0.3.0 时检查受支持的升级路径，全部经过此步骤后移除文件迁移。旧版网页接口和 CLI 的 `image`、`video`、`tts`、`stt` 命令继续使用同一份绑定。
