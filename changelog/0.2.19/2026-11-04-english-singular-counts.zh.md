# 英文的模型分组和导入记忆对话框改说 "1 model" 和 "1 memory"

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1459](https://github.com/Prism-Shadow/penguin-harness/pull/1459)

[English](2026-11-04-english-singular-counts.md)

有六条英文文案在数量为一时用了复数。删除只含一个模型的自建分组时，确认框写 "Its 1 models"，删除后提示 "Group deleted (1 models)"。对这个分组测速时，确认框写 "each of the 1 models"。导入只含一条记忆的导出文件时，文件行写 "notes.json — 1 memories"，确认框写 "1 memories will be overwritten" 或 "1 memories will be deleted"。现在这些地方都改用单数。中文文案本来就没有问题，没有改动。
