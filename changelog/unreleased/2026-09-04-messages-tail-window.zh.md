# 打开对话只读最新十个 Task

- **Date:** 2026-09-04
- **Type:** change
- **Scope:** `web`
- **PR:** [#616](https://github.com/Prism-Shadow/penguin-harness/pull/616)

[English](2026-09-04-messages-tail-window.md)

打开一个对话，现在只读取它最新的十个 Task，而不再取一个足以把多数会话整个吞下的窗口。读者打开对话时看的是它的末尾，而读取、传输与解析的开销都随窗口线性增长——旧的取值因而让最常见的一次打开，付出它可能需要服务的最长会话那份代价。更早的历史仍按滚动到的位置取回，向上回填的窗口不变。
