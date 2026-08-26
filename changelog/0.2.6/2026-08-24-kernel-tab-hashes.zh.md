# 内核更新改为一个设置页一个哈希

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#438](https://github.com/Prism-Shadow/penguin-harness/pull/438)
- **Breaking:** yes — 内核更新现在以整个设置页为单位保留或跟进，因此只要改过某页的一个字段，该页其余内容就会停在原处，直到还原默认配置。

[English](2026-08-24-kernel-tab-hashes.md)

把内核更新的比对单位从配置叶子改为 Agent 设置页。原先的 `KERNEL_HASH_HISTORY` 是内置默认值的六代快照，每一代完整罗列 21–29 个 kernel 管理叶子、共 158 条记录；现在替换为两张按设置页展开的扁平表：`KERNEL_DEFAULT_TAB_HASHES`（7 条，每页一条）与 `KERNEL_SUPERSEDED_TAB_HASHES`（6 条，更早的 kernel 发布过的页面取值）。每个设置页只问一个问题：配置里整页缺失、哈希等于当前默认、哈希等于某个已记录的旧默认，还是都不是——对应整页重写、跳过、整页重写、整页保留。

## 细节

- 在 `KERNEL_TABS` 中定义受管设置页，顺序与设置页本身一致：`prompt`（`system_prompt`）、`runtime`（`max_turns`、`model`、`compaction`）、`tools`（`tools.builtin`）、`skills`、`memory`、`vault`、`schedules`。「概览」页与 `tools.mcpServers` 不属于任何受管页，因此名称、描述、Agent State 版本号与 MCP Server 依旧不可能被触碰。
- 设置页哈希覆盖该页所拥有的全部内容，因此用户在页内任何位置新增的键都会改变哈希，该页随即被保留而非覆盖。配置中整页缺失时哈希为空，直接按默认值写入——早于提示词注入小节的配置正是借此拿到这些小节。
- 删除了逐叶规则需要、而按页规则不再需要的部分：`tools.builtin` 的逐工具合并、`addedIn` 加入时间及其支撑的 `newInLatestGeneration` 判断，以及 `kernelLeafEntries` / `KernelLeaf` / `computeKernelHashes` / `historicalHashesFor` 这套叶子机制。跟进的工具页会按默认值整页重写，新增工具随之进入；被保留的工具页整页保留，用户删掉的工具因而留存。
- 结果中的 `advanced` / `kept` 由点号叶子路径改为设置页键名。Web App 直接用设置页自己的标签渲染它们，原先的逐叶显示词典与逐工具特例一并移除；更新的确认文案与结果文案在中英文下都改为以设置页表述。
- 重做 pinned-hash 守卫：改为用 `computeKernelTabHashes(defaultSystemConfig())` 与 `KERNEL_DEFAULT_TAB_HASHES` 比对，失败信息列出发生变化的设置页及各自需要的改动。
- 把代际叙述改写为记录上的注释：[#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) 之前带硬编码 Vault、Skills 段落的模板，开关那一代，`run_subagent` 先后获得 `thinking_level` 与加宽后的 `max` 档位，`compaction.max_context_length` 提升到 256000，以及后台执行那一批改动连同重写后的 memory prompt。
- 六条旧设置页哈希取自各记录代际当时的内置默认值，写入字面量之前逐代与退役的逐叶表核对无误。保留了 [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) 之前的重建证明，并改为针对 prompt 设置页。
- 同步更新配置文档中英文版的合并说明与面向开发者的段落。

## 兼容性

磁盘上的 `system_config.yaml` 没有变化——格式、字段、`kernel_version` 盖章都一样，已有配置无需任何迁移。

变化的是：对一个设置被部分自定义过的 Agent，更新会做什么。以前是逐字段合并，改了一个内置工具，只有那一个工具被保留，其余工具照常跟进新默认。现在整个「工具」页会被整体保留，于是该 Agent 不再收到工具更新——包括新增的内置工具——直到其配置被刷新。其他设置页同理：「运行参数」页改了一个字段，整页都会停住。某页字段只写了一部分时同样按原样保留，不再逐个补齐缺失字段；这些字段在运行时仍然回落到内置默认值，与此前一致。

补救方式没有变化，并且就在设置页概览中与更新按钮相邻：**还原默认配置**会用当前默认值覆盖配置，仅保留名称、描述与 State 版本号。内核更新的结果会列出所有被保留的设置页，因此每次运行都会指名哪些页已经落后。
