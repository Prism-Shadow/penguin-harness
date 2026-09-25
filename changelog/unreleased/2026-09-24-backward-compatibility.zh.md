# 向后兼容：范围类型出现之前写下的提案账本

- **Date:** 2026-09-24
- **Type:** process
- **Scope:** `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[English](2026-09-24-backward-compatibility.md)

## 没有 kind 的范围条目按 `edit` 读取

早先版本的提案插件写下的 `proposals.jsonl`，其范围条目只有文件与名称模式。插件现在要求每个条目带一种 kind（`edit`、`new`、`delete`、`rename`）；没有 kind 的条目在加载账本时按 `kind: "edit"` 读取。磁盘上的文件**从不改写**——只在内存里这样读，此后发布的每个修订都带明确的 kind 写入。

范围：运行该插件的服务器上，每个组织的 `<orgDir>/proposals.jsonl`。无需手动操作。原本是新建、删除或改名的条目，在作者以正确的 kind 发布新修订前仍读作 `edit`；该行显示 `missing`，页面不会因此出错。

## 兼容性

这条读取时的缺省（`migrateScopeKinds` 及其在账本加载中的调用）在还存在不带 kind 的旧账本期间一直保留；它只是对修订行的一个分支。只有在另有决定把这些旧账本改写之后才能移除——在那之前移除会让旧条目没有 kind。
