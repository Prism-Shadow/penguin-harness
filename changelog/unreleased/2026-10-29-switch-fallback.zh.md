# 当前模型不可用时，切换模型改为交接 Trace 路径

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `amsp`, `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#1388](https://github.com/Prism-Shadow/penguin-harness/pull/1388)

[English](2026-10-29-switch-fallback.md)

会话内切换模型仍优先用当前模型压缩，再带着摘要在目标模型上继续。拿不到摘要时，切换不再保持原模型，而是交接 Trace 路径完成：下一个上下文在目标模型上开启，以一条整条为 `[model_switch_from]` 块的用户消息代替摘要——即 `/model` 交接所用的块——写明本 Session、被离开的上下文的 Trace 文件绝对路径、Workspace 与原来的模型组合，并告诉模型需要历史时去读这个文件。只有压缩被中断才保持原模型。

## 何时交接

- 当前模型已不在 Project 配置中，或其客户端无法构造（key 已删除）：它不会收到任何请求，也不写压缩事件对。
- 摘要请求以完成或被中断之外的方式结束：服务商不可用、超时或网络错误、重试后仍被限流、凭据被拒、上下文长到无法总结，或未配置压缩能力。

交接消息写在摘要原本的位置；完成一轮之前再次切换时像摘要一样带到下一个文件；恢复时被认作该上下文开启时所带的文本（点名其他 Session 的 `/model` 来源块不算）；连同上下文仍持有的文本一起随下一次运行的首个请求送达模型。被离开的文件保持原样。摘要失败后才到达的中断，以及目标上下文无法开启，仍保持原模型。

## 服务端

- `POST /sessions/:id/switch-model` 先以普通方式加载不在内存中的 Session；只有被普通加载拒绝的才只为切换加载：有 Trace 的照样恢复（`resumeSession({ allowUnreachableModel: true })`），没有 Trace 的直接在目标模型上重建（200，或目标的 409）。这样加载的运行时不在无法使用的模型上运行任何 Task 或压缩，一律以普通加载的拒绝作答；切换后没有移动的不会保留。
- 该接口不再返回 `compaction_not_configured`，`model_not_configured` / `model_unavailable` 只针对目标模型。
- `GET /messages` 的分页把交接消息当作摘要计算：不单独成为一个单元。
- 分叉对话时，交接消息改为点名分叉本身与它自己的那份 Trace 文件。

## Web App 与 CLI

- 当前模型不可用（不在模型列表中，或在需要 key 的端点上缺少 key）时，确认框说明不做摘要、把 Trace 文件路径交给所选模型，按钮为**切换**；默认正文改为压缩失败则交接 Trace 路径，而不是保持原模型。
- 对话把交接消息并入切换标记，标记写作「模型已切换 · A → B · 经 Trace 交接」，悬停显示文件路径。点名其他 Session 的 `/model` 来源块仍显示为横幅。
- `/switch-model` 在模型那一行之前打印一行，写明 Trace 文件。

## SDK

`ContextEngine.switchContext` 增加可选的第二个参数 `{ handoff, summarize }`；不传时，摘要失败仍像以前一样结束切换。`ModelSwitchRefusal` 保留 `compaction_not_configured`——`switchModel` 已不再产生它，保留是为了让以它分支的调用方仍能编译；可在下一个破坏性版本（0.3.0）删除。
