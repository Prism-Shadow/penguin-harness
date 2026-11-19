# 模型切换不再自行开出 Trace 文件

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `docs`
- **PR:** PR_W_LINK
- **Breaking:** yes — 切换的流以 `session_update` 结束，而不是新上下文的 `session_meta`

[English](2026-11-19-model-switch-lazy.md)

会话内切换模型不再立即开出下一个 Trace 文件。切换完成时，Session 向被离开的文件追加一条记有目标模型的 `session_update`，并作为切换的最后一条记录推入输出流；下一个上下文的文件随下一条消息开出，与任何压缩之后相同（[PRFC-0035](https://github.com/Prism-Shadow/penguin-harness-design/pull/498)；读端的改动见[各读端认识 `session_update` 记录](2026-11-19-session-update-record.zh.md)）。

## 细节

- 连续切换，或切换后没有消息，都不再留下只有文件头的文件。记录都在同一个文件里，最后一条记的就是当前模型。
- 下一条消息先把 `task_begin` 写进旧文件，再开出新文件：目标模型的 `session_meta`（排在 `task_begin` 之后、输入之前上流）、开档记录，以及该上下文开启时所带的文本——摘要、交接说明或切换的 `[model_switch_from]` 交接说明——只在文件头写一次。轮转成为写出上下文开头的唯一一处。
- 被拒绝、被中断或以 `fatal` 结束的切换不写记录；从未运行过的 Session 也不写。
- 切换之后、下一条消息之前重启，落在目标模型上，带着摘要或交接说明。离开一个尚无回应的上下文时，该上下文未得到回应的文本在重启后仍在，提前开出的文件曾丢失它。切换自身的压缩取不到摘要的，在这段时间内重启改以由本文件重建的就地交接说明开头，而不是 `[model_switch_from]` 交接说明。
- 服务端：Session 行与模型监听方在记录经过时跟随，切换的交接说明在新文件开出之前为历史接口暂存。
- CLI：恢复某个 Session、尚未发送消息的对话，仍把切换的交接说明认作切换的一部分。

## 兼容性

- SDK 宿主：`Session.switchModel` 在原先产出新上下文 `session_meta` 的位置产出 `session_update`（交接时其后为交接说明）；那条 `session_meta` 随下一次运行到达，排在其 `task_begin` 之后。新模型改从该记录的 `provider` / `model_id` 读取，或读 `Session.provider` / `Session.modelId`。
- `ContextEngine.switchContext` 与 `ContextEngine.handOverContext` 不再产出 meta 与交接说明；`ContextEngine.opensWith(record)` 回答下一个上下文是否以该交接说明开头。
- 旧版本读到「切换之后尚无消息」的 Trace 时，恢复到原模型并整个重放旧上下文：内容不丢，但既没有切换也没有压缩。切换之后已有消息的 Session 不受影响。为此不保留兼容代码。
- 磁盘上已有的 Trace 原样重放，包括旧版本为切换提前开出的文件。
