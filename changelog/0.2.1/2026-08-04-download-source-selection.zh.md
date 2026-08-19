# 独立安装脚本与 `penguin update` 的下载源选择

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `tooling`, `cli`
- **PR:** [#176](https://github.com/Prism-Shadow/penguin-harness/pull/176), [#196](https://github.com/Prism-Shadow/penguin-harness/pull/196)

[English](2026-08-04-download-source-selection.md)

独立的 `install.sh` / `install.ps1` 文件获得了 `penguin.ooo` 转发层在 0.2.0 中已有的那套 OSS 优先的源选择（`PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`）。新发布的安装脚本会被打上其不可变的 Release tag，因此一个带版本的安装脚本下载的正是与之匹配的包，而不会悄悄跟随未来的最新 Release——`auto` 会先在 OSS 上尝试该 tag，再回退到 GitHub 上的同一 tag；显式的 `PENGUIN_DOWNLOAD_BASE_URL` / 回退覆盖仍保持最高优先级；离线安装与无条件的校验和强制均未改变。一个未打戳的源码树安装脚本会先经 OSS 的 `latest.json` 指针锁定一个 tag，然后才开始下载任何东西；而只打了一半戳的状态会让发布失败，而不是发出 POSIX 与 Windows 安装脚本互相不匹配的版本。

`penguin update` 现在遵循同一份契约，而不再要求每次升级开头都必须能访问 GitHub：版本发现在 `auto` 模式下优先使用经校验的 OSS `latest.json` 及其不可变发布（同 tag 的 GitHub 回退；强制的 `oss` 与 `github` 模式保持严格）；所选的载荷基址与同 tag 回退会交给子安装脚本，并显式清除继承来的陈旧回退值；显式的 HTTPS 镜像保持优先；而源选择失败会以本地化的方式报告。
