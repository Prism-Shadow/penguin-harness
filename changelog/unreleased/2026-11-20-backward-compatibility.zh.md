# 本批次的向后兼容

- **Date:** 2026-11-20
- **Type:** process
- **Scope:** `core`, `server`, `desktop`, `plugins`
- **PR:** [#1641](https://github.com/Prism-Shadow/penguin-harness/pull/1641), [#1669](https://github.com/Prism-Shadow/penguin-harness/pull/1669)

[English](2026-11-20-backward-compatibility.md)

本批次的每一项兼容决定都只在这里记录一次；功能条目引用本文件，不再复述。

## 在存储空间成为预装模块之前创建的 Project

[设置 › 存储空间](2026-11-19-storage-settings.zh.md)由预装的 `storage` 插件提供。它的服务端模块经由[预装的内置模块](2026-11-19-preinstalled-plugin-modules.zh.md)带来的一次性列入到达已有的 Project，详见 [2026-11-19 的文件](2026-11-19-backward-compatibility.zh.md#预装之前建出的-project)。本批次没有为此新增代码，只是多了一个由它列入的包：首次启动带有 `storage` 的构建时，服务器在每个已有 Project 自己的 `[plugins.<machineId>]` 表中列入一次 `"@penguinharness/storage" = "*"`。不列入的话，迁移之前创建的每个 Project 都会少了这个页面。

### 范围

带有 `storage` 的构建启动时，数据根下的每个 `.project_config.toml`，各一次。管理员之后把该模块从某个 Project 中移除的，保持移除；管理员停用该模块的服务器也不列入。

### 你需要做什么

什么都不用做。

### 保留期限

与该列入机制相同：保留到下一个大版本（1.0），由准备 1.0 的人随它一起移除（见 2026-11-19 的文件）。这里没有需要单独移除的内容。

## 数据根顶层的 Project 目录，以及 `<project>/benchmarks/` 中的 Benchmark

[Project 移入 `projects/`](2026-11-20-data-root-projects.zh.md)，Benchmark 移入评估中心的数据目录。产品负责人选定一次性迁移并留下链接（2026-11-19）。仍然支持的旧形态：

- 位于 `<root>/<project_id>/` 的 Project 目录：下次启动时移到 `<root>/projects/<project_id>/`，降级期间旧版本新建的此类目录在之后的启动中同样移入；
- 位于 `<project>/benchmarks/<benchmark_id>/` 的 Benchmark：移到 `<project>/agents/system_agent/app/data/benchmark/<benchmark_id>/`；`system_agent` 是用户自己的 Agent 的 Project（[2026-11-19](2026-11-19-backward-compatibility.zh.md)）除外，其 Benchmark 留在原处并从原处读取；
- 记录在旧位置下的绝对路径（Trace、仍开着的对话、未更新的已装 Skill 副本，以及迁移未改写的文件里的）：经每个旧位置留下的链接（POSIX 为相对符号链接，Windows 为目录联接）照常到达同一批文件；
- web.db 中指向旧位置下路径的行：由服务端改写，SDK 在没有服务端时移动了目录之后也是如此。

在已迁移的数据根上运行的旧版本按 web.db 列出 Project，经链接打开它们。旧版本有两处按数据根的目录列举，会跳过链接：对已迁移的 Project，只列在该 Project `[plugins]` 中的服务端模块插件不加载，其未登记的 Trace 会话不被收编。名为 `app` 或 `run` 的 Project 在顶层留有链接，因此该数据根上 server 级共享的 Workbench 目录在链接删除前不可用。

### 范围

新版本打开的每个数据根：服务端的、桌面端的、开发数据根、各台机器的（其服务端下次以新版本启动时），以及 SDK 程序与 CLI 的。

### 需要做什么

无需任何操作，除非有 Project 名为 `projects`：此时服务端不启动，也不移动任何内容。请启动上一个版本，把该 Project 的 Agent 移到另一个 Project（先导出，再导入），删除 `projects` 这个 Project，然后再启动本版本。

### 保留期限

core `state/layout-migration/` 的维护者保留迁移本身、它的调用处（服务端的 `layout/` 与平台启动、SDK 的 `createAgent`、CLI 的 `resolveProjectRoot`）、`resolveBenchmarksDir` 中的 C1 分支、Workbench 宿主 `data-dirs.ts` 中对链接的拒绝以及这些链接本身，直到下一个主版本（1.0）。该版本的发布准备一并删除它们，并由其迁移步骤删除这些链接；此后 Trace 中的旧路径不再可达。
