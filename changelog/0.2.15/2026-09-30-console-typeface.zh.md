# 极客主题（Console）改用 IBM Plex Sans，代码改用 JetBrains Mono

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#894](https://github.com/Prism-Shadow/penguin-harness/pull/894)

[English](2026-09-30-console-typeface.md)

极客主题（Console）此前整个界面都用 Commit Mono（导航、按钮、标签、标题与设置皆然），只有消息正文、输入框与会话标题用 IBM Plex Sans。按产品负责人的决定，IBM Plex Sans 成为极客主题各处的主字体，等宽字体由 Commit Mono 改为 JetBrains Mono。极客主题的配色、字号、间距与直角造型保持不变。

## 细节

- 导航、按钮、标签、设置、各级标题与页面标题改用 IBM Plex Sans，中文仍为 Noto Sans SC。选中的导航行仍以粗体标出。
- 等宽字体只留在代码与刻意的技术标记上，并统一改用 JetBrains Mono：代码块与行内代码、通知的状态标签（`[ OK ]`、`[WARN]`、`[FAIL]`、`[INFO]`、`[NOTE]`）、工作步骤的大写标签与块状进度条，以及统计图的坐标轴刻度。步骤的耗时与步数仍为等宽；工具步骤旁的说明文字改用无衬线字体，与其他主题一致。
- 设置 → 外观中的**字体**：所选英文字体现在作用于极客主题的整个界面，与通用、白领一致；此前只改变极客主题的阅读文字。
- 不再打包 Commit Mono：其字体文件、许可文本与「版权信息」页中的条目均已移除，构建产物因此约小 95 KB。JetBrains Mono 此前已为通用与白领打包，因此没有新增字体；「版权信息」页把极客列为使用它的主题之一。
- 画廊的「字体」页随之在默认字体表的极客一行显示 JetBrains Mono。
