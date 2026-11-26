# macOS 桌面应用随包的原生 Git 改为签名后的文件，应用可以通过公证

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `desktop`, `plugins`, `ci`
- **PR:** [#1879](https://github.com/Prism-Shadow/penguin-harness/pull/1879)

[English](2026-11-26-macos-notarize-agent-state-git.md)

macOS 桌面构建里，Agent State Git 插件自带的本架构 Git 不再放在 tar 包中，改为随应用一起签名的文件。Apple 的公证服务会拆开归档检查，第一个带上该插件的签名构建因此被拒：macOS 归档里的 Git 程序没有 Developer ID 签名，没有安全时间戳，也没有启用 hardened runtime。

## 细节

- 打包时新增一步，在应用签名之前把插件的 `dist/native/darwin-<arch>.tar` 解到 `dist/native/darwin-<arch>/`，`bin/git` 于是和应用里的其他程序一起签名。应用里有两份插件，这一步把两份中的 macOS Git 归档都删掉了：一份由服务端加载；另一份属于插件库，其中只有构建机架构的归档，从未用到。
- 插件遇到以文件形式随包的 Git 时就地运行，没有时才把归档解到 Agent State 引擎缓存。npm 包、CLI 与服务端安装包、Linux 与 Windows 桌面应用仍是归档加解压。
- macOS 应用中其他平台的归档和 Git 源码归档保持发布时的样子。
- 签名的 macOS 构建在上传安装包之前，先用构建机架构的已签名 Git 保存并读回一个版本，再让另一架构的 Git 报出版本号。
