# 向后兼容

- **Date:** 2026-09-17
- **Type:** process
- **Scope:** `server`
- **PR:** [#769](https://github.com/Prism-Shadow/penguin-harness/pull/769)

[English](2026-09-17-backward-compatibility.md)

本次改动之前创建的会话没有自己的沙盒策略。迁移 11 `sessions-sandbox` 为 `sessions` 表新增可空的 `sandbox` 列，存量行该列为空。

空行在下一条命令执行时取当时生效的沙盒设置并写入自身行，此后与其他会话无异。在第一条命令之前，该会话的权限按钮显示当前设置。无需手动操作：迁移在下次启动或下次推送时自动执行。

## 兼容性

空行回退只有几行代码，位于会话环境的 confiner 与 `SessionService.sandboxOf` 中。要删除它，需要每个数据根都在其保留的每个会话里执行过命令，而任何版本都无法保证这一点；因此它会一直保留，直到后续某个迁移直接回填该列。下一位修改 sessions 表的人应决定是否编写该回填，并随之删除回退逻辑。
