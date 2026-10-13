# 机器管理：每个发布版都自带 harness，从桌面端或 tarball 服务端装出的机器可以正常使用

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`, `desktop`, `ci`
- **PR:** [#1089](https://github.com/Prism-Shadow/penguin-harness/pull/1089)

[English](2026-10-13-desktop-install-image.md)

从桌面端，或从从未被热推送过的 tarball 安装装出的机器，在机器管理页上显示为连不上，原因是 `` no CLI pushed to <root>; use `penguin` instead ``。服务端在机器上执行的每条命令都经那台机器 hmr store 里的 CLI 运行，而这样的服务端只装发布版，留下的 store 是空的。现在发布构建以热推送的格式自带该发布版的 harness，服务端安装时把它一并装上，于是三种安装（桌面端、tarball、源码检出）留在机器上的都是「发布版 + 带 CLI 的 store」。另外，macOS 桌面端的每次安装都被 `409 no_install_image` 拒绝：服务端拿应用的 `Contents/Resources` 目录去比对小写的 `resources`。现在目录名比对不分大小写。

## 细节

- release workflow 把 `lib/dist/install-image.gz` 写进 tarball 的程序包；桌面端每次打包都把 `dist/install-image.gz` 写进应用（新增 `image` 脚本，由各 `pack*` 脚本、CI 的 runtime 任务和 `desktop-build.yml` 调用）。这个文件就是 `scripts/deploy.mjs --out` 打出的升级体，用发布版自己的源码构建。
- 从未被推送过的服务端在启动时或第一次安装需要时，按推送留下的 store 格式把它解开到 `<root>/machines/release-image/<id>/`，只解开一次。安装计划是发布版加这份 store，版本号带上 `+hmr.<sha>` 后缀。被推送过的服务端仍旧安装自己的推送状态。
- 发布版已一致、store 却为空的机器，现在直接复制 store，不再运行安装脚本，也不再交给更新通道（那边没有服务能应答）。因此在机器管理页上点「更新」或「强制安装」，就能修复此前装出的机器。
- 机器的 `penguin-hmr` 报告 store 里没有 CLI 时，机器管理页改为说明那台机器需要从本页重新安装本构建，后附机器的原话。
- 带发布戳的发布版构建出的镜像把该发布版（`v<版本>`）记为 revision。这样，那台机器上的发布版服务在它旁边应答时，被认作正在运行它，而不是退回了自带平台的发布版。
- `desktop-build.yml` 按 `release.yml` 的做法打入 `BUILD_COMMIT`，桌面端的镜像与 tarball 的镜像因此出自同一份源码。
- `verify-packed-cli.mjs` 另检查打包后的应用里有 `dist/server.js`、它旁边的安装脚本、`dist/install-image.gz`，以及 `package.json` 里的版本号。桌面端构建复制安装脚本时，改用 server 构建与热推送共用的那份清单。
