# 本批次的向后兼容

- **Date:** 2026-11-20
- **Type:** process
- **Scope:** `server`, `plugins`
- **PR:** [#1641](https://github.com/Prism-Shadow/penguin-harness/pull/1641)

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
