# 侧栏 squad 行显示编组与上级

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1078](https://github.com/Prism-Shadow/penguin-harness/pull/1078)

[English](2026-10-13-squad-row-mark.md)

带 `squad` 标签起的会话，在侧栏行那个暗色标记簇里多一个 users 标记，与已有的来源标记并列。它的 tooltip 写出编组名，父子关系已知时还带上级的短 id——于是一次「发散」从列表本身就能认出是同一件工作，不必逐个点开子会话。

## 细节

- `SessionRow` 增加 `squadGlyph` / `squadLabel` 两个槽位，在来源标记之后画成一个 `RowMark`；任一半缺失都不画，因此只知道一半的调用方不会画出半个标记。
- `lib/session-source-mark.ts` 的 `squadMark()` 从一行列表数据构造它：标签，以及 `parentSessionId` 指向另一个会话时其末六位。
- 归档行与其他来源标记一样不画；无标签的行不多画任何东西。
- tooltip 双语（`S.chat.squadSession`）。
