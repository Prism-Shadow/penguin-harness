# 安装机器时读取安装文件不再停住服务端

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1492](https://github.com/Prism-Shadow/penguin-harness/pull/1492)
- **Issue:** [#1435](https://github.com/Prism-Shadow/penguin-harness/issues/1435)

[English](2026-11-03-installer-read-off-event-loop.md)

安装机器时，请求路径上有两处同步读取：安装脚本；以及在机器连不上 GitHub 与发布镜像时，本服务端替它取来、要经 ssh 发过去的发布包（几十兆字节）。两处都改为 `fs.promises.readFile`，准备安装期间服务端照常应答其他请求。安装脚本缺失或不可读时，安装仍在 `prepare the installer` 步骤结束，并带上文件系统自己的错误信息。
