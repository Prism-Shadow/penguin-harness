# 桌面应用用日志文件记录各进程的运行情况

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `desktop`
- **PR:** [#848](https://github.com/Prism-Shadow/penguin-harness/pull/848)

[English](2026-09-29-desktop-log.md)

桌面应用把外壳打印的每一行和内嵌服务器的输出写入 `desktop.log`，每行带时间戳，并记录每一个结束的进程。这样一来，崩溃或重启都会留下用户可以发送的痕迹。

## 细节

- 文件位于应用用户数据目录下的 `logs/desktop.log`：macOS 为 `~/Library/Application Support/PenguinHarness/`，Windows 为 `%APPDATA%\PenguinHarness\`，Linux 为 `~/.config/PenguinHarness/`。文件达到 5 MB 时改名为 `desktop.log.1`（替换上一个），并开始一个新文件。日志同步写入，因此崩溃前的最后几行一定已写到磁盘上。
- 渲染进程结束时，日志会记下它的类型和 id、页面的源和路径，以及 Electron 给出的原因和退出码：应用窗口的页面、内置浏览器的标签页、DevTools 都是如此。其他子进程结束时（GPU 进程、内嵌服务器、各工具进程）也会记录，服务器每次退出都会记下退出码。窗口或标签页失去响应时同样会记录。
- 应用窗口的页面在其渲染进程结束后仍会重新加载，但如果反复出错，每次等待的时间会越来越长：第一次立即重载，之后依次等待 1、2、4 秒，最长 30 秒。页面持续运行一分钟后，计数重新开始。
