# 向后兼容：存量的 `read_image` / `describe_image` 条目与旧的 `read_file`

- **Date:** 2026-09-02
- **Type:** process
- **Scope:** `core`, `web`
- **PR:** [#588](https://github.com/Prism-Shadow/penguin-harness/pull/588)
- **Breaking:** yes — `read_image` 与 `describe_image` 两个工具名不复存在；既有 Agent 的存量条目不再装配，模型按任一旧名调用都会得到未知工具回复，直到该 Agent 更新内核

[English](2026-09-02-backward-compatibility-read-file-images.md)

[读图并入 `read_file`](2026-09-02-read-file-images.zh.md) 移除了两个内置工具——每个既有 Agent 的 `system_config.yaml` 都在 `tools.builtin` 下列着它们——并改变了第三个工具的定义。磁盘上的内容一律不改写；本条记录既有安装会看到什么，以及需要做什么（如果需要的话）。

## 存量工具条目：跳过，不迁移

本版本之前创建的 Agent 带有一条 `read_image`（`forModel: vision`）和一条 `describe_image`（`forModel: text-only`）条目，以及一条只写纯文本描述、没有 `prompt` 参数、超时 30000 ms 的 `read_file` 条目。选择：沿用 `kill_command` / `kill_subagent` 退场时的先例——注册表里没有工厂的条目在**装配时跳过**：不列给模型，按旧名调用得到标准的未知工具回复。不设别名，不在加载时改写。存量的 `read_file` 条目仍装配到新实现上，其读图分支已能工作；模型只是被告知了旧描述、schema 里没有 `prompt`，超时也仍是 30000 ms。

因此不做任何操作时，这样的 Agent 按名字失去了读图工具，却在没被告知的情况下经 `read_file` 获得了读图能力。要采纳当前定义：

- **内核更新**（Agents 页的角标，或设置页的内核操作）：内核版本推进到 `2026-09-02`，每个既有 Agent 都会被标记。用户从未编辑过的工具 Tab 整体推进——新的 `read_file` 条目进来，两个读图条目出去。带有任何自定义的工具 Tab 一如既往保留；这时的出路是恢复默认配置或手工编辑（从 `packages/core/src/state/default-config.ts` 复制条目）。
- 别无其他。跳过是注册表的既定行为，不是垫片：日后没有要删的兼容代码。

未采用的方案：加载时就地改写 `tools.builtin` 的迁移（悄悄修改用户拥有的文件），以及让 `read_image` / `describe_image` 作为 `read_file` 的别名再装配几个版本（模型的工具列表上留着三个名字，同一次清理只是推迟）。

## 旧 Trace

本版本之前写下的 Trace 带有 `read_image` / `describe_image` 工具调用。它们照旧渲染——工具名与参数——Web 工具卡按其 `source` 参数像文件路径一样预览（`tool-call-card.tsx` 里的 `LEGACY_IMAGE_TOOLS`）。这个映射只管展示，待 2026-09-02 之前的 Trace 不再需要渲染时即可移除；没有人被安排去删它。

## 兼容性

无需任何操作即可继续工作：既有 Agent 一旦尝试就能经 `read_file` 读图，但只有在内核更新或恢复默认之后才会被告知这一点、才拿到 `prompt` 与 60000 ms 的超时；在那之前，仍按 `read_image` / `describe_image` 调用的模型会得到未知工具回复。点名这两个工具的脚本与提示词改用 `read_file`。
