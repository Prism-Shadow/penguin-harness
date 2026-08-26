# CI 校验随桌面应用打包的 `penguin` 命令

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `desktop`, `ci`

[English](2026-08-27-packaged-cli-checks.md)

桌面应用把 CLI 一并打包在自身内部——`<app>/bin/penguin` 与 `<app>/bin/penguin.cmd` 以应用自带的
Electron 运行时执行 `<app>/dist/penguin.js`，而所有把 `penguin` 放上 PATH 的途径（deb 的 postinst、
macOS 的符号链接、Windows 的 PATH 条目、AppImage 的包装脚本）指向的都是这两个启动器之一。此前没有任何
检查确认它们仍在打包产物中，本批次补上了这些检查。

## 细节

- `packages/desktop/scripts/verify-packed-cli.mjs` 检查 `electron-builder --dir` 产出的目录树：
  每个打包出的应用目录都必须带有两个启动器与打包后的 CLI 入口，POSIX 启动器必须可执行，且其中至少
  一个要能真正运行并报出应用版本号。CI 的 `runtime` job 在 Linux、macOS 与 Windows 上对它本就构建的
  目录树执行该脚本。
- `packages/desktop/test/launcher.test.ts` 新增 `packaged CLI` 一节，固定这些启动器所依赖、且没有
  其他地方比对过的约束：`bin/**/*` 保留在 electron-builder 的 `files` 中、`asar` 保持关闭、
  `productName` 与 `linux.executableName` 同启动器脚本所执行的可执行文件名一致、tsup 的入口名与
  `CLI_ENTRY_RELPATH` 一致，以及 deb 模板仍会创建 `/usr/bin/penguin`（绝不覆盖非符号链接）并且只
  移除它自己创建的链接。
