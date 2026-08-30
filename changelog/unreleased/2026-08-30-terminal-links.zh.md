# 终端里的链接会打开它指向的地方

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `web`

[English](2026-08-30-terminal-links.md)

在终端里点击一个 URL,打开的是 `about:blank` 而不是该地址;而由程序写出的超链接——`gh` 和各种 agent CLI 打印 Pull Request 时用的那种——会先问"Do you want to navigate to …? WARNING: This link could potentially be dangerous",无论选什么都毫无反应。

## 细节

- 两条路径同一个原因:它们都先打开一个**空白**窗口(不带地址的 `window.open()`),再给它赋 `location`。这在浏览器里是甩掉 opener 的惯用写法,但桌面壳是按拿到的地址来路由窗口的,于是它收到的是 `about:blank`——一个外部地址,被交给系统浏览器,真正的链接则被丢弃。现在终端一步到位地打开该地址本身,并带上 `noopener,noreferrer`。
- 程序写出的超链接(OSC 8)此前根本没有处理器,这正是 xterm 退回到那个警告弹窗的原因。它们现在走同一个打开器,两类链接行为一致。
- 只打开 `http:` 与 `https:`。终端输出属于程序而不属于读者,它打印 `javascript:` 或 `data:` 和打印一个普通地址一样容易;其余一律静默忽略。
