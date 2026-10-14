# 保留旧 OpenCode Go 条目的配置与计价

- **Date:** 2026-10-14
- **Type:** refactor
- **Scope:** `model-catalog`
- **PR:** [#1137](https://github.com/Prism-Shadow/penguin-harness/pull/1137)

[English](2026-10-14-backward-compatibility.md)

将旧一代 Go 条目标记为退役：新建 Project 和同步新增模型不再添加它们，已保存的条目仍可查询其名称、协议和价格；DeepSeek 旧条目的空闲时段折扣继续用于历史用量。没有自动改写配置。

这些目录条目沿用 `ModelCatalogEntry.retired` 的保留期：供应商停止接受对应 ID，且发布说明已告知删除会使历史用量失去空闲时段计价后，由确认停服的目录维护者移除。
