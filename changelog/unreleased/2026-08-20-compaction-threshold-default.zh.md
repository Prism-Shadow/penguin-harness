# 压缩阈值缺省值提高到 256000

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `docs`
- **PR:** [#366](https://github.com/Prism-Shadow/penguin-harness/pull/366)

[English](2026-08-20-compaction-threshold-default.md)

新建 Agent 的 `compaction.max_context_length` 初始值由 `128000` 改为 `256000`。生效阈值取该
数值与模型 `context_window − COMPACTION_HEADROOM`（2048）中的较小者，且每次使用时重新计算，
所以小窗口模型的触发点与此前完全一致，大窗口模型则能比此前多带一倍的上下文再折叠。

## 细节

- 初始值收进了一个具名常量 `DEFAULT_MAX_CONTEXT_LENGTH`，位于
  `packages/core/src/state/default-config.ts`。Agent 组装层在配置缺少 `compaction` 整节时
  也读同一个常量作为兜底，两处不会再像两个字面量那样各自漂移。
- 采用新初始值后，32768 的窗口仍在 30720 触发压缩，200000 的窗口在 197952 触发。窗口大于
  258048 时——内置模型目录里几乎每个条目都是——触发的就是初始值 256000 本身。
- 未配置可用 `context_window` 的模型条目按假定窗口 128000 推导——那是
  `DEFAULT_CONTEXT_WINDOW`，一个恰好曾与旧阈值缺省值同值的独立常量——因此在 125952 触发。
  新增的测试直接以出厂常量（而非替身字面量）钉住这条兜底路径，两个常量的注释也各自点名
  对方，避免这两个 128000 被当成同一件事读。

## 兼容性

- 存量 Agent 不迁移。Agent 始终按其磁盘上的 `system_config.yaml` 原样运行，所以已在磁盘上
  的每个 Agent 都保留它自己存着的 `compaction.max_context_length`——本次改动之前创建的即
  128000。只有此后新建的 Project 与 Agent 才以 256000 初始化。
- 存量 Agent 采纳新值有三条路径，均需显式操作：在 Agent 设置页的**运行参数**标签页（或直接
  在 `system_config.yaml` 里）改 `compaction.max_context_length`、执行**更新内核**，或
  **还原为默认配置**。
- 内置默认发生变化，`KERNEL_VERSION` 因此前进到 `2026-08-20` 一代，其唯一变化的叶子就是
  `compaction.max_context_length`，存量 Agent 会看到内核更新提示。执行**更新内核**时，仍等
  于某一代已记录默认的存量值会跟进到 256000，被用户改过的值则保留并在结果中列出。

## 文档

- 双语的配置页与 Agent 循环页记录了新的缺省值，并写明实际触发的是哪个数字——阈值缺省值与模型
  窗口上限中的较小者——以及未配置 `context_window` 的条目按什么推导。
