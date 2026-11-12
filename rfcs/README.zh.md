# 设计 RFC（PRFC）

这个目录是 PenguinHarness 的设计 RFC 面：一份文档记一个设计决定，文件名 `PRFC-NNNN-slug.md`。这里的每份文档都迁自设计仓库 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design)（同名文件居其 `rfcs/` 目录下）。迁移按两种状态全收：已落地于设计仓默认分支的文档，与仍被 open 或 draft 设计 PR 携带的草案。已落地的文档在这个目录里；每份草案随它自己的 PR 进来，在那之前索引行只写文件名、不带链接。

[English](README.md)

## 本面的约定

1. **一份 RFC 与它对应的 impl 改动不放在同一个 PR 里**，两者可独立合并。
2. **RFC 一旦落地，就不应频繁修改。**
3. **确需修改时，必须提升版本号（rev）**——形如 `v2.0.0`。
4. **每次修改在文末以 `## Changes` 一节列出该版本的 change item**——`### v2.0.0` 下 `- Added…`／`- Removed…`／`- Updated…`。

## 一份文档的形状

每份文档保留原标题行（`# PRFC-NNNN …`）、元数据列表与正文；节名沿用 Rust RFC 模板。每份 RFC 是一对——`PRFC-NNNN-slug.md` 英文与 `PRFC-NNNN-slug.zh.md` 中文，同一份设计的两语版本——两个文件顶部各有语言链接，可在两者之间切换；下面的索引链到英文文件。迁移只给每份文件加了两样东西：

- 标题行下的**来源标记**：设计仓里的原文件名、它在设计仓的状态——落地于默认分支，或携带草案的 open/draft 设计 PR——以及当前 rev；
- 文末的**`## Changes` 一节**：逐版本记录这份文档经历的每次修订，自 `v1.0.0` 起。

中文版的正文与设计仓的文字一致；英文版是同一版本的英译。有未合并修订的 RFC，正文保留已落地版本，来源标记记录未合项；设计仓定夺后，更新以一次 rev 提升连同其 change item 落到这里。

## 编号

编号与文件名原样沿用设计仓。两份草案同占 `0005` 号——PRFC-0005-mechanisms-not-implementations.md 与 PRFC-0005-plugin-versioning.md——两条独立的设计线在各自落地前先后占了同一个号；它们是两份不同的文档，不是同一份的两个修订。`0013` 号已退役：HMR RFC 曾以 PRFC-0013 起草，落地前改号为 PRFC-0002。

