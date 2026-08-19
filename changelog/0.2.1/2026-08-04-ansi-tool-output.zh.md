# 修复：ANSI 颜色码不再泄漏进工具输出

- **Date:** 2026-08-04
- **Type:** fix
- **Scope:** `cli`, `core`, `web`
- **PR:** [#187](https://github.com/Prism-Shadow/penguin-harness/pull/187)
- **Issue:** [#102](https://github.com/Prism-Shadow/penguin-harness/issues/102)

[English](2026-08-04-ansi-tool-output.md)

一个经 `exec_command` 驱动、并用 `input_command` 轮询的嵌套 `penguin run`，会把 `[36m`/`[0m` 片段拼接进单词、塞满 Web 的工具卡片（[#102](https://github.com/Prism-Shadow/penguin-harness/issues/102)）。三个层次各有一份责任，每一份都已修复：

- **CLI**：渲染器无条件写出转义码。颜色现在按输出流决定一次——是否 TTY、`NO_COLOR` 未设置、`TERM` 不为 `dumb`，而非空的 `FORCE_COLOR` 可在两个方向上覆盖，与 Node 自身的语义一致——渲染器的每一处转义都经这套调色板，因此被管道接走的输出就是纯文本。
- **命令工具环境**：子进程环境本就总是设置 `NO_COLOR=1` 与 `TERM=dumb`，但继承来的 `FORCE_COLOR` 会静默胜出（当 `FORCE_COLOR` 被设置时 Node 会忽略 `NO_COLOR`）。`FORCE_COLOR` 与 `CLICOLOR_FORCE` 现在被剥离——是移除而不是置空，因为 Node 把空的 `FORCE_COLOR` 读作「开启」——于是这项加固终于成立；而由 vault 提供的取值仍按设计放行。
- **Web**：工具输出经一个防御性的 ANSI 剥离器渲染（覆盖 CSI 包括多参数 SGR、OSC、双字节转义，以及在流中途被切断的不完整序列），且只在渲染时施加——历史 Trace 得以干净显示，而它们的文件并未被改写。Trace 事件检查器刻意保留原始载荷：那本就是原始数据视图。

回归测试覆盖全部三层，包括所报告的 `FORCE_COLOR=3` + `NO_COLOR=1` + `TERM=dumb` 组合，以及跨流式分块边界被切开的序列。
