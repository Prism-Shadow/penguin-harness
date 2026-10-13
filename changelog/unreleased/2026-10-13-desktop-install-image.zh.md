# 机器管理：macOS 桌面端可以把本构建装到其他机器

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`, `desktop`
- **PR:** [#1089](https://github.com/Prism-Shadow/penguin-harness/pull/1089)

[English](2026-10-13-desktop-install-image.md)

macOS 桌面端在机器管理页上发起的每一次安装都被 `409` `no_install_image`（「本服务端没有可推送的安装镜像」）拒绝。服务端按安装路径 `<resources>/app/dist/server.js` 认出打包应用所在的发布版，而资源目录名是按 `resources` 精确比对的；macOS 应用包里这个目录叫 `Contents/Resources`，所以每一台 Mac 上的桌面端都被当成没有发布版。现在目录名比对不分大小写。桌面端在各平台上都和 tarball 安装一样安装：机器按自己的系统与架构下载桌面端所在的发布版，桌面端有推送状态时一并复制过去。

## 细节

- 桌面端构建复制远端安装脚本时，改用 server 包与热推送共用的那份清单（`scripts/far-side-scripts.mjs`）。
- CI 在三个平台上对打包产物运行的 `verify-packed-cli.mjs`，另检查机器安装要从应用里读的东西：`dist/server.js`、它旁边的安装脚本，以及应用 `package.json` 里的版本号。
