# 默认主题通用（Primer）改用 GitHub Primer 的字体

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`

[English](2026-09-30-primer-typeface.md)

默认主题通用（Primer）此前使用平台的系统字体，现改用 GitHub Primer 所用的字体：英文为 Mona Sans，代码为 JetBrains Mono，CJK 字体为 Noto Sans SC；三者各自排在原先的系统字体之前，系统字体留作兜底。通用主题的字号与间距保持不变；灰阶另行调整，见[通用主题（Primer）的黑白灰改为纯中性色](2026-09-30-primer-neutral-grays.zh.md)。

## 细节

- 界面、正文与标题改用 Mona Sans；代码块、行内代码及其他等宽文本改用 JetBrains Mono；CJK 字体改为 Noto Sans SC，排在 PingFang SC 与 Microsoft YaHei 之前。
- 这三款字体此前均已打包（Mona Sans 供字体组合选用，JetBrains Mono 属白领，Noto Sans SC 属极客），构建产物没有新增字体文件。通用主题的会话开始下载 Mona Sans、JetBrains Mono，以及其中文文本用到的 Noto Sans SC 分片。
- 设置 → 外观中的**字体**仍可分别替换英文与中文字体；在通用主题下，「随主题」即指 Mona Sans 与 Noto Sans SC。
- 「版权信息」页把通用列为使用 Mona Sans、JetBrains Mono 与 Noto Sans SC 的主题之一。
- 画廊的「字体」页随之显示新字体：默认字体表中通用一行，以及通用主题的字样。
