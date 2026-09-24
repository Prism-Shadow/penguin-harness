# 向后兼容：范围类型出现之前写下的提案账本

- **Date:** 2026-09-24
- **Type:** process
- **Scope:** `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[English](2026-09-24-backward-compatibility.md)

## 没有类型的范围条目一次性变为 `edit`

company-proposals 插件早先的构建写下的 `proposals.jsonl` 里，范围条目只有文件与名称模式。现在插件要求每条都带类型（`edit`、`new`、`delete` 或 `rename`）。首次加载这样的账本时，它把每条没有类型的条目改写为 `kind: "edit"`（每条修订行），经临时文件加改名写回，把原文件留在旁边作 `proposals.jsonl.before-scope-kinds-<时间戳>.bak`，并记一行日志点出该文件。没有无类型条目的账本不动，因此每个账本只迁移一次。

生效范围：运行该插件的服务上每个组织的 `<orgDir>/proposals.jsonl`。无需手工操作。实际是新建、删除或改名的条目在作者用正确的类型发布新修订之前一直是 `edit`，其所在行显示 `missing`，页面不会因此出错。确认提案读取正常后，备份文件可以删除。

## 兼容性

迁移（`migrateScopeKinds` 及账本加载时对它的调用）可以在所有跑过第一版的服务都用这一版加载过账本后移除——即 53531 与各开发数据根都以此版本启动过之后的下一次插件发布。移除即删去该函数、其调用与对应测试；此后磁盘上若仍留有无类型的条目，会读成没有类型。
