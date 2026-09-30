# macOS 以应用自己的名义询问桌面、文稿与下载的访问权限

- **Date:** 2026-09-24
- **Type:** fix
- **Scope:** `desktop`, `server`, `web`, `docs`
- **PR:** [#846](https://github.com/Prism-Shadow/penguin-harness/pull/846)

[English](2026-09-24-macos-folder-access-prompts.md)

在 macOS 上，把「下载」（或桌面、文稿、外接盘与网络卷）里的文件夹选作 Workspace 后，所有 Agent 看到的都是空目录，而且从不弹出授权询问；「文件与文件夹」里也就没有 PenguinHarness，无从放行。Workspace 选择器只指明了设置的位置，再给一个改变不了任何事情的「重试」。

现在应用为这几类位置都写明了用途，并且由应用自己去申请。选择器里被拒目录的说明框提供**允许访问**：桌面应用的主进程以应用自身的身份把该目录读一次，macOS 正是对这次读取弹出询问。允许之后列表立即重新加载，应用的服务端及其启动的每个 Agent shell 也都能读取该目录。macOS 仍然拒绝时，说明框写明要改什么，**打开系统设置**直达「隐私与安全性」：打包的应用进入「完全磁盘访问权限」，它不在「文件与文件夹」里时可以在那里手动添加。从终端启动的开发实例会被告知 macOS 把它的读取算在该终端名下，并被引到「文件与文件夹」去放行该终端。浏览器标签页没有可代为申请的应用，说明框只写明需要放行哪个进程，并保留「重试」。

## 细节

- `POST /api/projects/:projectId/dirs/access`（`{path}` → `{granted, packaged}`）请桌面 shell 以应用自身的身份读一次该目录，并等待用户对 macOS 询问的回答；只有桌面应用自己的窗口可以调用（否则 `403` `desktop_shell_only`）。服务器没有可询问的桌面 shell 时返回 `503` `shell_unreachable`，120 秒内没有应答时返回 `504` `timeout`。
- `POST /api/desktop/privacy-settings`（`{pane}`，取 `files` 或 `fullDisk`）请 shell 打开「隐私与安全性」的对应面板。与其他面向页面的桌面路由一样，它只响应 shell 自己的窗口。
- shell 与服务端经 utilityProcess 端口新增三种帧：`desktop-folder-access`、它的回复 `desktop-folder-access-result`，以及 `desktop-open-privacy-settings`。非 macOS 平台上 shell 不读取也不打开任何东西。
- Web App 为错误码 `shell_unreachable` 与 `timeout` 提供了本地化文案。
