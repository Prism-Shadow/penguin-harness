# TokenDance 的 Dots3-Note Preview 改用半角括号命名

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `core`
- **PR:** [Myriad-Dreamin/penguin-harness#90](https://github.com/Myriad-Dreamin/penguin-harness/pull/90)

[English](2026-09-29-dots-3-note-ascii-parens.md)

## 改了什么

- 内置目录把 `dots-3-note-preview` 的名称由 **Dots3-Note Preview（Free）** 改为 **Dots3-Note Preview (Free)**。全角括号沿用自卖方的中文目录；目录里的模型名不随界面语言翻译，于是英文界面里也原样显示全角括号。用词仍按卖方的写法，只改标点，与目录里其他带括号的名称一致。
- 未改过该行名称的 Project 会立即显示新名称：预设模型的名称从目录读取，不写入配置。用户自己起的名称不受影响。
- 目录测试新增一条：任何模型的显示名都不得含中日韩标点。
