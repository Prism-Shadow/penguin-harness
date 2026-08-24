# kernel 哈希记录只保留配置更新真正会用到的哈希

- **Date:** 2026-08-24
- **Type:** refactor
- **Scope:** `core`, `docs`
- **PR:** [#438](https://github.com/Prism-Shadow/penguin-harness/pull/438)

[English](2026-08-24-kernel-hash-record.md)

用扁平的按叶子记录 `KERNEL_HISTORY` 替换了 `KERNEL_HASH_HISTORY`——后者是内置默认值的六代快照，每一代都完整罗列全部 kernel 管理叶子。这些快照共存了 158 条叶子哈希，其中 121 条只是在重复 kernel 更新永远不会去查的值：更新在存储值等于当前默认值时**先**短路，之后才查记录，因此一个未变化的叶子无论被多少代重复，其哈希都不参与任何判断。新记录保留了 37 组互不相同的 `(叶子, 哈希)` 对，并按各自承担的职责拆开。更新行为没有任何变化：以前会前进的存储值仍然前进，以前被保留的仍然被保留，处在最早一代记录上的配置也一样。

## 细节

- 把记录拆成三个字段。`current` 固定当前默认值每个叶子的哈希，作为漂移守卫的锚点。`superseded` 按叶子由旧到新列出更早的 kernel 曾经发布过的默认值——6 个叶子共 8 条哈希（`system_prompt`、`compaction.max_context_length`、`memory.prompt`、`tools.builtin.exec_command`、`tools.builtin.input_command`、`tools.builtin.run_subagent`），它们是唯一能把「用户未改动过的旧默认值」判定为前进的哈希。`addedIn` 记录那些并非从一开始就存在的叶子的加入时间，用来判断某个默认工具从已存在的 `tools.builtin` 数组中缺失，究竟是用户有意删除，还是这份配置本就早于该工具；由于是与 `KERNEL_VERSION` 比对，条目会在下次版本前进时自动不再算作「新增」，无需手工清理。
- 让 `applyKernelUpdate` 通过两个新助手 `isSupersededDefault` 与 `isNewInCurrentKernel` 读取该记录，替代原先每次调用现场构建的逐代扫描，并把它的测试接缝改为接收 `KernelHistory`。随表一并移除了 `historicalHashesFor`。
- 把逐代条目承载的叙述改写为记录上的注释：[#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) 之前带硬编码 Vault、Skills 段落的模板，开关那一代，`run_subagent` 先后获得 `thinking_level` 与加宽后的 `max` 档位，`compaction.max_context_length` 提升到 256000，以及后台执行那一批改动连同重写后的 memory prompt。
- 重做 pinned-hash 守卫：改为将重算出的默认值与 `KERNEL_HISTORY.current` 比对，并按 `added` / `changed` / `removed` 三组叶子列表报告漂移，失败信息逐组说明该做什么改动——变化叶子的旧哈希该放到哪里，以及新增叶子需要一条 `addedIn` 才能到达既有配置。
- 新增等价性证明：对逐代快照记录过的全部 158 组 `(叶子, 哈希)` 对，新记录给出的前进 / 保留 / 已是当前值判定与旧表完全一致，且每个叶子的 `addedIn` 日期与它在旧表中首次出现的一代吻合。旧表作为冻结的测试 fixture 保留下来，使该证明在后续 kernel 向 `superseded` 追加内容时继续生效。
- 更新配置文档中面向开发者的段落，说明新的记录形态，以及默认值变化时需要做的改动。
