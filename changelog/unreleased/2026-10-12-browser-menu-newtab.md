# Browser panel: the backend switch moves to Settings only, and new tabs open a start page

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1068](https://github.com/Prism-Shadow/penguin-harness/pull/1068)

[中文版](2026-10-12-browser-menu-newtab.zh.md)

The built-in browser's menu stopped offering the choice between the built-in browser and System
Chrome, and a new tab without a homepage showed a few common sites instead of an empty page.

## Details

- **Menu.** The built-in browser's overflow menu lost its **Browser** group (**Built-in** / **System
  Chrome**) and the Chrome connection row under it. The choice is made in **Settings › Browser**
  alone, which also pairs and lists Chromes. While the agents drive your Chrome, that surface's
  menu keeps the connection row, with **Connect your Chrome…** or **Manage…**.
- **Where the built-in browser cannot run.** The panel offered **Use System Chrome** only when a
  Chrome was paired to the account, connected or not. With none paired it offered no switch and
  said to pair one in Settings › Browser; with Chrome connections switched off it offered neither.
- **Start page.** Without a homepage, a new tab shows Google, Bing, Baidu, GitHub, Stack Overflow
  and Wikipedia as tiles; one click opens the site in that tab, and the address bar still takes the
  focus. The tiles are monograms, so nothing is fetched to draw them. The page underneath stays
  `about:blank`; a tab opened at the homepage never shows the start page.
- **Docs.** The built-in browser page describes the start page and sends pairing and switching to
  Settings › Browser.
