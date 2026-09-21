# 第三方声明涵盖随应用分发的字体

- **Date:** 2026-09-17
- **Type:** process
- **Scope:** `tooling`
- **PR:** [#770](https://github.com/Prism-Shadow/penguin-harness/pull/770)

[English](2026-09-17-notice-misans.md)

`THIRD-PARTY-NOTICES.md` 新增小米 MiSans 字体一节：Frost 主题使用它的 Regular 与 Medium 两个字重，以 `unicode-range` WOFF2 切片的形式随应用分发。该节写明子集化切片改动了什么、保留了什么，逐字引用字体文件自带的版权声明，指明每个构建产物都在字体旁附带许可文本 `fonts-licenses/misans.txt`，并收录《MiSans 字体知识产权许可协议》中英文全文。该文件还为 Web 资源中的六款 SIL Open Font License 1.1 字体（Mona Sans、JetBrains Mono、IBM Plex Sans、IBM Plex Sans Condensed、Commit Mono 与 Noto Sans SC）各新增一节，其引言也改为说明这些字体同样经由 npm 分发，位于 `@prismshadow/penguin-server` 包的 `web-dist/` 中。
