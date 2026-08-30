# 终端里的链接会打开它指向的地方

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [#556](https://github.com/Prism-Shadow/penguin-harness/pull/556)

[English](2026-08-30-terminal-links.md)

在终端里点击一个 URL,打开的是 `about:blank` 而不是该地址;而由程序写出的超链接——`gh` 和各种 agent CLI 打印 Pull Request 时用的那种——会先问"Do you want to navigate to …? WARNING: This link could potentially be dangerous",无论选什么都毫无反应。

## 细节

- 两条路径同一个原因:它们都先打开一个**空白**窗口(不带地址的 `window.open()`),再给它赋 `location`。这在浏览器里是甩掉 opener 的惯用写法,但桌面壳是按拿到的地址来路由窗口的,于是它收到的是 `about:blank`——一个外部地址,被交给系统浏览器,真正的链接则被丢弃。现在终端一步到位地打开该地址本身,并带上 `noopener,noreferrer`。
- 程序写出的超链接(OSC 8)此前根本没有处理器,这正是 xterm 退回到那个警告弹窗的原因。它们现在走同一个打开器,两类链接行为一致。
- 在全屏程序里——agent CLI,或任何带 spinner 的程序——点击链接原本完全没有反应,与上述两点无关:这类程序每帧都重绘,而 xterm 只在"抬起时指针下的链接对象和按下时是同一个"才激活链接,重绘恰恰会把它换掉。人手能做出的任何一次点击都会跨过一次重绘。现在终端改为按位置判定点击,与 Windows Terminal 一致:链接在哪仍由 xterm 自己的探测器报告,按下与抬起都落在同一个链接上就打开它——重绘不会改变这一事实,因为程序把同一个链接重绘在同一个位置。横跨链接的拖拽仍然是选区。
- 只打开 `http:` 与 `https:`。终端输出属于程序而不属于读者,它打印 `javascript:` 或 `data:` 和打印一个普通地址一样容易;其余一律静默忽略。
