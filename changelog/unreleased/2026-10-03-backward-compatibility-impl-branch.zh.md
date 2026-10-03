# 向后兼容：只带 PR 的 impl 行

- **Date:** 2026-10-03
- **Type:** process
- **Scope:** `company-proposals`

[English](2026-10-03-backward-compatibility-impl-branch.md)

[提案的实现改为一对分支](2026-10-03-impl-branch.zh.md)。此前写入 `proposals.jsonl` 的每一条 `impl` 行只带一张 PR（`url` 与 `label`），没有 `head` 与 `base`。

## 旧形态：只带 PR 的 impl 行

选定方案：**在内存中读取，不改写账本。** 只带 PR 的 `impl` 行折叠为「由这张 PR 命名的 impl branch」：它的 head 与 base 就是 PR 的，在 patch、PR 关系图或部署需要时从 GitHub 读取。之后声明 head 时，若 GitHub 确认这张 PR 的 head 就是所声明的，PR 予以保留。在声明任何 head 之前登记 PR 的新行，也按同样规则读取。

**用户无需任何操作。**

## 何时可以移除

只要任一组织的账本里，某份提案最新的 `impl` 行仍可能只带 PR，这条读取路径就要保留。满足以下两点后可以移除：已有一次性步骤为所有受支持数据根上的此类提案追加带 `head`／`base` 的行；并且在未声明 head 时登记 PR 也会把 PR 的 head 与 base 写进该行。移除由 company-proposals 插件的维护者负责，最早在两点都成立后的第一个版本。
