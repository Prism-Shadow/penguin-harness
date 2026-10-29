# 当前模型不可用时，切换模型改为交接 Trace 路径

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `amsp`, `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#1388](https://github.com/Prism-Shadow/penguin-harness/pull/1388)
- **Breaking:** yes — SDK：`ModelSwitchSupport` 须实现 `reachable`，`ContextEngine.switchContext` 改为接收选项对象，`ModelSwitchRefusal` 不再有 `compaction_not_configured`

[English](2026-10-29-switch-fallback.md)

会话内切换模型仍优先用当前模型压缩，再带着摘要在目标模型上继续。拿不到摘要时，切换不再保持原模型，而是交接 Trace 路径完成：下一个上下文在目标模型上开启，以一条整条为 `[model_switch_from]` 块的用户消息代替摘要——即 `/model` 交接所用的块——写明本 Session、被离开的上下文的 Trace 文件绝对路径、Workspace 与原来的模型组合，并告诉模型需要历史时去读这个文件。只有压缩被中断才保持原模型。

## 何时交接

- 当前模型已不在 Project 配置中，或其客户端无法构造（key 已删除）：它不会收到任何请求，也不写压缩事件对。
- 摘要请求以完成或被中断之外的方式结束：服务商不可用、超时或网络错误、重试后仍被限流、凭据被拒、上下文长到无法总结，或未配置压缩能力。

交接消息写在摘要原本的位置；完成一轮之前再次切换时像摘要一样带到下一个文件；恢复时被认作该上下文开启时所带的文本；随下一次运行的首个请求送达模型。被离开的文件保持原样。

## 服务端

- `POST /sessions/:id/switch-model` 只为切换加载不在内存中的 Session：模型已无法使用的照样恢复（`resumeSession({ allowUnreachableModel: true })`），没有 Trace 的直接在目标模型上重建（200）。这样加载、切换后却没有移动的运行时不会保留，新的 Task 仍会得到普通加载的 409。
- 该接口不再返回 `compaction_not_configured`，`model_not_configured` / `model_unavailable` 只针对目标模型。
- `GET /messages` 的分页把交接消息当作摘要计算：不单独成为一个单元。缓存的分页统计会重新计算一次。

## Web App 与 CLI

- 当前模型不可用时，确认框说明不做摘要、把 Trace 文件路径交给所选模型，按钮为**切换**；默认正文改为压缩失败则交接 Trace 路径，而不是保持原模型。
- 对话把交接消息并入切换标记，标记写作「模型已切换 · A → B · 经 Trace 交接」，悬停显示文件路径。点名其他 Session 的 `/model` 来源块仍显示为横幅。
- `/switch-model` 在模型那一行之前打印一行，写明 Trace 文件。

## 兼容性

手工构建 Session 的 SDK 使用方：给 `modelSwitch` 支持对象加上 `reachable(ref)`（回答该模型是否仍在配置中、客户端能否构造），调用 `ContextEngine.switchContext` 时传 `{ signal, handoff, summarize }`，并删去对 `compaction_not_configured` 拒绝的分支。
