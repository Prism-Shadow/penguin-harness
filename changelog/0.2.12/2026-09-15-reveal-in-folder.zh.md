# 桌面端自己的窗口里可以「在文件夹中显示」

- **Date:** 2026-09-15
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#733](https://github.com/Prism-Shadow/penguin-harness/pull/733)

[English](2026-09-15-reveal-in-folder.md)

文件面板的预览标题行在「下载」旁多了一枚**在文件夹中显示**按钮：它在本机的系统文件管理器里打开所预览文件
所在的目录——Agent 写完之后，文件接下来往往就是在那里被继续处理的。

## 变更内容

- 只有页面本身就是桌面端自己的窗口时才画出这枚按钮——服务端由桌面 shell 启动，且本会话经 shell 的一次性
  令牌建立。用浏览器登录同一台服务端的会话拿不到它，哪怕浏览器就开在这台机器上：服务端分不清它与网络另一
  端的浏览器，而在服务端所在机器上弹出一个目录，对正在看页面的人毫无意义。服务端按同样这两个字段把关——
  非桌面模式返回 404，桌面模式下的浏览器会话返回 403 `desktop_shell_only`——控件与接口对「谁可以问」的
  判断因而一致。
- macOS 与 Windows 会选中文件本身（`open -R`、`explorer.exe /select,`）；Linux 桌面以 `xdg-open` 打开
  所在目录，那是在那里能够可移植地提出的部分。
- 新接口为 `POST /api/sessions/:sessionId/files/reveal?path=`，与 `GET /files/content` 一样接收
  Workspace 相对路径，成功返回 204。路径在交给操作系统之前先走文件读取的同一道解析：`..` 与指向 Workspace
  之外的符号链接与读取时一样被拒绝，不存在的路径返回 404，而不是把一个找不到的路径丢给文件管理器。命令根本
  起不来时（例如无 `xdg-open` 的无头机器）返回 502 `reveal_failed`，面板据此报错。
- 打开之后不等文件管理器退出：子进程 detached 并 unref，只等它启动这一步。
