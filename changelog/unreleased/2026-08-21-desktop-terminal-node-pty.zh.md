# 桌面终端：node-pty 重新随应用分发

- **Date:** 2026-08-21
- **Type:** fix
- **Scope:** `desktop`, `ci`

[English](2026-08-21-desktop-terminal-node-pty.md)

在桌面应用中打开终端会失败：`POST /api/terminals` 返回 500 `terminal_spawn_failed`，并报告
`packages/desktop/dist/server.js` 处 `Cannot find module 'node-pty'`。node-pty 是原生模块，也是打包器唯一无法吸收的
依赖：服务端通过运行时 `require` 取用它，而 node-pty 自己的加载器再按包相对路径解析二进制文件。`pnpm build` 现在会把一份
node-pty 包目录落到 `packages/desktop/dist/node_modules`，源码运行与打包后的应用都能解析到它，`electron-builder.yml`
则负责把它装进安装包。

## 细节

- `src/pty-payload.ts` 挑选并复制 node-pty 中真正需要分发的部分——清单文件、许可证、`lib/`、安装时编译出的
  `build/Release` binding，以及 `prebuilds/` 下的预编译二进制——丢弃 source map、node-pty 自带的测试、其 TypeScript
  源码、node-gyp 输入、内置的 winpty 目录树，以及 44 MB 的 Windows `.pdb` 调试符号。落盘副本为 5.4 MB，除宿主机自身的
  构建产物外，还覆盖 darwin arm64/x64 与 win32 x64/arm64。
- 落盘时会为复制到的每个 `spawn-helper` 补回可执行位。node-pty 发布的这个 darwin 辅助二进制权限为 `0644`，会导致
  `posix_spawnp` 拒绝执行；在打包前修正权限，可以避免签名后位于 `/Applications` 下、服务端运行时无法写入修复的 `.app`
  落入该故障。
- `scripts/build-assets.mjs` 从 pnpm 实际安装它的 `packages/server` 解析 node-pty，若该安装不含 `pty.node` 则直接构建失败。
- `pnpm desktop` 的预检会检查这份落盘的包，构建产物过期时在启动阶段就报出，而不是等到第一次打开终端。
- `scripts/terminal-smoke.mjs` 改为按服务端产物的方式加载 node-pty——以 `dist/server.js` 为锚点的裸
  `require("node-pty")`——并在 Electron 自带的 Node 下运行，因此 CI 的 macOS 任务除 ABI 与 spawn 之外，也覆盖了模块解析。
